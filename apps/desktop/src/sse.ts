import type { WorkbenchEvent } from "./types.ts";

export type { TurnEnd, WorkbenchEvent } from "./types.ts";

export function parseSseBuffer(buffer: string): {
  events: WorkbenchEvent[];
  rest: string;
} {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: WorkbenchEvent[] = [];

  for (const block of parts) {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice("data: ".length);
      try {
        events.push(JSON.parse(payload) as WorkbenchEvent);
      } catch {
        // skip malformed data lines
      }
    }
  }

  return { events, rest };
}
