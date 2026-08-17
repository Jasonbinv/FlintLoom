import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";

type A2uiSurfaceProps = {
  messages: unknown[];
  interactive: boolean;
  onAction: (name: string, data?: unknown) => void;
};

type Comp = {
  id: string;
  component: string;
  children?: unknown;
  child?: unknown;
  text?: unknown;
  value?: unknown;
  action?: unknown;
  options?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectComponents(messages: unknown[]): Map<string, Comp> {
  const map = new Map<string, Comp>();
  for (const msg of messages) {
    if (!isRecord(msg) || !isRecord(msg.updateComponents)) continue;
    const components = msg.updateComponents.components;
    if (!Array.isArray(components)) continue;
    for (const item of components) {
      if (
        !isRecord(item) ||
        typeof item.id !== "string" ||
        typeof item.component !== "string"
      ) {
        continue;
      }
      map.set(item.id, item as Comp);
    }
  }
  return map;
}

function bindingPath(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.path !== "string") return undefined;
  if (Object.keys(value).length !== 1) return undefined;
  return value.path;
}

function setAtPath(root: unknown, path: string, value: unknown): unknown {
  if (path === "/" || path === "") return value;
  const segs = path.split("/").filter((s) => s.length > 0);
  const nextRoot: Record<string, unknown> = isRecord(root) ? { ...root } : {};
  let cursor = nextRoot;
  for (let i = 0; i < segs.length - 1; i++) {
    const key = segs[i]!;
    const child = isRecord(cursor[key]) ? { ...cursor[key] } : {};
    cursor[key] = child;
    cursor = child;
  }
  const last = segs[segs.length - 1];
  if (last !== undefined) cursor[last] = value;
  return nextRoot;
}

