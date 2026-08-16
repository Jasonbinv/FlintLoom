import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadOrCreateToken, startHost } from "../src/index.ts";

describe("startHost", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) {
      await close();
      close = undefined;
    }
  });

  it("rejects /v1/models without a token and returns chat snapshot with one", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-ws-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));

    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;

    const unauth = await fetch(`${host.url}/v1/models`);
    expect(unauth.status).toBe(401);

    const token = loadOrCreateToken(homeDir);
    const auth = await fetch(`${host.url}/v1/models`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(auth.status).toBe(200);
    const body = (await auth.json()) as { kind: string }[];
    expect(body.some((row) => row.kind === "chat")).toBe(true);
  });
});
