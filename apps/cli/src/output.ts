import type { SessionEvent } from "@flintloom/session";

export function formatCliOutput(
  events: readonly SessionEvent[],
  status: string,
): { stdout: string; stderr: string } {
  if (status === "ok") {
    let lastAssistant: string | undefined;
    for (const event of events) {
      if (event.type === "assistant/message") {
        lastAssistant = event.text;
      }
    }
    return {
      stdout: lastAssistant !== undefined ? `${lastAssistant}\n` : "",
      stderr: "",
    };
  }

  let lastError: string | undefined;
  for (const event of events) {
    if (event.type === "model/error") {
      lastError = event.message;
    }
  }
  return {
    stdout: "",
    stderr: `${lastError ?? status}\n`,
  };
}
