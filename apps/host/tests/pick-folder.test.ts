import { describe, expect, it } from "vitest";
import { buildWindowsPickFolderScript } from "../src/pick-folder.ts";

describe("buildWindowsPickFolderScript", () => {
  it("includes initial path when provided", () => {
    const script = buildWindowsPickFolderScript("G:\\AgentCode\\FlintLoom");
    expect(script).toContain("FolderBrowserDialog");
    expect(script).toContain("$d.SelectedPath = 'G:\\AgentCode\\FlintLoom'");
  });

  it("escapes single quotes in path", () => {
    const script = buildWindowsPickFolderScript("G:\\it's\\path");
    expect(script).toContain("$d.SelectedPath = 'G:\\it''s\\path'");
  });
});
