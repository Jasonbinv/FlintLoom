/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { normalizeWorkspaceInput } from "../src/workspacePicker.ts";

describe("normalizeWorkspaceInput", () => {
  it("trims whitespace and surrounding quotes", () => {
    expect(normalizeWorkspaceInput('  "G:\\AgentCode\\FlintLoom"  ')).toBe(
      "G:\\AgentCode\\FlintLoom",
    );
    expect(normalizeWorkspaceInput("'C:/workspace'")).toBe("C:/workspace");
  });

  it("returns undefined for empty input", () => {
    expect(normalizeWorkspaceInput("   ")).toBeUndefined();
    expect(normalizeWorkspaceInput('""')).toBeUndefined();
  });

  it("preserves forward slashes and drive letters", () => {
    expect(normalizeWorkspaceInput("G:/AgentCode/PerAgent/FlintLoom")).toBe(
      "G:/AgentCode/PerAgent/FlintLoom",
    );
  });
});
