import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceEscapeError } from "@flintloom/tools";
import { createInfographicGetTool, createInfographicPatchTool } from "../src/tool.ts";

const exec = (workspaceRoot: string) => ({
  workspaceRoot,
  signal: new AbortController().signal,
  channel: "cli",
});

describe("infographic tools", () => {
  it("gets, patches, creates, and rejects bad path / abort / escape", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-ig-"));
    const get = createInfographicGetTool();
    const patch = createInfographicPatchTool();
    const e = exec(workspace);

    expect(await get.execute({ path: "notes.json" }, e)).toBe("failed: bad path");
    expect(await get.execute({ path: "flow.infographic.json" }, e)).toBe("failed: not found");

    const created = await patch.execute(
      {
        path: "flow.infographic.json",
        ops: [
          { op: "addNode", id: "parse", label: "Parse", x: 20, y: 40 },
          { op: "addNode", id: "kb", label: "KB", x: 200, y: 40 },
          { op: "addEdge", from: "parse", to: "kb" },
        ],
      },
      e,
    );
    expect(JSON.parse(created)).toEqual({
      status: "ok",
      path: "flow.infographic.json",
      nodes: 2,
      edges: 1,
    });
    const got = JSON.parse(await get.execute({ path: "flow.infographic.json" }, e));
    expect(got.nodes[1].label).toBe("KB");
    expect(await get.execute({ path: "flow.infographic.json" }, e)).not.toContain("<svg");

    const before = readFileSync(join(workspace, "flow.infographic.json"), "utf8");
    expect(await patch.execute({ path: "flow.infographic.json", ops: [] }, e)).toMatch(
      /^failed:/,
    );
    expect(readFileSync(join(workspace, "flow.infographic.json"), "utf8")).toBe(before);

    expect(
      await patch.execute(
        {
          path: "no-such-dir/x.infographic.json",
          ops: [{ op: "addNode", id: "a", label: "A", x: 0, y: 0 }],
        },
        e,
      ),
    ).toBe("failed: not found");

    const ac = new AbortController();
    ac.abort();
    expect(
      await get.execute({ path: "flow.infographic.json" }, { ...e, signal: ac.signal }),
    ).toBe("aborted");

    await expect(get.execute({ path: "../x.infographic.json" }, e)).rejects.toThrow(
      WorkspaceEscapeError,
    );
  });
});
