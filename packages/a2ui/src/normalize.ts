import { parseChartKind } from "./chartKinds.ts";
import { A2UI_CATALOG_ID } from "./types.ts";

const ENVELOPE_KEYS = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"] as const;
const TEXT_KEYS = new Set(["id", "component", "text"]);
const CHART_KEYS = new Set(["id", "component", "kind", "labels", "values", "xLabels", "yLabels", "data"]);
const JSON_SPLICE_RE = /['"]?\}\s*,\s*\{\s*component:?\s*$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function envelopeKeyOf(msg: Record<string, unknown>): (typeof ENVELOPE_KEYS)[number] | undefined {
  const keys = ENVELOPE_KEYS.filter((key) => key in msg);
  return keys.length === 1 ? keys[0] : undefined;
}

function coerceVersion(msg: Record<string, unknown>): void {
  const version = msg.version;
  if (version === "v0.9") return;
  if (version === undefined || version === "0.9" || version === 0.9) {
    msg.version = "v0.9";
  }
}

function pickEnvelope(msg: Record<string, unknown>, key: (typeof ENVELOPE_KEYS)[number]): Record<string, unknown> {
  return { version: "v0.9", [key]: msg[key] };
}

function liftTypedEnvelope(msg: Record<string, unknown>): Record<string, unknown> {
  coerceVersion(msg);
  let key = envelopeKeyOf(msg);
  const typed =
    typeof msg.type === "string" && ENVELOPE_KEYS.includes(msg.type as (typeof ENVELOPE_KEYS)[number])
      ? (msg.type as (typeof ENVELOPE_KEYS)[number])
      : undefined;

  if (key === undefined && typed) {
    if (typed === "createSurface") {
      msg.createSurface = isRecord(msg.createSurface)
        ? msg.createSurface
        : {
            surfaceId: stringProp(msg.surfaceId) ?? "main",
            catalogId: A2UI_CATALOG_ID,
          };
    } else if (typed === "updateComponents") {
      const body = isRecord(msg.updateComponents) ? msg.updateComponents : {};
      if (!Array.isArray(body.components)) body.components = [];
      body.surfaceId = stringProp(body.surfaceId) ?? stringProp(msg.surfaceId) ?? "main";
      msg.updateComponents = body;
    } else if (typed === "updateDataModel") {
      const body = isRecord(msg.updateDataModel) ? msg.updateDataModel : {};
      body.surfaceId = stringProp(body.surfaceId) ?? stringProp(msg.surfaceId) ?? "main";
      msg.updateDataModel = body;
    } else {
      const body = isRecord(msg.deleteSurface) ? msg.deleteSurface : {};
      body.surfaceId = stringProp(body.surfaceId) ?? stringProp(msg.surfaceId) ?? "main";
      msg.deleteSurface = body;
    }
    key = typed;
  }

  if (key === undefined) return msg;
  if (key === "createSurface" && isRecord(msg.createSurface)) {
    if (typeof msg.createSurface.surfaceId !== "string") {
      msg.createSurface.surfaceId = stringProp(msg.createSurface.id) ?? "main";
    }
    if (typeof msg.createSurface.catalogId !== "string") msg.createSurface.catalogId = A2UI_CATALOG_ID;
  }
  return pickEnvelope(msg, key);
}

function stringProp(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function garbledSurfaceId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const [key, item] of Object.entries(value)) {
    if (!/surfaceid$/i.test(key.replace(/[^A-Za-z]/g, ""))) continue;
    const found = stringProp(item);
    if (found) return found;
  }
  return undefined;
}

function inferSurfaceId(messages: unknown[]): string | undefined {
  for (const msg of messages) {
    if (!isRecord(msg)) continue;
    if (isRecord(msg.createSurface)) {
      const id = stringProp(msg.createSurface.surfaceId) ?? stringProp(msg.createSurface.id);
      if (id) return id;
    }
    if (isRecord(msg.updateComponents)) {
      const id = stringProp(msg.updateComponents.surfaceId);
      if (id) return id;
      if (Array.isArray(msg.updateComponents.components)) {
        for (const comp of msg.updateComponents.components) {
          const fromComp = garbledSurfaceId(comp);
          if (fromComp) return fromComp;
        }
      }
    }
    if (isRecord(msg.updateDataModel)) {
      const id = stringProp(msg.updateDataModel.surfaceId);
      if (id) return id;
    }
    if (isRecord(msg.deleteSurface)) {
      const id = stringProp(msg.deleteSurface.surfaceId);
      if (id) return id;
    }
  }
  return undefined;
}

