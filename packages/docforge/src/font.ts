import { fileURLToPath } from "node:url";
import { join } from "node:path";

export function defaultFontPath(): string {
  return join(fileURLToPath(new URL("./../fonts/NotoSansSC-Regular.otf", import.meta.url)));
}
