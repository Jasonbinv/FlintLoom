import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ModelRegistry } from "@flintloom/models";
import { Session } from "@flintloom/session";
import { createRuntime, loadOrCreateToken, startHost } from "../src/index.ts";

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

  it("rejects start when flintloom.yml exists but is invalid", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-badyml-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
    writeFileSync(join(workspaceRoot, "flintloom.yml"), "foo: 1\n");

    expect(() => createRuntime(workspaceRoot, homeDir)).toThrow(/plugins/);
    await expect(startHost({ workspaceRoot, homeDir, port: 0 })).rejects.toThrow(
      /plugins/,
    );
  });

  it("returns 500 text/plain with the error message and redacts the api key", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-ws-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);

    const original = ModelRegistry.prototype.snapshot;
    const previousKey = process.env.FLINTLOOM_API_KEY;
    process.env.FLINTLOOM_API_KEY = "sk-test-secret";
    ModelRegistry.prototype.snapshot = () => {
      throw new Error("upstream sk-test-secret failed");
    };
    try {
      const res = await fetch(`${host.url}/v1/models`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(500);
      expect(res.headers.get("content-type")).toMatch(/text\/plain/);
      const text = await res.text();
      expect(text).toContain("upstream");
      expect(text).toContain("failed");
      expect(text).not.toContain("sk-test-secret");
    } finally {
      ModelRegistry.prototype.snapshot = original;
      if (previousKey === undefined) {
        delete process.env.FLINTLOOM_API_KEY;
      } else {
        process.env.FLINTLOOM_API_KEY = previousKey;
      }
    }
  });

  it("returns 500 text/plain internal error when the thrown message is empty", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-ws-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);

    const original = ModelRegistry.prototype.snapshot;
    ModelRegistry.prototype.snapshot = () => {
      throw new Error("");
    };
    try {
      const res = await fetch(`${host.url}/v1/models`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(500);
      expect(res.headers.get("content-type")).toMatch(/text\/plain/);
      expect(await res.text()).toBe("internal error");
    } finally {
      ModelRegistry.prototype.snapshot = original;
    }
  });

  it("returns 500 text/plain and redacts credentials chatApiKey", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-ws-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
    mkdirSync(join(homeDir, ".flintloom"), { recursive: true });
    writeFileSync(
      join(homeDir, ".flintloom", "credentials"),
      JSON.stringify({ chatApiKey: "sk-cred-secret" }),
    );

    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);

    const original = ModelRegistry.prototype.snapshot;
    ModelRegistry.prototype.snapshot = () => {
      throw new Error("upstream sk-cred-secret failed");
    };
    try {
      const res = await fetch(`${host.url}/v1/models`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(500);
      expect(res.headers.get("content-type")).toMatch(/text\/plain/);
      const text = await res.text();
      expect(text).toContain("upstream");
      expect(text).toContain("failed");
      expect(text).not.toContain("sk-cred-secret");
    } finally {
      ModelRegistry.prototype.snapshot = original;
    }
  });

  it("writes SSE end failed when runTurn throws after stream headers", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-ws-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);

    const original = Session.prototype.append;
    Session.prototype.append = () => {
      throw new Error("append-fail");
    };
    try {
      const res = await fetch(`${host.url}/v1/turns`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId: "s1", text: "hi" }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
      const text = await res.text();
      expect(text).toContain(
        `data: ${JSON.stringify({ type: "end", status: "failed" })}`,
      );
    } finally {
      Session.prototype.append = original;
    }
  });
});
