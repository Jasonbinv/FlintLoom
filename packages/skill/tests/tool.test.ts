import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSkillTool } from "../src/tool.ts";

function exec(workspaceRoot: string, signal = new AbortController().signal) {
  return { workspaceRoot, signal, channel: "cli" };
}

function writeSkill(root: string, id: string, body: string): void {
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(
    join(root, id, "SKILL.md"),
    `---\nname: ${id}\ndescription: d ${id}\n---\n${body}`,
    "utf8",
  );
}

describe("skill tool", () => {
  it("lists without bodies and reads workspace overlay", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-skill-tool-home-"));
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-skill-tool-ws-"));
    writeSkill(join(homeDir, ".flintloom", "skills"), "shared", "home\n");
    writeSkill(join(workspaceRoot, "skills"), "shared", "ws\n");
    const tool = createSkillTool({ homeDir });
    expect(tool.name).toBe("skill");
    expect(tool.parameters).not.toHaveProperty("path");

    const listed = JSON.parse(
      await tool.execute({ action: "list" }, exec(workspaceRoot)),
    ) as { skills: { id: string; source: string; body?: string }[] };
    expect(listed.skills).toEqual([
      { id: "shared", name: "shared", description: "d shared", source: "workspace" },
    ]);
    expect(listed.skills[0]).not.toHaveProperty("body");

    const read = JSON.parse(
      await tool.execute({ action: "read", id: "shared" }, exec(workspaceRoot)),
    ) as { body: string; source: string };
    expect(read).toMatchObject({ body: "ws\n", source: "workspace" });
    expect(JSON.stringify(read)).not.toContain(homeDir);

    expect(await tool.execute({}, exec(workspaceRoot))).toBe("failed: missing action");
    expect(await tool.execute({ action: "write" }, exec(workspaceRoot))).toBe(
      "failed: unknown action",
    );
    expect(await tool.execute({ action: "read" }, exec(workspaceRoot))).toBe(
      "failed: missing id",
    );
    expect(await tool.execute({ action: "read", id: "nope" }, exec(workspaceRoot))).toBe(
      "failed: not found",
    );
    const ac = new AbortController();
    ac.abort();
    expect(await tool.execute({ action: "list" }, exec(workspaceRoot, ac.signal))).toBe(
      "aborted",
    );
  });
});
