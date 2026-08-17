import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Session } from "@flintloom/session";
import { cancelWaitingTurn } from "../src/a2ui.ts";
import { loadOrCreateToken, startHost } from "../src/index.ts";

// LLM pause/continue is covered by packages/loop; this file covers host HTTP 401/404 and waiting cancel.

describe("a2ui HTTP", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    if (close) {
      await close();
      close = undefined;
    }
  });

  it("cancelWaitingTurn appends turn/end cancelled", () => {
    const session = new Session("s");
    session.append({ type: "turn/start", turnId: "t1" });
    session.append({
      type: "a2ui/surface",
      turnId: "t1",
      surfaceId: "main",
      wait: true,
      messages: [],
    });
    expect(cancelWaitingTurn(session, "t1")).toBe(true);
    expect(session.events().some((e) => e.type === "turn/end" && e.status === "cancelled")).toBe(true);
    expect(cancelWaitingTurn(session, "t1")).toBe(false);
  });

  it("returns 401 without bearer and 404 when a2ui plugin omitted", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-a2ui-http-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-a2ui-http-home-"));
    writeFileSync(
      join(workspaceRoot, "flintloom.yml"),
      `plugins:
  - id: models
    name: "@flintloom/models"
  - id: tools
    name: "@flintloom/tools"
  - id: session
    name: "@flintloom/session"
  - id: models-chat
    name: "@flintloom/models-chat"
  - id: loop
    name: "@flintloom/loop"
`,
    );
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const unauth = await fetch(`${host.url}/v1/turns/t1/actions`, { method: "POST" });
    expect(unauth.status).toBe(401);
    const token = loadOrCreateToken(homeDir);
    const res = await fetch(`${host.url}/v1/turns/t1/actions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ surfaceId: "main", name: "confirm" }),
    });
    expect(res.status).toBe(404);
  });
});
