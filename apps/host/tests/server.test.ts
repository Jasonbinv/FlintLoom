import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ModelRegistry } from "@flintloom/models";
import { Session } from "@flintloom/session";
import { ToolRegistry } from "@flintloom/tools";
import { createRuntime, loadOrCreateToken, startHost } from "../src/index.ts";
import { ASSEMBLY, writeAssembly } from "./assembly.ts";

const here = fileURLToPath(new URL(".", import.meta.url));

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
    writeAssembly(workspaceRoot);

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

    await expect(createRuntime(workspaceRoot, homeDir)).rejects.toThrow(/plugins/);
    await expect(startHost({ workspaceRoot, homeDir, port: 0 })).rejects.toThrow(
      /plugins/,
    );
  });

  it("missing flintloom.yml refuses to start", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-noyaml-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
    await expect(createRuntime(workspaceRoot, homeDir)).rejects.toThrow(/plugins/);
  });

  it("refuses to start when a plugin name cannot be imported", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-badpkg-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
    writeFileSync(
      join(workspaceRoot, "flintloom.yml"),
      `plugins:
  - id: missing
    name: "@flintloom/does-not-exist-xyz"
`,
    );
    await expect(createRuntime(workspaceRoot, homeDir)).rejects.toThrow(
      /missing|@flintloom\/does-not-exist-xyz/,
    );
  });

  it("yml with loop but no models fails with models", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-noloopdep-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
    writeFileSync(
      join(workspaceRoot, "flintloom.yml"),
      `plugins:
  - id: loop
    name: "@flintloom/loop"
`,
    );
    await expect(createRuntime(workspaceRoot, homeDir)).rejects.toThrow(/models/);
  });

  it("omitting skill from yml omits the skill tool", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-noskill-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
    writeFileSync(
      join(workspaceRoot, "flintloom.yml"),
      ASSEMBLY.replace(
        `  - id: skill\n    name: "@flintloom/skill"\n`,
        "",
      ),
    );
    const { ctx } = await createRuntime(workspaceRoot, homeDir);
    const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
    expect(names).not.toContain("skill");
  });

  it("omitting docforge from yml omits doc_generate", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-nodoc-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
    writeFileSync(
      join(workspaceRoot, "flintloom.yml"),
      ASSEMBLY.replace(
        `  - id: docforge\n    name: "@flintloom/docforge"\n`,
        "",
      ),
    );
    const { ctx } = await createRuntime(workspaceRoot, homeDir);
    const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
    expect(names).not.toContain("doc_generate");
    expect(names).not.toContain("doc_parse");
    expect(names).not.toContain("doc_convert");
    expect(names).not.toContain("doc_edit");
    expect(names).not.toContain("doc_compare");
    expect(names).not.toContain("doc_summarize");
  });

  it("omitting fs from yml omits the fs tool", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-nofs-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
    writeFileSync(
      join(workspaceRoot, "flintloom.yml"),
      `plugins:
  - id: models
    name: "@flintloom/models"
  - id: tools
    name: "@flintloom/tools"
  - id: session
    name: "@flintloom/session"
  - id: loop
    name: "@flintloom/loop"
`,
    );
    const { ctx } = await createRuntime(workspaceRoot, homeDir);
    const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
    expect(names).not.toContain("fs");
  });

  it("host src does not import tool factories", () => {
    const srcDir = join(here, "../src");
    const src = readdirSync(srcDir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(join(srcDir, name), "utf8"))
      .join("\n");
    expect(src).not.toMatch(/@flintloom\/fs/);
    expect(src).not.toMatch(/@flintloom\/grep/);
    expect(src).not.toMatch(/@flintloom\/shell/);
    expect(src).not.toMatch(/@flintloom\/models-chat/);
    expect(src).not.toMatch(/@flintloom\/knowledge/);
    expect(src).not.toMatch(/createDocProbeTool/);
    expect(src).not.toMatch(/createDocParseTool/);
    expect(src).not.toMatch(/createDocIngestTool/);
    expect(src).not.toMatch(/createDocGenerateTool/);
    expect(src).not.toMatch(/createDocConvertTool/);
    expect(src).not.toMatch(/createDocEditTool/);
    expect(src).not.toMatch(/createDocCompareTool/);
    expect(src).not.toMatch(/createDocSummarizeTool/);
    expect(src).not.toMatch(/@flintloom\/a2ui/);
    expect(src).not.toMatch(/createA2uiEmitTool/);
    expect(src).not.toMatch(/createInfographicGetTool/);
    expect(src).not.toMatch(/createInfographicPatchTool/);
    expect(src).not.toMatch(/@flintloom\/channel-webhook/);
    expect(src).not.toMatch(/createWebhookAdapter/);
    expect(src).not.toMatch(/lastAssistantText/);
    expect(src).not.toMatch(/@flintloom\/channel-telegram/);
    expect(src).not.toMatch(/createTelegramAdapter/);
    expect(src).not.toMatch(/@flintloom\/skill/);
    expect(src).not.toMatch(/createSkillTool/);
    expect(src).not.toMatch(/@flintloom\/mcp/);
    expect(src).not.toMatch(/createMcp/);
    expect(src).not.toMatch(/mcp__/);
  });

  it("default ASSEMBLY does not include mcp plugin", () => {
    expect(ASSEMBLY).not.toContain("@flintloom/mcp");
  });

  it("createRuntime loads mcp fixture and registers mcp__fake__echo", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-mcp-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
    const fixture = fileURLToPath(
      new URL("../../../packages/mcp/fixtures/fake-mcp-server.mjs", import.meta.url),
    );
    writeFileSync(
      join(workspaceRoot, "flintloom.yml"),
      `plugins:
  - id: models
    name: "@flintloom/models"
  - id: tools
    name: "@flintloom/tools"
  - id: fake
    name: "@flintloom/mcp"
    config:
      command: ${JSON.stringify(process.execPath)}
      args: [${JSON.stringify(fixture)}]
      env: [FAKE_TOKEN]
`,
    );
    const prev = process.env.FAKE_TOKEN;
    process.env.FAKE_TOKEN = "from-process";
    try {
      const { ctx, stop } = await createRuntime(workspaceRoot, homeDir);
      const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
      expect(names).toContain("mcp__fake__echo");
      const out = await ctx.require<ToolRegistry>("tools").execute(
        "mcp__fake__echo",
        { text: "host" },
        {
          workspaceRoot,
          signal: new AbortController().signal,
          channel: "host",
        },
      );
      expect(out).toBe("host");
      stop();
    } finally {
      if (prev === undefined) {
        delete process.env.FAKE_TOKEN;
      } else {
        process.env.FAKE_TOKEN = prev;
      }
    }
  });

  it("returns 500 text/plain with the error message and redacts the api key", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-ws-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
    writeAssembly(workspaceRoot);
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
    writeAssembly(workspaceRoot);
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
    writeAssembly(workspaceRoot);
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

  it("registers chat from workspace .env when process env is unset", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-dotenv-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
    writeAssembly(workspaceRoot);
    writeFileSync(
      join(workspaceRoot, ".env"),
      [
        "FLINTLOOM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1",
        "FLINTLOOM_API_KEY=sk-xxx",
        "FLINTLOOM_CHAT_MODEL=qwen3.7-plus",
      ].join("\n"),
    );

    const previousKey = process.env.FLINTLOOM_API_KEY;
    delete process.env.FLINTLOOM_API_KEY;
    try {
      const { ctx } = await createRuntime(workspaceRoot, homeDir);
      const chat = ctx
        .require<ModelRegistry>("models")
        .snapshot()
        .find((row) => row.kind === "chat");
      expect(chat?.configured).toBe(true);
    } finally {
      if (previousKey === undefined) {
        delete process.env.FLINTLOOM_API_KEY;
      } else {
        process.env.FLINTLOOM_API_KEY = previousKey;
      }
    }
  });

  it("returns 500 when runTurn throws before SSE headers", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-ws-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
    writeAssembly(workspaceRoot);
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
      expect(res.status).toBe(500);
      expect(res.headers.get("content-type") ?? "").not.toMatch(/text\/event-stream/);
    } finally {
      Session.prototype.append = original;
    }
  });

  it("registers doc_probe and doc_parse tools", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-ws-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
    writeAssembly(workspaceRoot);
    const { ctx } = await createRuntime(workspaceRoot, homeDir);
    const names = ctx.require<ToolRegistry>("tools").schemas().map((row) => row.name);
    expect(names).toContain("doc_probe");
    expect(names).toContain("doc_parse");
    expect(names).toContain("doc_summarize");
    expect(names).toContain("doc_ingest");
    expect(names).toContain("knowledge_search");
    expect(names).toContain("a2ui_emit");
    expect(names).toContain("infographic_get");
    expect(names).toContain("infographic_patch");
  });

  it("turn without a chat key emits model/error and failed", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-nokey-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
    writeAssembly(workspaceRoot);
    const previousKey = process.env.FLINTLOOM_API_KEY;
    delete process.env.FLINTLOOM_API_KEY;
    try {
      const host = await startHost({ workspaceRoot, homeDir, port: 0 });
      close = host.close;
      const token = loadOrCreateToken(homeDir);
      const res = await fetch(`${host.url}/v1/turns`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId: "s1", text: "hi" }),
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("model/error");
      expect(text).toContain(
        `data: ${JSON.stringify({ type: "end", status: "failed" })}`,
      );
    } finally {
      if (previousKey === undefined) {
        delete process.env.FLINTLOOM_API_KEY;
      } else {
        process.env.FLINTLOOM_API_KEY = previousKey;
      }
    }
  });

  it("returns runtime and rejects a second in-flight turn on the same session", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-busy-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-busy-home-"));
    writeAssembly(workspaceRoot);
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    expect(host.runtime.ctx.require).toBeTypeOf("function");
    const token = loadOrCreateToken(homeDir);
    const models = host.runtime.ctx.require<ModelRegistry>("models");
    models.registerChat("fake", {
      async *stream(_req, signal) {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => reject(new Error("aborted"));
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener("abort", onAbort, { once: true });
        });
      },
    });
    models.setDefault("chat", "fake");

    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const first = fetch(`${host.url}/v1/turns`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId: "s-busy", text: "hi" }),
    });
    const started = Date.now();
    let turnReady = false;
    while (Date.now() - started < 5000) {
      const peek = await fetch(`${host.url}/v1/sessions/s-busy`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (peek.status === 200) {
        const body = (await peek.json()) as { events: { type: string }[] };
        if (body.events.some((e) => e.type === "turn/start")) {
          turnReady = true;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(turnReady).toBe(true);
    const second = await fetch(`${host.url}/v1/turns`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId: "s-busy", text: "again" }),
    });
    expect(second.status).toBe(409);
    await host.close();
    close = undefined;
    await first.catch(() => undefined);
  });

  it("createRuntime provides turnBusy and stop disposes plugins", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-runtime-stop-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-runtime-stop-home-"));
    writeAssembly(workspaceRoot);
    const { ctx, stop } = await createRuntime(workspaceRoot, homeDir);
    expect(ctx.require("turnBusy")).toBeInstanceOf(Set);
    expect(typeof stop).toBe("function");
    stop();
    expect(() => ctx.require("sessions")).toThrow(/sessions/);
  });

  it("startHost HTTP busy is the ctx turnBusy set", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-turnbusy-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-turnbusy-home-"));
    writeAssembly(workspaceRoot);
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);
    const busy = host.runtime.ctx.require<Set<string>>("turnBusy");
    busy.add("webhook");
    const res = await fetch(`${host.url}/v1/hooks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "hi" }),
    });
    expect(res.status).toBe(409);
  });
});