function hasChartPayload(comp: Record<string, unknown>): boolean {
  const kind = typeof comp.kind === "string" ? parseChartKind(comp.kind) : undefined;
  if (kind === "heatmap") {
    return Array.isArray(comp.xLabels) || Array.isArray(comp.yLabels) || Array.isArray(comp.values);
  }
  if (kind !== undefined && kind !== "bar") {
    return Array.isArray(comp.labels) && Array.isArray(comp.values);
  }
  return Array.isArray(comp.labels) && Array.isArray(comp.values);
}

function garbledChartId(comp: Record<string, unknown>): string | undefined {
  for (const [key, value] of Object.entries(comp)) {
    const id = stringProp(value);
    if (!id || key === "id") continue;
    const letters = key.replace(/[^A-Za-z]/g, "").toLowerCase();
    if (letters.includes("chart") && letters.endsWith("id")) return id;
  }
  return undefined;
}

function pickChart(comp: Record<string, unknown>, id: string): Record<string, unknown> {
  const chart: Record<string, unknown> = { id, component: "Chart" };
  for (const key of CHART_KEYS) {
    if (key === "id" || key === "component") continue;
    if (key in comp) chart[key] = comp[key];
  }
  return chart;
}

function cleanText(comp: Record<string, unknown>): void {
  if (typeof comp.text !== "string") return;
  comp.text = comp.text.replace(JSON_SPLICE_RE, "").trimEnd();
}

function stripToKeys(comp: Record<string, unknown>, allowed: Set<string>): void {
  for (const key of Object.keys(comp)) {
    if (!allowed.has(key)) delete comp[key];
  }
}

function splitFusedCharts(components: unknown[]): unknown[] {
  const list = components.filter(isRecord);
  const ids = new Set(
    list.map((comp) => (typeof comp.id === "string" ? comp.id : "")).filter((id) => id.length > 0),
  );
  const missingChildren: string[] = [];
  for (const comp of list) {
    if (!Array.isArray(comp.children)) continue;
    for (const child of comp.children) {
      if (typeof child === "string" && child.length > 0 && !ids.has(child)) {
        missingChildren.push(child);
      }
    }
  }

  const extra: Record<string, unknown>[] = [];
  for (const comp of list) {
    const componentName = typeof comp.component === "string" ? comp.component : "";
    if (componentName === "Chart" || !hasChartPayload(comp)) {
      if (componentName === "Text") cleanText(comp);
      continue;
    }
    const chartId =
      garbledChartId(comp) ??
      missingChildren.find((id) => !list.some((item) => item.id === id) && !extra.some((item) => item.id === id));
    const chart = chartId ? pickChart(comp, chartId) : undefined;
    cleanText(comp);
    if (componentName === "Text") {
      stripToKeys(comp, TEXT_KEYS);
    } else {
      for (const key of ["kind", "labels", "values", "xLabels", "yLabels"]) {
        delete comp[key];
      }
      for (const key of Object.keys(comp)) {
        if (/surfaceid$/i.test(key.replace(/[^A-Za-z]/g, "")) || /version$/i.test(key.replace(/[^A-Za-z]/g, ""))) {
          delete comp[key];
        }
      }
    }
    if (!chart || !chartId) continue;
    const already = list.some((item) => item.id === chartId && item.component === "Chart");
    if (already || extra.some((item) => item.id === chartId)) continue;
    extra.push(chart);
    ids.add(chartId);
  }
  return extra.length === 0 ? list : [...list, ...extra];
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function coerceHeatmapValues(values: unknown): number[][] | undefined {
  if (!Array.isArray(values)) return undefined;
  const rows: number[][] = [];
  for (const row of values) {
    if (!Array.isArray(row)) return undefined;
    const cells: number[] = [];
    for (const cell of row) {
      const n = asFiniteNumber(cell);
      if (n === undefined) return undefined;
      cells.push(n);
    }
    rows.push(cells);
  }
  return rows;
}

function heatMatrixFromTable(comp: Record<string, unknown>): Record<string, unknown> | undefined {
  if (comp.component !== "DataTable") return undefined;
  const headers = comp.headers;
  const rows = comp.rows;
  if (!Array.isArray(headers) || headers.length < 3 || !headers.every((h) => typeof h === "string")) {
    return undefined;
  }
  if (!Array.isArray(rows) || rows.length < 2) return undefined;
  const xLabels = headers.slice(1);
  const yLabels: string[] = [];
  const values: number[][] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== headers.length) return undefined;
    const y = row[0];
    if (typeof y !== "string" || y.length === 0) return undefined;
    const cells: number[] = [];
    for (let i = 1; i < row.length; i++) {
      const n = asFiniteNumber(row[i]);
      if (n === undefined) return undefined;
      cells.push(n);
    }
    yLabels.push(y);
    values.push(cells);
  }
  if (xLabels.length < 2) return undefined;
  return {
    id: comp.id,
    component: "Chart",
    kind: "heatmap",
    xLabels,
    yLabels,
    values,
  };
}

