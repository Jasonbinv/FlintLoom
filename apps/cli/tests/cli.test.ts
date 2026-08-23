import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadOrCreateToken } from "@flintloom/host";
import { parseCliArgv } from "../src/argv.ts";
import { formatCliOutput } from "../src/output.ts";
import { runCli } from "../src/run.ts";

describe("loadOrCreateToken", () => {
  it("returns the same token on a second call for the same homeDir", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-cli-home-"));
    const first = loadOrCreateToken(homeDir);
    const second = loadOrCreateToken(homeDir);
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
  });
});

describe("formatCliOutput", () => {
  it("writes the last assistant/message to stdout when status is ok", () => {
    expect(
      formatCliOutput(
        [
          { type: "assistant/chunk", text: "partial" },
          { type: "assistant/message", text: "hello" },
        ],
        "ok",
      ),
    ).toEqual({ stdout: "hello\n", stderr: "" });
  });

  it("writes the last model/error to stderr when status is not ok", () => {
    expect(
      formatCliOutput(
        [
          { type: "model/error", kind: "chat", message: "missing api key" },
          { type: "turn/end", turnId: "t1", status: "failed" },
        ],
        "failed",
      ),
    ).toEqual({ stdout: "", stderr: "missing api key\n" });
  });

  it("writes the status to stderr when failed and there is no model/error", () => {
    expect(formatCliOutput([], "failed")).toEqual({
      stdout: "",
      stderr: "failed\n",
    });
  });
});

describe("parseCliArgv", () => {
  it("keeps turn text and --workspace", () => {
    expect(
      parseCliArgv(["--workspace", "W", "hello", "world"], "/cwd"),
    ).toEqual({ kind: "turn", workspace: "W", text: "hello world" });
    expect(parseCliArgv(["hello"], "/cwd")).toEqual({
      kind: "turn",
      workspace: "/cwd",
      text: "hello",
    });
  });

  it("parses plugin add with optional --id before or after the path", () => {
    expect(parseCliArgv(["plugin", "add", "./p"], "/cwd")).toEqual({
      kind: "plugin-add",
      workspace: "/cwd",
      sourcePath: "./p",
    });
    expect(
      parseCliArgv(["plugin", "add", "--id", "x", "./p"], "/cwd"),
    ).toEqual({
      kind: "plugin-add",
      workspace: "/cwd",
      sourcePath: "./p",
      id: "x",
    });
    expect(
      parseCliArgv(["--workspace", "W", "plugin", "add", "./p", "--id", "x"], "/cwd"),
    ).toEqual({
      kind: "plugin-add",
      workspace: "W",
      sourcePath: "./p",
      id: "x",
    });
  });

  it("throws plugin add when the plugin subcommand is not add", () => {
    expect(() => parseCliArgv(["plugin"], "/cwd")).toThrow(/plugin add/);
    expect(() => parseCliArgv(["plugin", "list"], "/cwd")).toThrow(/plugin add/);
  });

  it("throws id or path for bad plugin add argv", () => {
    expect(() => parseCliArgv(["plugin", "add"], "/cwd")).toThrow(/path/);
    expect(() => parseCliArgv(["plugin", "add", "--id"], "/cwd")).toThrow(/id/);
    expect(() =>
      parseCliArgv(["plugin", "add", "a", "b"], "/cwd"),
    ).toThrow(/path/);
    expect(() =>
      parseCliArgv(["plugin", "add", "--id", "x", "--id", "y", "./p"], "/cwd"),
    ).toThrow(/id/);
  });

  it("parses config get and set", () => {
    expect(parseCliArgv(["config", "get"], "/cwd")).toEqual({
      kind: "config-get",
      workspace: "/cwd",
    });
    expect(parseCliArgv(["config", "get", "chat"], "/cwd")).toEqual({
      kind: "config-get",
      workspace: "/cwd",
      slotId: "chat",
    });
    expect(
      parseCliArgv(["config", "set", "telegram", "apiKey", "bot-token"], "/cwd"),
    ).toEqual({
      kind: "config-set",
      workspace: "/cwd",
      slotId: "telegram",
      field: "apiKey",
      value: "bot-token",
    });
    expect(
      parseCliArgv(
        ["config", "set", "chat", "baseUrl", "http://127.0.0.1:8080/v1"],
        "/cwd",
      ),
    ).toEqual({
      kind: "config-set",
      workspace: "/cwd",
      slotId: "chat",
      field: "baseUrl",
      value: "http://127.0.0.1:8080/v1",
    });
    expect(
      parseCliArgv(
        ["config", "set", "wecom", "agentId", "1000002"],
        "/cwd",
      ),
    ).toEqual({
      kind: "config-set",
      workspace: "/cwd",
      slotId: "wecom",
      field: "agentId",
      value: "1000002",
    });
  });

  it("throws for bad config argv", () => {
    expect(() => parseCliArgv(["config"], "/cwd")).toThrow(/config/);
    expect(() => parseCliArgv(["config", "get", "bad"], "/cwd")).toThrow(/slot/);
    expect(() => parseCliArgv(["config", "set", "chat"], "/cwd")).toThrow(/field/);
    expect(() =>
      parseCliArgv(["config", "set", "chat", "badField", "x"], "/cwd"),
    ).toThrow(/field/);
  });

  it("allows empty value to clear a credential field", () => {
    expect(parseCliArgv(["config", "set", "chat", "apiKey"], "/cwd")).toEqual({
      kind: "config-set",
      workspace: "/cwd",
      slotId: "chat",
      field: "apiKey",
      value: "",
    });
  });
});

describe("runCli", () => {
  it("plugin add does not call createRuntime", async () => {
    const createRuntime = vi.fn();
    const installPluginFromPath = vi.fn(async () => ({
      id: "sample",
      dest: "/dest",
    }));
    const stdout: string[] = [];
    const code = await runCli(["plugin", "add", "./p"], {
      cwd: () => "/cwd",
      homedir: () => "/home",
      createRuntime,
      installPluginFromPath,
      stdout: { write: (c) => stdout.push(c) },
      stderr: { write: () => {} },
    });
    expect(code).toBe(0);
    expect(stdout.join("")).toBe("added sample\n");
    expect(createRuntime).not.toHaveBeenCalled();
    expect(installPluginFromPath).toHaveBeenCalledWith({
      workspaceRoot: "/cwd",
      homeDir: "/home",
      sourcePath: "./p",
    });
  });

  it("writes err.message to stderr when plugin add fails", async () => {
    const stderr: string[] = [];
    const code = await runCli(["plugin", "add", "./p"], {
      cwd: () => "/cwd",
      homedir: () => "/home",
      createRuntime: vi.fn(),
      installPluginFromPath: vi.fn(async () => {
        throw new Error("path");
      }),
      stdout: { write: () => {} },
      stderr: { write: (c) => stderr.push(c) },
    });
    expect(code).toBe(1);
    expect(stderr.join("")).toBe("path\n");
  });

  it("config set writes credentials without createRuntime", async () => {
    const home = mkdtempSync(join(tmpdir(), "flintloom-cli-config-"));
    const createRuntime = vi.fn();
    const stdout: string[] = [];
    const code = await runCli(
      ["config", "set", "chat", "apiKey", "sk-test-key"],
      {
        cwd: () => "/cwd",
        homedir: () => home,
        createRuntime,
        installPluginFromPath: vi.fn(),
        stdout: { write: (c) => stdout.push(c) },
        stderr: { write: () => {} },
      },
    );
    expect(code).toBe(0);
    expect(stdout.join("")).toBe("ok chat.apiKey\n");
    expect(createRuntime).not.toHaveBeenCalled();
  });
});
