import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lookupSkill, scanSkills } from "../src/scan.ts";

function writeSkill(dir: string, id: string, body = `# ${id}\n`): void {
  const skillDir = join(dir, id);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${id}\ndescription: desc ${id}\n---\n${body}`,
    "utf8",
  );
}

describe("scanSkills and lookupSkill", () => {
  it("merges home and workspace and overlays by directory id", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-skill-home-"));
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-skill-ws-"));
    writeSkill(join(homeDir, ".flintloom", "skills"), "alpha");
    writeSkill(join(homeDir, ".flintloom", "skills"), "shared", "home body\n");
    writeSkill(join(workspaceRoot, "skills"), "shared", "ws body\n");
    writeSkill(join(workspaceRoot, "skills"), "beta");
    mkdirSync(join(homeDir, ".flintloom", "skills", "node_modules"), {
      recursive: true,
    });

    const listed = scanSkills({ homeDir, workspaceRoot });
    expect(listed.map((s) => s.id)).toEqual(["alpha", "beta", "shared"]);
    expect(listed.find((s) => s.id === "shared")).toMatchObject({
      source: "workspace",
      body: "ws body\n",
    });

    mkdirSync(join(workspaceRoot, "skills", "alpha"), { recursive: true });
    writeFileSync(join(workspaceRoot, "skills", "alpha", "SKILL.md"), "not-yaml", "utf8");
    expect(scanSkills({ homeDir, workspaceRoot }).map((s) => s.id)).toEqual([
      "beta",
      "shared",
    ]);
    expect(lookupSkill({ homeDir, workspaceRoot, id: "alpha" })).toEqual({
      ok: false,
      reason: "bad skill",
    });
    expect(lookupSkill({ homeDir, workspaceRoot, id: "shared" })).toMatchObject({
      ok: true,
      record: { source: "workspace", body: "ws body\n" },
    });
    expect(lookupSkill({ homeDir, workspaceRoot, id: "missing" })).toEqual({
      ok: false,
      reason: "not found",
    });
  });
});
