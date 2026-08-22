import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ModelRegistry,
  type ChatProvider,
  type ChatRequest,
} from "@flintloom/models";
import { GENERATE_MAX_BYTES, GENERATE_MAX_CHARS } from "../src/generate.ts";
import {
  SUMMARIZE_MAX_CHARS,
  SUMMARIZE_SYSTEM,
  summarizeDocument,
} from "../src/summarize.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const helloMd = readFileSync(join(fixtures, "hello.md"), "utf8");
const binaryBin = join(fixtures, "binary.bin");

function liveSignal(): AbortSignal {
  return new AbortController().signal;
}

function registryWith(
  stream: ChatProvider["stream"],
): { models: ModelRegistry; calls: { n: number } } {
  const calls = { n: 0 };
  const models = new ModelRegistry();
  models.registerChat("default", {
    async *stream(req, signal) {
      calls.n += 1;
      yield* stream(req, signal);
    },
  });
  models.setDefault("chat", "default");
  return { models, calls };
}

describe("summarizeDocument", () => {
  it("summarizes hello.md through a fake chat", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-sum-ok-"));
    const path = join(dir, "hello.md");
    writeFileSync(path, helloMd);
    const signal = liveSignal();
    let captured: ChatRequest | undefined;
    let capturedSignal: AbortSignal | undefined;
    const { models } = registryWith(async function* (req, sig) {
      captured = req;
      capturedSignal = sig;
      yield { type: "text", text: "Short summary." };
    });
    await expect(summarizeDocument(path, models, signal)).resolves.toEqual({
      ok: true,
      summary: "Short summary.",
    });
    expect(captured?.tools).toEqual([]);
    expect(captured?.messages).toEqual([
      { role: "system", content: SUMMARIZE_SYSTEM },
      { role: "user", content: captured?.messages[1]?.content },
    ]);
    expect(captured?.messages[1]?.content).toContain("# Hello");
    expect(captured?.messages[1]?.content).toContain("发展");
    expect(captured?.messages[1]?.content).not.toContain("Short summary.");
    expect(capturedSignal).toBe(signal);
  });

  it("rejects empty and whitespace-only markdown without calling stream", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-sum-empty-"));
    const emptyPath = join(dir, "empty.md");
    const wsPath = join(dir, "ws.md");
    writeFileSync(emptyPath, "");
    writeFileSync(wsPath, "  \n\t\n");
    const { models, calls } = registryWith(async function* () {
      yield { type: "text", text: "nope" };
    });
    await expect(summarizeDocument(emptyPath, models, liveSignal())).resolves.toEqual({
      ok: false,
      reason: "empty text",
    });
    await expect(summarizeDocument(wsPath, models, liveSignal())).resolves.toEqual({
      ok: false,
      reason: "empty text",
    });
    expect(calls.n).toBe(0);
  });

  it("does not treat a failed: prefix body as an error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-sum-prefix-"));
    const path = join(dir, "tricky.md");
    writeFileSync(path, "failed: empty text\n# Hello\n");
    let user = "";
    const { models, calls } = registryWith(async function* (req) {
      user = req.messages[1]?.content ?? "";
      yield { type: "text", text: "ok" };
    });
    await expect(summarizeDocument(path, models, liveSignal())).resolves.toEqual({
      ok: true,
      summary: "ok",
    });
    expect(calls.n).toBe(1);
    expect(user).toContain("failed: empty text");
    expect(user).toContain("# Hello");
  });

  it("rejects unsupported binaries without calling stream", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-sum-bin-"));
    const path = join(dir, "x.bin");
    copyFileSync(binaryBin, path);
    const { models, calls } = registryWith(async function* () {
      yield { type: "text", text: "nope" };
    });
    await expect(summarizeDocument(path, models, liveSignal())).resolves.toEqual({
      ok: false,
      reason: "unsupported type",
    });
    expect(calls.n).toBe(0);
  });

  it("maps missing file, directory, and size limits without calling stream", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-sum-io-"));
    mkdirSync(join(dir, "adir"));
    writeFileSync(join(dir, "huge-bytes.md"), Buffer.alloc(GENERATE_MAX_BYTES + 1, 0x61));
    writeFileSync(join(dir, "huge-chars.md"), "x".repeat(GENERATE_MAX_CHARS + 1));
    const { models, calls } = registryWith(async function* () {
      yield { type: "text", text: "nope" };
    });
    await expect(
      summarizeDocument(join(dir, "missing.md"), models, liveSignal()),
    ).resolves.toEqual({ ok: false, reason: "not found" });
    await expect(
      summarizeDocument(join(dir, "adir"), models, liveSignal()),
    ).resolves.toEqual({ ok: false, reason: "not a file" });
    await expect(
      summarizeDocument(join(dir, "huge-bytes.md"), models, liveSignal()),
    ).resolves.toEqual({ ok: false, reason: "too large" });
    await expect(
      summarizeDocument(join(dir, "huge-chars.md"), models, liveSignal()),
    ).resolves.toEqual({ ok: false, reason: "too large" });
    expect(calls.n).toBe(0);
  });

  it("maps missing chat to unreadable without calling stream", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-sum-noch-"));
    const path = join(dir, "hello.md");
    writeFileSync(path, helloMd);
    const models = new ModelRegistry();
    const result = await summarizeDocument(path, models, liveSignal());
    expect(result).toEqual({ ok: false, reason: "unreadable" });
    expect(JSON.stringify(result)).not.toContain("未配置 chat");
  });

  it("silently slices summaries longer than SUMMARIZE_MAX_CHARS", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-sum-cap-"));
    const path = join(dir, "hello.md");
    writeFileSync(path, helloMd);
    const { models } = registryWith(async function* () {
      yield { type: "text", text: "a".repeat(SUMMARIZE_MAX_CHARS + 1) };
    });
    const result = await summarizeDocument(path, models, liveSignal());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary.length).toBe(SUMMARIZE_MAX_CHARS);
      expect(result.summary.includes("[truncated]")).toBe(false);
    }
  });

  it("maps tool_call-only and error chunks to unreadable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-sum-chunk-"));
    const path = join(dir, "hello.md");
    writeFileSync(path, helloMd);
    const onlyCall = registryWith(async function* () {
      yield { type: "tool_call", id: "1", name: "fs", args: {} };
    });
    await expect(
      summarizeDocument(path, onlyCall.models, liveSignal()),
    ).resolves.toEqual({ ok: false, reason: "unreadable" });

    const textThenCall = registryWith(async function* () {
      yield { type: "text", text: "Keep me." };
      yield { type: "tool_call", id: "1", name: "fs", args: {} };
    });
    await expect(
      summarizeDocument(path, textThenCall.models, liveSignal()),
    ).resolves.toEqual({ ok: true, summary: "Keep me." });

    const errAfterText = registryWith(async function* () {
      yield { type: "text", text: "partial" };
      yield { type: "error", message: "HTTP 500: secret-token" };
    });
    const failed = await summarizeDocument(path, errAfterText.models, liveSignal());
    expect(failed).toEqual({ ok: false, reason: "unreadable" });
    expect(JSON.stringify(failed)).not.toContain("secret-token");
    expect(JSON.stringify(failed)).not.toContain("partial");
  });

  it("returns aborted when the signal aborts during stream", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-sum-ab-"));
    const path = join(dir, "hello.md");
    writeFileSync(path, helloMd);
    const ac = new AbortController();
    const models = new ModelRegistry();
    models.registerChat("default", {
      async *stream() {
        ac.abort();
        throw new Error("network");
      },
    });
    models.setDefault("chat", "default");
    await expect(summarizeDocument(path, models, ac.signal)).resolves.toEqual({
      ok: false,
      reason: "aborted",
    });
  });

  it("sends LF to chat when the source is CRLF", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-sum-crlf-"));
    const path = join(dir, "crlf.md");
    writeFileSync(path, "# Hello\r\n\r\n发展\r\n");
    let user = "";
    const { models } = registryWith(async function* (req) {
      user = req.messages[1]?.content ?? "";
      yield { type: "text", text: "ok" };
    });
    await expect(summarizeDocument(path, models, liveSignal())).resolves.toEqual({
      ok: true,
      summary: "ok",
    });
    expect(user).toContain("# Hello");
    expect(user).toContain("发展");
    expect(user.includes("\r")).toBe(false);
  });
});
