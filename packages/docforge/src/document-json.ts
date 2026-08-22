import type { Block } from "./generate-types.ts";

function unreadable(): Error {
  return new Error("unreadable");
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseHeadingLevel(value: unknown): 1 | 2 | 3 | 4 | 5 | 6 {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 6) {
    throw unreadable();
  }
  return value as 1 | 2 | 3 | 4 | 5 | 6;
}

function parseBlock(value: unknown): Block {
  if (value === null || typeof value !== "object") {
    throw unreadable();
  }
  const obj = value as Record<string, unknown>;
  const type = obj.type;
  switch (type) {
    case "heading":
      if (!isString(obj.text)) {
        throw unreadable();
      }
      return { type: "heading", level: parseHeadingLevel(obj.level), text: obj.text };
    case "paragraph":
      if (!isString(obj.text)) {
        throw unreadable();
      }
      return { type: "paragraph", text: obj.text };
    case "list":
      if (typeof obj.ordered !== "boolean" || !isStringArray(obj.items)) {
        throw unreadable();
      }
      return { type: "list", ordered: obj.ordered, items: obj.items };
    case "code":
      if (!isString(obj.text)) {
        throw unreadable();
      }
      return { type: "code", text: obj.text };
    case "table":
      if (!isStringArray(obj.headers) || !Array.isArray(obj.rows)) {
        throw unreadable();
      }
      const rows: string[][] = [];
      for (const row of obj.rows) {
        if (!isStringArray(row)) {
          throw unreadable();
        }
        rows.push(row);
      }
      return { type: "table", headers: obj.headers, rows };
    default:
      throw unreadable();
  }
}

function parseTableShorthand(obj: Record<string, unknown>): Block[] {
  if (!isStringArray(obj.headers) || !Array.isArray(obj.rows)) {
    throw unreadable();
  }
  const rows: string[][] = [];
  for (const row of obj.rows) {
    if (!isStringArray(row)) {
      throw unreadable();
    }
    rows.push(row);
  }
  return [{ type: "table", headers: obj.headers, rows }];
}

export function parseDocumentJson(text: string): Block[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw unreadable();
  }
  if (data === null || typeof data !== "object") {
    throw unreadable();
  }
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.blocks)) {
    return obj.blocks.map((block) => parseBlock(block));
  }
  if ("headers" in obj && "rows" in obj) {
    return parseTableShorthand(obj);
  }
  throw unreadable();
}