function axisLabels(count: number, prefix: string, existing: unknown): string[] | undefined {
  if (Array.isArray(existing) && existing.length === count && existing.every((item) => typeof item === "string" && item.length > 0 && item.length <= 80)) {
    return existing as string[];
  }
  if (count < 1 || count > 24) return undefined;
  return Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
}

function fillHeatmapAxes(comp: Record<string, unknown>): void {
  const matrix = coerceHeatmapValues(comp.values);
  if (!matrix || matrix.length === 0) return;
  const cols = matrix[0]?.length ?? 0;
  if (cols < 1 || matrix.some((row) => row.length !== cols)) return;
  comp.values = matrix;
  if (!Array.isArray(comp.xLabels)) {
    const fromLabels = Array.isArray(comp.labels) ? comp.labels : undefined;
    const xLabels = axisLabels(cols, "X", fromLabels);
    if (xLabels) comp.xLabels = xLabels;
  }
  if (!Array.isArray(comp.yLabels)) {
    const yLabels = axisLabels(matrix.length, "Y", undefined);
    if (yLabels) comp.yLabels = yLabels;
  }
}

function normalizeChartFields(comp: Record<string, unknown>): void {
  if (comp.component !== "Chart") return;
  if (typeof comp.kind !== "string") {
    if (typeof comp.chartType === "string") {
      comp.kind = comp.chartType;
    } else if (typeof comp.type === "string" && parseChartKind(comp.type) !== undefined) {
      comp.kind = comp.type;
    }
  }
  const kind = typeof comp.kind === "string" ? parseChartKind(comp.kind) : undefined;
  if (kind === "heatmap") {
    fillHeatmapAxes(comp);
  }
}

const DASHBOARD_TYPE_TO_COMPONENT: Record<string, string> = {
  card: "Text",
  metric: "Text",
  chart: "Chart",
  table: "DataTable",
  datatable: "DataTable",
};

function joinCardText(content: Record<string, unknown>): string | undefined {
  const parts = [content.title, content.value, content.subValue].filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  return parts.length > 0 ? parts.join("  ") : undefined;
}

function firstSeriesValues(data: Record<string, unknown>): unknown[] | undefined {
  if (!Array.isArray(data.series)) return undefined;
  for (const item of data.series) {
    if (isRecord(item) && Array.isArray(item.data)) return item.data;
  }
  return undefined;
}

