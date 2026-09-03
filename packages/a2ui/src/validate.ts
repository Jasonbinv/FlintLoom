import {
  A2UI_CATALOG_ID,
  type A2uiAction,
  type A2uiComponent,
  type A2uiEmitSnapshot,
  type A2uiMessage,
  type A2uiService,
} from "./types.ts";
import { parseChartKind } from "./chartKinds.ts";
import {
  isAnyInfographicRelPath,
  parseAntvSyntax,
  parseDocument,
} from "@flintloom/infographic";
import { normalizeEmitMessages } from "./normalize.ts";

const ENVELOPE_KEYS = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"] as const;
const KNOWN_COMPONENTS = new Set([
  "Column",
  "Row",
  "Text",
  "Markdown",
  "Button",
  "ChoicePicker",
  "DataTable",
  "Chart",
  "Infographic",
]);
const MAX_PAYLOAD = 65536;
const PATH_RE = /^\/(?:[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*)?$/;

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLegalPath(path: string): boolean {
  return PATH_RE.test(path);
}

function checkRemoteUrls(value: unknown): void {
  if (typeof value === "string") {
    if (value.includes("http://") || value.includes("https://")) {
      fail("remote url");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      checkRemoteUrls(item);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "path" && typeof value.path === "string") {
    if (!isLegalPath(value.path)) {
      fail("bad path");
    }
    return;
  }
  for (const v of Object.values(value)) {
    checkRemoteUrls(v);
  }
}

function checkPathBindings(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      checkPathBindings(item);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "path") {
    if (typeof value.path !== "string" || !isLegalPath(value.path)) {
      fail("bad path");
    }
    return;
  }
  for (const v of Object.values(value)) {
    checkPathBindings(v);
  }
}

function bindingPath(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "path" && typeof value.path === "string") {
    return value.path;
  }
  return undefined;
}

function validateStringCell(value: unknown, maxLen: number): boolean {
  return typeof value === "string" && value.length <= maxLen;
}

function validateLabelList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 24 &&
    value.every((item) => validateStringCell(item, 80))
  );
}

function validateHeatmapInline(comp: A2uiComponent): void {
  const xLabels = comp.xLabels;
  const yLabels = comp.yLabels;
  const values = comp.values;
  if (!validateLabelList(xLabels) || !validateLabelList(yLabels) || !Array.isArray(values)) {
    fail("bad chart: heatmap needs xLabels, yLabels, and values as number[][]");
  }
  if (values.length !== yLabels.length) {
    fail("bad chart");
  }
  for (const row of values) {
    if (
      !Array.isArray(row) ||
      row.length !== xLabels.length ||
      !row.every((cell) => typeof cell === "number" && Number.isFinite(cell))
    ) {
      fail("bad chart");
    }
  }
}

