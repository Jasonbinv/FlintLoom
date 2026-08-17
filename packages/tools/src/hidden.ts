import { extname } from "node:path";

const HIDDEN_NAMES = new Set([".git", "node_modules", "dist", "credentials"]);

function isHiddenName(name: string): boolean {
  if (HIDDEN_NAMES.has(name)) {
    return true;
  }
  if (/^\.env(?!\.example$)/.test(name)) {
    return true;
  }
  if (extname(name) === ".env") {
    return true;
  }
  return false;
}

export function isHiddenRelPath(relPath: string): boolean {
  const normalized = relPath.replaceAll("\\", "/");
  for (const segment of normalized.split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }
    if (isHiddenName(segment)) {
      return true;
    }
  }
  return false;
}
