import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatProvider } from "@flintloom/models";
import type { ModelRegistry } from "@flintloom/models";
import { sessionFilePath } from "@flintloom/session";
import { loadOrCreateToken, startHost } from "../src/index.ts";
import { workspaceSessionsDir } from "../src/sessionsDir.ts";
import { writeAssembly } from "./assembly.ts";

function textChat(text: string): ChatProvider {
  return {
    async *stream() {
      yield { type: "text", text };
    },
  };
}

describe("session persistence", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) {
      await close();
      close = undefined;
    }
  });

  it("reloads session log after host restart", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-persist-ws-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-persist-home-"));
    writeAssembly(workspaceRoot);

    const host1 = await startHost({ workspaceRoot, homeDir, port: 0 });
    const token = loadOrCreateToken(homeDir);
    const models = host1.runtime.ctx.require<ModelRegistry>("models");
    models.registerChat("fake", textChat("hello back"));
    models.setDefault("chat", "fake");

    const res = await fetch(`${host1.url}/v1/hooks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "remember this", sessionId: "persist-me" }),
    });
    expect(res.status).toBe(200);
    const hookBody = (await res.json()) as { status: string; text: string };
    expect(hookBody.status).toBe("ok");
    expect(hookBody.text).toBe("hello back");

    const sessionsDir = workspaceSessionsDir(homeDir, workspaceRoot);
    expect(sessionFilePath(sessionsDir, "persist-me")).toBeTruthy();

    await host1.close();

    const host2 = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host2.close;
    const session = await fetch(`${host2.url}/v1/sessions/persist-me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(session.status).toBe(200);
    const body = (await session.json()) as {
      events: { type: string; text?: string }[];
    };
    expect(
      body.events.some(
        (event) => event.type === "user/message" && event.text === "remember this",
      ),
    ).toBe(true);
    expect(body.events.some((event) => event.type === "assistant/message")).toBe(true);
  });
});
