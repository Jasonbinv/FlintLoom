import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readPersistedWorkspace,
  resolveWorkspaceRoot,
  validateWorkspaceRoot,
  writePersistedWorkspace,
} from "../src/workspace.ts";
import { writeAssembly } from "./assembly.ts";

describe("workspace", () => {
  it("validates workspace with flintloom.yml", () => {
    const root = mkdtempSync(join(tmpdir(), "flintloom-ws-valid-"));
    writeAssembly(root);
    expect(validateWorkspaceRoot(root)).toBe(true);
  });

  it("persists and resolves workspace path", () => {
    const root = mkdtempSync(join(tmpdir(), "flintloom-ws-persist-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-ws-home-"));
    writeAssembly(root);
    writePersistedWorkspace(homeDir, root);
    expect(readPersistedWorkspace(homeDir)).toBe(root);
    expect(resolveWorkspaceRoot(homeDir, "/missing")).toBe(root);
  });

  it("rejects directory without flintloom.yml", () => {
    const root = mkdtempSync(join(tmpdir(), "flintloom-ws-empty-"));
    writeFileSync(join(root, "README.md"), "x", "utf8");
    expect(validateWorkspaceRoot(root)).toBe(false);
  });
});