function validateComponentShape(comp: A2uiComponent): void {
  if (comp.component === "Column" || comp.component === "Row") {
    if (!Array.isArray(comp.children) || comp.children.some((c) => typeof c !== "string")) {
      fail("bad children");
    }
    return;
  }
  if (comp.component === "Button") {
    if (typeof comp.child !== "string" || comp.child.length === 0) {
      fail("bad button");
    }
    const actionObj = comp.action;
    if (
      !isRecord(actionObj) ||
      !isRecord(actionObj.event) ||
      typeof actionObj.event.name !== "string" ||
      actionObj.event.name.length === 0
    ) {
      fail("bad button");
    }
    return;
  }
  if (comp.component === "ChoicePicker") {
    const options = comp.options;
    if (!Array.isArray(options) || options.length < 1 || options.length > 20) {
      fail("bad options");
    }
    for (const item of options) {
      if (!isRecord(item) || typeof item.label !== "string" || typeof item.value !== "string") {
        fail("bad options");
      }
    }
    return;
  }
  if (comp.component === "DataTable") {
    const dataPath = bindingPath(comp.data);
    if (dataPath !== undefined) {
      return;
    }
    const headers = comp.headers;
    if (
      !Array.isArray(headers) ||
      headers.length < 1 ||
      headers.length > 20 ||
      !headers.every((h) => validateStringCell(h, 200))
    ) {
      fail("bad table");
    }
    const rows = comp.rows;
    if (!Array.isArray(rows) || rows.length > 100) {
      fail("bad table");
    }
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== headers.length) {
        fail("bad table");
      }
      for (const cell of row) {
        if (!validateStringCell(cell, 2000)) {
          fail("bad table");
        }
      }
    }
    return;
  }
  if (comp.component === "Chart") {
    const kind = parseChartKind(comp.kind);
    if (kind === undefined) {
      fail("bad chart");
    }
    const dataPath = bindingPath(comp.data);
    if (dataPath !== undefined) {
      return;
    }
    if (kind === "heatmap") {
      validateHeatmapInline(comp);
      return;
    }
    const labels = comp.labels;
    const values = comp.values;
    if (
      !Array.isArray(labels) ||
      labels.length < 1 ||
      labels.length > 24 ||
      !labels.every((l) => validateStringCell(l, 80))
    ) {
      fail("bad chart");
    }
    if (
      !Array.isArray(values) ||
      values.length !== labels.length ||
      !values.every((v) => typeof v === "number" && Number.isFinite(v))
    ) {
      fail("bad chart");
    }
    return;
  }
  if (comp.component === "Infographic") {
    const dataPath = bindingPath(comp.data);
    const hasDoc = isRecord(comp.document);
    const hasFile = typeof comp.file === "string";
    const hasSyntax = typeof comp.syntax === "string";
    const modes = [dataPath !== undefined, hasDoc, hasFile, hasSyntax].filter(
      Boolean,
    ).length;
    if (modes !== 1) {
      fail("bad infographic");
    }
    if (dataPath !== undefined) {
      return;
    }
    if (hasFile) {
      const file = comp.file as string;
      if (file.includes("..") || !isAnyInfographicRelPath(file)) {
        fail("bad path");
      }
      return;
    }
    if (hasSyntax) {
      parseAntvSyntax(comp.syntax as string);
      return;
    }
    parseDocument(JSON.stringify(comp.document));
  }
}

function parseEnvelope(raw: unknown): A2uiMessage {
  if (!isRecord(raw) || raw.version !== "v0.9") {
    fail("bad envelope");
  }
  const keys = Object.keys(raw).filter((k) => k !== "version");
  if (keys.length !== 1 || !ENVELOPE_KEYS.includes(keys[0] as (typeof ENVELOPE_KEYS)[number])) {
    fail("bad envelope");
  }
  return raw as A2uiMessage;
}

function surfaceIdOf(msg: A2uiMessage): string {
  if ("createSurface" in msg) return msg.createSurface.surfaceId;
  if ("updateComponents" in msg) return msg.updateComponents.surfaceId;
  if ("updateDataModel" in msg) return msg.updateDataModel.surfaceId;
  return msg.deleteSurface.surfaceId;
}

function mergeComponents(messages: A2uiMessage[]): Map<string, A2uiComponent> {
  const map = new Map<string, A2uiComponent>();
  for (const msg of messages) {
    if (!("updateComponents" in msg)) continue;
    for (const comp of msg.updateComponents.components) {
      if (!isRecord(comp) || typeof comp.id !== "string" || typeof comp.component !== "string") {
        fail("bad envelope");
      }
      if (!KNOWN_COMPONENTS.has(comp.component)) {
        fail("unknown component");
      }
      const typed = comp as A2uiComponent;
      validateComponentShape(typed);
      map.set(comp.id, typed);
    }
  }
  return map;
}

function validateRefs(components: Map<string, A2uiComponent>): void {
  for (const comp of components.values()) {
    if (comp.component === "Column" || comp.component === "Row") {
      const children = comp.children;
      if (!Array.isArray(children)) {
        fail("bad children");
      }
      for (const child of children) {
        if (typeof child !== "string" || !components.has(child)) {
          fail("bad ref");
        }
      }
    }
    if (comp.component === "Button") {
      const child = comp.child;
      if (typeof child !== "string" || !components.has(child)) {
        fail("bad ref");
      }
    }
  }
}