function coerceDashboardComponent(comp: Record<string, unknown>): Record<string, unknown> {
  if (typeof comp.component !== "string" && typeof comp.type === "string") {
    const mapped = DASHBOARD_TYPE_TO_COMPONENT[comp.type.toLowerCase()];
    if (mapped) comp.component = mapped;
  }
  if (comp.component === "Text" && typeof comp.text !== "string" && isRecord(comp.content)) {
    const text = joinCardText(comp.content);
    if (text !== undefined) comp.text = text;
  }
  if (comp.component === "Chart" && isRecord(comp.data)) {
    if (!Array.isArray(comp.labels) && Array.isArray(comp.data.categories)) {
      comp.labels = comp.data.categories;
    }
    if (!Array.isArray(comp.labels) && Array.isArray(comp.data.labels)) {
      comp.labels = comp.data.labels;
    }
    if (!Array.isArray(comp.values)) {
      const fromSeries = firstSeriesValues(comp.data);
      if (fromSeries) comp.values = fromSeries;
      else if (Array.isArray(comp.data.values)) comp.values = comp.data.values;
    }
  }
  if (comp.component === "DataTable" && isRecord(comp.data)) {
    if (!Array.isArray(comp.headers) && Array.isArray(comp.data.headers)) {
      comp.headers = comp.data.headers;
    }
    if (!Array.isArray(comp.rows) && Array.isArray(comp.data.rows)) {
      comp.rows = comp.data.rows;
    }
  }
  return comp;
}

function normalizeComponents(components: unknown[]): unknown[] {
  const coerced = components.map((item) => (isRecord(item) ? coerceDashboardComponent(item) : item));
  const split = splitFusedCharts(coerced);
  return split.map((item) => {
    if (!isRecord(item)) return item;
    normalizeChartFields(item);
    return heatMatrixFromTable(item) ?? item;
  });
}

function isDashboardType(value: unknown): boolean {
  return typeof value === "string" && DASHBOARD_TYPE_TO_COMPONENT[value.toLowerCase()] !== undefined;
}

function ensureRoot(messages: unknown[]): void {
  const ids: string[] = [];
  const seen = new Set<string>();
  let firstUpdate: Record<string, unknown> | undefined;
  let dashboard = false;
  for (const msg of messages) {
    if (!isRecord(msg) || !isRecord(msg.updateComponents) || !Array.isArray(msg.updateComponents.components)) {
      continue;
    }
    if (!firstUpdate) firstUpdate = msg.updateComponents;
    for (const comp of msg.updateComponents.components) {
      if (!isRecord(comp)) continue;
      if (isDashboardType(comp.type)) dashboard = true;
      if (typeof comp.id !== "string" || comp.id.length === 0 || seen.has(comp.id)) continue;
      seen.add(comp.id);
      ids.push(comp.id);
    }
  }
  if (!dashboard || !firstUpdate || seen.has("root") || ids.length === 0) return;
  const components = firstUpdate.components;
  if (!Array.isArray(components)) return;
  components.unshift({ id: "root", component: "Column", children: ids });
}

function normalizeMessage(msg: unknown, surfaceId: string | undefined): unknown {
  if (!isRecord(msg)) return msg;
  const key = envelopeKeyOf(msg);
  if (key === undefined) return msg;
  coerceVersion(msg);
  if (key === "updateComponents" && isRecord(msg.updateComponents)) {
    if (surfaceId !== undefined && typeof msg.updateComponents.surfaceId !== "string") {
      msg.updateComponents.surfaceId = surfaceId;
    }
    if (Array.isArray(msg.updateComponents.components)) {
      msg.updateComponents.components = normalizeComponents(msg.updateComponents.components);
    }
  }
  if (key === "updateDataModel" && isRecord(msg.updateDataModel)) {
    if (surfaceId !== undefined && typeof msg.updateDataModel.surfaceId !== "string") {
      msg.updateDataModel.surfaceId = surfaceId;
    }
  }
  if (key === "deleteSurface" && isRecord(msg.deleteSurface)) {
    if (surfaceId !== undefined && typeof msg.deleteSurface.surfaceId !== "string") {
      msg.deleteSurface.surfaceId = surfaceId;
    }
  }
  return msg;
}

export function normalizeEmitMessages(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  let clone: unknown[];
  try {
    clone = cloneJson(raw);
  } catch {
    return raw;
  }
  const lifted = clone.map((msg) => (isRecord(msg) ? liftTypedEnvelope(msg) : msg));
  const surfaceId = inferSurfaceId(lifted) ?? "main";
  const normalized = lifted.map((msg) => normalizeMessage(msg, surfaceId));
  ensureRoot(normalized);
  return normalized;
}
