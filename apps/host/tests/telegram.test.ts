import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntime, startHost } from "../src/index.ts";
import { ASSEMBLY } from "./assembly.ts";

const here = fileURLToPath(new URL(".", import.meta.url));

const TELEGRAM_YML = `${ASSEMBLY}  - id: channel-telegram
    name: "@flintloom/channel-telegram"
    config:
      token: tok
      allowedChatIds:
        - 123
`;

function writeTelegramAssembly(workspaceRoot: string): void {
  writeFileSync(join(workspaceRoot, "flintloom.yml"), TELEGRAM_YML);
}

function jsonOk(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
}

describe("telegram host overlay", () => {
  let close: (() => Promise<void>) | undefined;
  const originalFetch = globalThis.fetch;
  afterEach(async () => {
    if (close !== undefined) {
      await close();
      close = undefined;
    }
    globalThis.fetch = originalFetch;
  });

  it("two-arg createRuntime does not call Bot API", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-tg-cli-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-tg-cli-home-"));
    writeTelegramAssembly(workspaceRoot);
    let n = 0;
    globalThis.fetch = async (...args) => {
      n += 1;
      return originalFetch(...args);
    };
    const { stop } = await createRuntime(workspaceRoot, homeDir);
    await new Promise((r) => setTimeout(r, 50));
    expect(n).toBe(0);
    stop();
  });

  it("startHost polls deleteWebhook then getUpdates and close stops", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-tg-host-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-tg-host-home-"));
    writeTelegramAssembly(workspaceRoot);
    const urls: string[] = [];
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      urls.push(u);
      if (u.includes("deleteWebhook")) {
        return jsonOk(true);
      }
      if (u.includes("getUpdates")) {
        await new Promise<void>((_resolve, reject) => {
          const onAbort = () => reject(new DOMException("aborted", "AbortError"));
          if (init?.signal?.aborted) {
            onAbort();
            return;
          }
          init?.signal?.addEventListener("abort", onAbort, { once: true });
        });
      }
      return jsonOk([]);
    };
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    await vi.waitFor(() => {
      expect(urls.some((u) => u.includes("deleteWebhook"))).toBe(true);
      expect(urls.some((u) => u.includes("getUpdates"))).toBe(true);
    });
    expect(urls[0]).toContain("deleteWebhook");
    const n = urls.length;
    await host.close();
    close = undefined;
    await new Promise((r) => setTimeout(r, 50));
    expect(urls.length).toBe(n);
  });

  it("default assembly yml does not include channel-telegram", () => {
    expect(ASSEMBLY).not.toMatch(/channel-telegram/);
  });

  it("root flintloom.yml includes channel-telegram plugin row", () => {
    const rootYml = readFileSync(join(here, "../../../flintloom.yml"), "utf8");
    expect(rootYml).toMatch(/channel-telegram/);
  });
});

describe("host src factory scan", () => {
  it("does not import telegram adapter", () => {
    const srcDir = join(here, "../src");
    const src = readdirSync(srcDir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(join(srcDir, name), "utf8"))
      .join("\n");
    expect(src).not.toMatch(/@flintloom\/channel-telegram/);
    expect(src).not.toMatch(/createTelegramAdapter/);
  });
});