function getAtPath(root: unknown, path: string): unknown {
  if (path === "/" || path === "") return root;
  const segs = path.split("/").filter((s) => s.length > 0);
  let cursor: unknown = root;
  for (const key of segs) {
    if (!isRecord(cursor) || !(key in cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

function applyDataModel(messages: unknown[]): unknown {
  let model: unknown = {};
  for (const msg of messages) {
    if (!isRecord(msg) || !isRecord(msg.updateDataModel)) continue;
    const path = typeof msg.updateDataModel.path === "string" ? msg.updateDataModel.path : "/";
    model = setAtPath(model, path, msg.updateDataModel.value);
  }
  return model;
}

function actionName(comp: Comp): string | undefined {
  if (!isRecord(comp.action)) return undefined;
  const event = comp.action.event;
  if (!isRecord(event) || typeof event.name !== "string") return undefined;
  return event.name;
}

function choiceOptions(comp: Comp): { label: string; value: string }[] {
  if (!Array.isArray(comp.options)) return [];
  const out: { label: string; value: string }[] = [];
  for (const item of comp.options) {
    if (!isRecord(item) || typeof item.label !== "string" || typeof item.value !== "string") {
      continue;
    }
    out.push({ label: item.label, value: item.value });
  }
  return out;
}

function boundText(text: unknown, model: unknown): string {
  if (typeof text === "string") return text;
  const path = bindingPath(text);
  if (!path) return "";
  const value = getAtPath(model, path);
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function pickerSelected(comp: Comp, model: unknown): string {
  const options = choiceOptions(comp);
  const fallback = options[0]?.value ?? "";
  const path = bindingPath(comp.value);
  if (path) {
    const bound = getAtPath(model, path);
    return typeof bound === "string" ? bound : fallback;
  }
  if (typeof comp.value === "string") {
    const fromModel = isRecord(model) ? model[comp.id] : undefined;
    return typeof fromModel === "string" ? fromModel : comp.value;
  }
  const fromModel = isRecord(model) ? model[comp.id] : undefined;
  return typeof fromModel === "string" ? fromModel : fallback;
}

function applyPickerValue(model: unknown, comp: Comp, value: string): unknown {
  const path = bindingPath(comp.value);
  if (path) return setAtPath(model, path, value);
  const next: Record<string, unknown> = isRecord(model) ? { ...model } : {};
  next[comp.id] = value;
  return next;
}

function seedModel(messages: unknown[], map: Map<string, Comp>): unknown {
  let model = applyDataModel(messages);
  for (const comp of map.values()) {
    if (comp.component !== "ChoicePicker") continue;
    const selected = pickerSelected(comp, model);
    model = applyPickerValue(model, comp, selected);
  }
  return model;
}

function walkReachable(map: Map<string, Comp>): Comp[] {
  const out: Comp[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    const comp = map.get(id);
    if (!comp) return;
    seen.add(id);
    out.push(comp);
    if (comp.component === "Column" || comp.component === "Row") {
      const children = Array.isArray(comp.children)
        ? comp.children.filter((c): c is string => typeof c === "string")
        : [];
      for (const childId of children) walk(childId);
    } else if (comp.component === "Button" && typeof comp.child === "string") {
      walk(comp.child);
    }
  };
  walk("root");
  return out;
}

function renderComp(
  id: string,
  map: Map<string, Comp>,
  interactive: boolean,
  model: unknown,
  setModel: (next: unknown) => void,
  onAction: (name: string, data?: unknown) => void,
  hasButton: boolean,
): ReactNode {
  const comp = map.get(id);
  if (!comp) return null;

  switch (comp.component) {
    case "Column": {
      const children = Array.isArray(comp.children)
        ? comp.children.filter((c): c is string => typeof c === "string")
        : [];
      return (
        <div className="a2ui-column">
          {children.map((childId) => (
            <div key={childId}>
              {renderComp(childId, map, interactive, model, setModel, onAction, hasButton)}
            </div>
          ))}
        </div>
      );
    }
    case "Row": {
      const children = Array.isArray(comp.children)
        ? comp.children.filter((c): c is string => typeof c === "string")
        : [];
      return (
        <div className="a2ui-row">
          {children.map((childId) => (
            <div key={childId}>
              {renderComp(childId, map, interactive, model, setModel, onAction, hasButton)}
            </div>
          ))}
        </div>
      );
    }
    case "Text":
      return <span>{boundText(comp.text, model)}</span>;
    case "Markdown":
      return <pre>{boundText(comp.text, model)}</pre>;
    case "Button": {
      const name = actionName(comp);
      const childId = typeof comp.child === "string" ? comp.child : undefined;
      return (
        <button
          type="button"
          disabled={!interactive}
          onClick={() => {
            if (name) onAction(name, model);
          }}
        >
          {childId ? renderComp(childId, map, interactive, model, setModel, onAction, hasButton) : null}
        </button>
      );
    }
    case "ChoicePicker": {
      const options = choiceOptions(comp);
      const selected = pickerSelected(comp, model);
      return (
        <select
          disabled={!interactive}
          value={selected}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => {
            const next = applyPickerValue(model, comp, event.target.value);
            setModel(next);
            if (interactive && !hasButton) {
              onAction("choice", next);
            }
          }}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    }
    default:
      return null;
  }
}

export function A2uiSurface({ messages, interactive, onAction }: A2uiSurfaceProps) {
  const map = useMemo(() => collectComponents(messages), [messages]);
  const reachable = useMemo(() => walkReachable(map), [map]);
  const hasButton = reachable.some((c) => c.component === "Button");
  const hasChoicePicker = reachable.some((c) => c.component === "ChoicePicker");
  const [model, setModel] = useState(() => seedModel(messages, map));
  const modelRef = useRef(model);
  const onActionRef = useRef(onAction);
  const postedMessages = useRef<unknown>(null);

  modelRef.current = model;
  onActionRef.current = onAction;

  useEffect(() => {
    setModel(seedModel(messages, map));
  }, [messages, map]);

  useEffect(() => {
    if (!interactive || hasButton || !hasChoicePicker) return;
    if (postedMessages.current === messages) return;
    postedMessages.current = messages;
    onActionRef.current("choice", modelRef.current);
  }, [interactive, hasButton, hasChoicePicker, messages]);

  return <>{renderComp("root", map, interactive, model, setModel, onAction, hasButton)}</>;
}
