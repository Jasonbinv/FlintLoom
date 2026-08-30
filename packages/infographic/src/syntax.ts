import { INFOGRAPHIC_MAX_BYTES } from "./types.ts";

export { INFOGRAPHIC_MAX_BYTES } from "./types.ts";

function fail(message: string): never {
  throw new Error(message);
}

export function parseAntvSyntax(raw: string): string {
  if (Buffer.byteLength(raw, "utf8") > INFOGRAPHIC_MAX_BYTES) {
    fail("too large");
  }
  if (raw.includes("http://") || raw.includes("https://")) {
    fail("remote url");
  }
  const text = raw.trim();
  if (!/^\s*infographic\b/i.test(text)) {
    fail("bad syntax");
  }
  return text;
}