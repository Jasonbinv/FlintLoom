import type { ChangeEvent, ReactNode } from "react";

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

function renderComp(
  id: string,
  map: Map<string, Comp>,
  interactive: boolean,
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
              {renderComp(childId, map, interactive, onAction, hasButton)}
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
              {renderComp(childId, map, interactive, onAction, hasButton)}
            </div>
          ))}
        </div>
      );
    }
    case "Text":
      return <span>{typeof comp.text === "string" ? comp.text : ""}</span>;
    case "Markdown":
      return <pre>{typeof comp.text === "string" ? comp.text : ""}</pre>;
    case "Button": {
      const name = actionName(comp);
      const childId = typeof comp.child === "string" ? comp.child : undefined;
      return (
        <button
          type="button"
          disabled={!interactive}
          onClick={() => {
            if (name) onAction(name);
          }}
        >
          {childId ? renderComp(childId, map, interactive, onAction, hasButton) : null}
        </button>
      );
    }
    case "ChoicePicker": {
      const options = choiceOptions(comp);
      return (
        <select
          disabled={!interactive}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => {
            if (interactive && !hasButton) {
              onAction("choice", { value: event.target.value });
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
  const map = collectComponents(messages);
  const hasButton = [...map.values()].some((c) => c.component === "Button");
  return <>{renderComp("root", map, interactive, onAction, hasButton)}</>;
}