function reachableIds(components: Map<string, A2uiComponent>): Set<string> {
  const seen = new Set<string>();
  const stack = ["root"];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    const comp = components.get(id);
    if (!comp) continue;
    seen.add(id);
    if (comp.component === "Column" || comp.component === "Row") {
      const children = comp.children;
      if (Array.isArray(children)) {
        for (const child of children) {
          if (typeof child === "string") stack.push(child);
        }
      }
    } else if (comp.component === "Button" && typeof comp.child === "string") {
      stack.push(comp.child);
    }
  }
  return seen;
}

function hasWaitComponents(components: Map<string, A2uiComponent>): boolean {
  for (const id of reachableIds(components)) {
    const comp = components.get(id);
    if (comp?.component === "Button" || comp?.component === "ChoicePicker") {
      return true;
    }
  }
  return false;
}

function validateMessages(raw: unknown): { messages: A2uiMessage[]; surfaceId: string; wait: boolean } {
  const serialized = JSON.stringify(raw);
  if (serialized.length > MAX_PAYLOAD) {
    fail("too large");
  }
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 8) {
    fail("bad messages");
  }

  const messages = (normalizeEmitMessages(raw) as unknown[]).map(parseEnvelope);
  const surfaceIds = messages.map(surfaceIdOf);
  const surfaceId = surfaceIds[0]!;
  if (surfaceIds.some((id) => id !== surfaceId)) {
    fail("mixed surface");
  }

  const pureDelete = messages.every((msg) => "deleteSurface" in msg);
  if (!pureDelete) {
    const creates = messages.filter((msg) => "createSurface" in msg);
    if (creates.length !== 1 || creates[0]!.createSurface.catalogId !== A2UI_CATALOG_ID) {
      fail("bad catalog");
    }
  }

  for (const msg of messages) {
    checkRemoteUrls(msg);
    checkPathBindings(msg);
    if ("updateDataModel" in msg && msg.updateDataModel.path !== undefined) {
      if (typeof msg.updateDataModel.path !== "string" || !isLegalPath(msg.updateDataModel.path)) {
        fail("bad path");
      }
    }
  }

  const components = mergeComponents(messages);
  if (!pureDelete && !components.has("root")) {
    fail('missing root: include updateComponents with a component id "root" in the same call');
  }
  validateRefs(components);

  return { messages, surfaceId, wait: hasWaitComponents(components) };
}

function validateActionAgainstTree(action: A2uiAction, messages: unknown[]): void {
  const parsed = messages.map(parseEnvelope);
  const surfaceIds = parsed.map(surfaceIdOf);
  const surfaceId = surfaceIds[0];
  if (!surfaceId || action.surfaceId !== surfaceId) {
    fail("unknown surface");
  }

  const components = mergeComponents(parsed);
  const reachable = reachableIds(components);
  const buttons = [...reachable]
    .map((id) => components.get(id))
    .filter((c): c is A2uiComponent => c?.component === "Button");
  if (buttons.length > 0) {
    const names = buttons
      .map((b) => {
        const actionObj = b.action;
        if (!isRecord(actionObj)) return undefined;
        const event = actionObj.event;
        if (!isRecord(event) || typeof event.name !== "string") return undefined;
        return event.name;
      })
      .filter((n): n is string => n !== undefined);
    if (!names.includes(action.name)) {
      fail("unknown action");
    }
    return;
  }

  const hasChoicePicker = [...reachable].some((id) => components.get(id)?.component === "ChoicePicker");
  if (hasChoicePicker) {
    if (action.name !== "choice") {
      fail("unknown action");
    }
    return;
  }

  fail("unknown action");
}

export function createA2uiService(): A2uiService {
  const emits = new Map<string, A2uiEmitSnapshot>();

  return {
    validateEmit(messages: unknown): A2uiEmitSnapshot {
      const { messages: validated, surfaceId, wait } = validateMessages(messages);
      const snap: A2uiEmitSnapshot = {
        emitId: crypto.randomUUID(),
        surfaceId,
        wait,
        messages: validated,
      };
      emits.set(snap.emitId, snap);
      return snap;
    },

    takeEmit(emitId: string): A2uiEmitSnapshot | undefined {
      const snap = emits.get(emitId);
      if (snap) {
        emits.delete(emitId);
      }
      return snap;
    },

    validateAction(action: A2uiAction, messages: unknown[]): void {
      validateActionAgainstTree(action, messages);
    },
  };
}
