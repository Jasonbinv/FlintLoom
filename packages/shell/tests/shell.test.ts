import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createShellTool, decodeShellOutput } from "../src/index.ts";

function createExec(workspaceRoot: string) {
  return {
    workspaceRoot,
    signal: new AbortController().signal,
    channel: "cli",
  };
}

describe("decodeShellOutput", () => {
  it("decodes utf-8", () => {
    expect(decodeShellOutput(Buffer.from("hello 发展", "utf8"))).toBe("hello 发展");
  });

  it("falls back to gbk for invalid utf-8 on win32", () => {
    const gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]); // 你好
    if (process.platform === "win32") {
      expect(decodeShellOutput(gbk)).toBe("你好");
    } else {
      expect(decodeShellOutput(gbk)).toContain("�");
    }
  });
});

describe("createShellTool", () => {
  it("runs commands in the workspace and returns output", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-shell-"));
    const exec = createExec(workspace);
    const shell = createShellTool();

    const result = await shell.execute({ command: "echo flintloom-ok" }, exec);

    expect(result).toContain("flintloom-ok");
  });

  it("refuses mkdir of ai_generation folders so the model uses fs instead", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-shell-mkdir-"));
    const exec = createExec(workspace);
    const shell = createShellTool();
    const result = await shell.execute(
      { command: "mkdir -p ai_generation/20240522_KET_Syllabus" },
      exec,
    );
    expect(result).toMatch(/do not/i);
    expect(result).toContain("fs");
    expect(result).toContain("doc_generate");
  });

  it("decodes gbk bytes from a child process without mojibake", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-shell-gbk-"));
    writeFileSync(
      join(workspace, "emit-gbk.mjs"),
      "process.stdout.write(Buffer.from([0xc4,0xe3,0xba,0xc3]));\n",
    );
    const exec = createExec(workspace);
    const shell = createShellTool();
    const result = await shell.execute({ command: "node emit-gbk.mjs" }, exec);
    if (process.platform === "win32") {
      expect(result).toContain("你好");
      expect(result).not.toContain("�");
    } else {
      expect(result.length).toBeGreaterThan(0);
    }
  });
});
