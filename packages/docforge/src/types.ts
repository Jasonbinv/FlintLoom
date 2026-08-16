export type DocType =
  | "md"
  | "html"
  | "pdf"
  | "docx"
  | "pptx"
  | "xlsx"
  | "unknown";

export type ProbeResult = {
  type: DocType;
  pages?: number;
  parseable: boolean;
  reason?: string;
};
