export const A2UI_CATALOG_ID = "flintloom:a2ui:core";

export type A2uiMessage =
  | { version: "v0.9"; createSurface: { surfaceId: string; catalogId: string; theme?: unknown; sendDataModel?: boolean } }
  | { version: "v0.9"; updateComponents: { surfaceId: string; components: A2uiComponent[] } }
  | { version: "v0.9"; updateDataModel: { surfaceId: string; path?: string; value?: unknown } }
  | { version: "v0.9"; deleteSurface: { surfaceId: string } };

export type A2uiComponent = {
  id: string;
  component:
    | "Column"
    | "Row"
    | "Text"
    | "Markdown"
    | "Button"
    | "ChoicePicker"
    | "DataTable"
    | "Chart"
    | "Infographic";
  [key: string]: unknown;
};

export type A2uiAction = {
  surfaceId: string;
  name: string;
  context?: unknown;
  data?: unknown;
};

export type A2uiEmitSnapshot = {
  emitId: string;
  surfaceId: string;
  wait: boolean;
  messages: A2uiMessage[];
};

export type A2uiService = {
  validateEmit(messages: unknown): A2uiEmitSnapshot;
  takeEmit(emitId: string): A2uiEmitSnapshot | undefined;
  validateAction(action: A2uiAction, messages: unknown[]): void;
};
