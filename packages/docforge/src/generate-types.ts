export const GENERATE_MAX_CHARS = 200_000;
export const GENERATE_MAX_BYTES = 800_000;

export type GenerateFormat = "md" | "html" | "docx" | "pdf" | "xlsx" | "pptx";

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; text: string }
  | { type: "table"; headers: string[]; rows: string[][] };
