import { readFile } from "node:fs/promises";

export async function parseMd(absPath: string): Promise<string> {
  const raw = await readFile(absPath, "utf8");
  return raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
}
