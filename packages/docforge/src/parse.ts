import { readFile } from "node:fs/promises";
import { detectType } from "./detect.ts";
import { parseDocx } from "./parsers/docx.ts";
import { parseHtml } from "./parsers/html.ts";
import { parseMd } from "./parsers/md.ts";
import { parsePdf } from "./parsers/pdf.ts";
import { parsePptx } from "./parsers/pptx.ts";
import { parseXlsx } from "./parsers/xlsx.ts";
import { truncateOutput } from "./truncate.ts";

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

export async function parse(absPath: string): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = await readFile(absPath);
  } catch (err) {
    if (isNotFound(err)) {
      return "failed: not found";
    }
    return "failed: unreadable";
  }

  const type = detectType(absPath, bytes);
  let body: string;
  try {
    switch (type) {
      case "md":
        body = await parseMd(absPath);
        break;
      case "html":
        body = await parseHtml(absPath);
        break;
      case "pdf": {
        const pdf = await parsePdf(absPath);
        body = pdf.markdown;
        break;
      }
      case "docx":
        body = await parseDocx(absPath);
        break;
      case "pptx": {
        const pptx = await parsePptx(absPath);
        body = pptx.markdown;
        break;
      }
      case "xlsx": {
        const xlsx = await parseXlsx(absPath);
        body = xlsx.markdown;
        break;
      }
      case "unknown":
        return "failed: unsupported type";
      default:
        return "failed: unreadable";
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/password|encrypt/i.test(message)) {
      return "failed: encrypted";
    }
    return "failed: unreadable";
  }

  const trimmed = body.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) {
    return "failed: empty text";
  }
  return truncateOutput(body);
}
