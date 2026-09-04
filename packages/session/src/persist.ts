import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SessionEvent } from "./events.ts";

export function sessionFileName(sessionId: string): string {
  return `${Buffer.from(sessionId, "utf8").toString("base64url")}.jsonl`;
}

export function sessionFilePath(sessionsDir: string, sessionId: string): string {
  return join(sessionsDir, sessionFileName(sessionId));
}

export function ensureSessionsDir(sessionsDir: string): void {
  mkdirSync(sessionsDir, { recursive: true });
}

export function loadSessionEvents(filePath: string): SessionEvent[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const raw = readFileSync(filePath, "utf8");
  if (raw.length === 0) {
    return [];
  }
  const events: SessionEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      events.push(JSON.parse(trimmed) as SessionEvent);
    } catch {
      continue;
    }
  }
  return events;
}

export function appendSessionEvent(filePath: string, event: SessionEvent): void {
  ensureSessionsDir(dirname(filePath));
  appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
}
