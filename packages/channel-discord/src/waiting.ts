import type { Session } from "@flintloom/session";

export function sessionHasWaitingTurn(session: Session): boolean {
  const ids = new Set<string>();
  for (const event of session.events()) {
    if (event.type === "turn/start") {
      ids.add(event.turnId);
    }
  }
  for (const turnId of ids) {
    if (session.isWaiting(turnId)) {
      return true;
    }
  }
  return false;
}
