import { randomBytes } from "node:crypto";
import { existsSync, renameSync, rmSync, writeFileSync } from "node:fs";

function hex8(): string {
  return randomBytes(8).toString("hex");
}

function rmIfExists(p: string): void {
  rmSync(p, { recursive: true, force: true });
}

export function replaceYmlAtomic(ymlPath: string, dumped: string): void {
  const hex = hex8();
  const tmp = `${ymlPath}.${hex}.tmp`;
  const bak = `${ymlPath}.bak-${hex}`;
  writeFileSync(tmp, dumped);
  if (!existsSync(ymlPath)) {
    try {
      renameSync(tmp, ymlPath);
    } catch (err) {
      rmIfExists(tmp);
      throw err;
    }
    return;
  }
  try {
    renameSync(ymlPath, bak);
    try {
      renameSync(tmp, ymlPath);
    } catch (err) {
      try {
        renameSync(bak, ymlPath);
      } catch {
        // keep bak for recovery; still throw original
      }
      throw err;
    }
  } catch (err) {
    rmIfExists(tmp);
    throw err;
  }
  try {
    rmIfExists(bak);
  } catch {
    // best-effort after yml replace succeeded
  }
}
