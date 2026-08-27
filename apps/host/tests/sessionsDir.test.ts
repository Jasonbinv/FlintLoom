import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { workspaceSessionsDir } from "../src/sessionsDir.ts";

describe("workspaceSessionsDir", () => {
  it("is stable for the same workspace root", () => {
    const homeDir = "C:\\Users\\me";
    const workspaceRoot = "G:\\AgentCode\\demo";
    const a = workspaceSessionsDir(homeDir, workspaceRoot);
    const b = workspaceSessionsDir(homeDir, workspaceRoot);
    expect(a).toBe(b);
    expect(a).toContain(".flintloom\\sessions\\");
  });

  it("uses resolved path when available", () => {
    const homeDir = "C:\\Users\\me";
    const workspaceRoot = realpathSync.native(".");
    const dir = workspaceSessionsDir(homeDir, workspaceRoot);
    const key = dir.split(/[/\\]/).pop();
    expect(key).toBe(createHash("sha256").update(workspaceRoot).digest("base64url"));
  });
});
