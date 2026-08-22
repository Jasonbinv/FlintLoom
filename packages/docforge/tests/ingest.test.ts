import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openKnowledge } from "@flintloom/knowledge";
import { WorkspaceEscapeError } from "@flintloom/tools";
import { ingestWorkspaceFile } from "../src/ingest.ts";
import { createDocIngestTool } from "../src/tools.ts";

describe("ingestWorkspaceFile", () => {
  it("ingests md, hides env, skips missing, and upserts", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-ingest-ws-"));
    const kb = openKnowledge(
      join(mkdtempSync(join(tmpdir(), "flintloom-ingest-db-")), "k.sqlite"),
    );
    writeFileSync(join(workspace, "README.md"), "# Hello\nbody token\n");
    writeFileSync(join(workspace, ".env"), "sk-secret\n");
    mkdirSync(join(workspace, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(workspace, "node_modules", "pkg", "x.js"), "1");
    writeFileSync(join(workspace, ".env.example"), "# Example\nvisible\n");

    const ok = await ingestWorkspaceFile(kb, workspace, "README.md");
    expect(ok.kind).toBe("written");
    if (ok.kind === "written") {
      expect(ok.record.status).toBe("ok");
      expect(ok.record.title).toBe("Hello");
    }
    const again = await ingestWorkspaceFile(kb, workspace, "README.md");
    if (ok.kind === "written" && again.kind === "written") {
      expect(again.record.id).toBe(ok.record.id);
    }

    expect((await ingestWorkspaceFile(kb, workspace, ".env")).kind).toBe("hidden");
    expect(kb.list().some((row) => row.path === ".env")).toBe(false);
    expect(
      (await ingestWorkspaceFile(kb, workspace, "node_modules/pkg/x.js")).kind,
    ).toBe("hidden");
    const example = await ingestWorkspaceFile(kb, workspace, ".env.example");
    expect(example.kind).toBe("written");

    expect((await ingestWorkspaceFile(kb, workspace, "nope.md")).kind).toBe(
      "not_found",
    );
    writeFileSync(join(workspace, "empty.md"), "   \n");
    const failed = await ingestWorkspaceFile(kb, workspace, "empty.md");
    expect(failed.kind).toBe("written");
    if (failed.kind === "written") {
      expect(failed.record.status).toBe("failed");
      expect((await kb.search("empty")).length).toBe(0);
    }

    await expect(
      ingestWorkspaceFile(kb, workspace, "../x"),
    ).rejects.toThrow(WorkspaceEscapeError);

    const tool = createDocIngestTool(kb);
    expect(await tool.execute({}, { workspaceRoot: workspace, signal: new AbortController().signal, channel: "cli" })).toBe(
      "failed: missing path",
    );
    const ac = new AbortController();
    ac.abort();
    expect(
      await tool.execute(
        { path: "README.md" },
        { workspaceRoot: workspace, signal: ac.signal, channel: "cli" },
      ),
    ).toBe("aborted");
    kb.close();
  });
});
