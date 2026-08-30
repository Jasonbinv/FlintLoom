import { describe, expect, it } from "vitest";
import { createA2uiService } from "../src/validate.ts";
import { createA2uiEmitTool } from "../src/tool.ts";

function confirmMessages(surfaceId = "main") {
  return [
    {
      version: "v0.9" as const,
      createSurface: { surfaceId, catalogId: "flintloom:a2ui:core" },
    },
    {
      version: "v0.9" as const,
      updateComponents: {
        surfaceId,
        components: [
          { id: "root", component: "Column", children: ["title", "ok"] },
          { id: "title", component: "Text", text: "Continue?" },
          {
            id: "ok",
            component: "Button",
            child: "ok-label",
            action: { event: { name: "confirm" } },
          },
          { id: "ok-label", component: "Text", text: "OK" },
        ],
      },
    },
  ];
}

const exec = { workspaceRoot: "/tmp", signal: new AbortController().signal, channel: "cli" };

describe("a2ui_emit", () => {
  it("describes official AntV families instead of saying SWOT and relation cannot be drawn", () => {
    const tool = createA2uiEmitTool(createA2uiService());
    expect(tool.description).toContain("compare-swot");
    expect(tool.description).toMatch(/relation-/);
    expect(tool.description).toMatch(/chart-/);
    expect(tool.description).toContain("ONLY syntax");
    expect(tool.description).not.toMatch(/not auto-drawn/);
    expect(tool.parameters.properties.syntax.description).toMatch(/values|nodes/);
    expect(tool.parameters.properties.syntax.description).toContain("mindmap");
  });

  it("returns short json without messages and rejects abort / missing messages", async () => {
    const svc = createA2uiService();
    const tool = createA2uiEmitTool(svc);
    const raw = await tool.execute({ messages: confirmMessages() }, exec);
    const parsed = JSON.parse(raw) as { status: string; emitId: string; wait: boolean };
    expect(parsed.status).toBe("ok");
    expect(parsed.wait).toBe(true);
    expect(raw).not.toContain("Continue?");
    expect(JSON.parse(raw)).not.toHaveProperty("messages");
    expect(svc.takeEmit(parsed.emitId)?.surfaceId).toBe("main");
    expect(await tool.execute({}, exec)).toMatch(/^failed:/);
    const ac = new AbortController();
    ac.abort();
    expect(await tool.execute({ messages: confirmMessages() }, { ...exec, signal: ac.signal })).toBe("aborted");
  });

  it("repairs a fused Text+Chart radar emit instead of returning bad envelope", async () => {
    const svc = createA2uiService();
    const tool = createA2uiEmitTool(svc);
    const raw = await tool.execute(
      {
        messages: [
          {
            createSurface: { catalogId: "flintloom:a2ui:core", surfaceId: "main" },
            version: "v0.9",
          },
          {
            updateComponents: {
              components: [
                {
                  children: ["title", "chart"],
                  component: "Column",
                  id: "root",
                },
                { component: "Text", id: "title", text: "雷达" },
                {
                  component: "Text",
                  id: "label",
                  text: "分布'},{component:",
                  'Chart<|"|>,id': "chart",
                  kind: "radar",
                  labels: ["A", "B"],
                  values: [1, 2],
                },
              ],
            },
          },
        ],
      },
      exec,
    );
    const parsed = JSON.parse(raw) as { status: string; emitId: string };
    expect(parsed.status).toBe("ok");
    const snap = svc.takeEmit(parsed.emitId);
    expect(snap?.messages.some((msg) => "updateComponents" in msg && msg.updateComponents.components.some((c) => c.id === "chart" && c.component === "Chart"))).toBe(true);
  });

  it("accepts a bare AntV syntax argument without envelopes", async () => {
    const svc = createA2uiService();
    const tool = createA2uiEmitTool(svc);
    const raw = await tool.execute(
      {
        syntax:
          "infographic list-row-simple-horizontal-arrow\ndata\n  lists\n    - label A\n      desc Start\n    - label B\n      desc Next\n    - label C\n      desc Done\n",
      },
      exec,
    );
    const parsed = JSON.parse(raw) as { status: string; emitId: string; wait: boolean };
    expect(parsed.status).toBe("ok");
    expect(parsed.wait).toBe(false);
    const snap = svc.takeEmit(parsed.emitId);
    const update = snap?.messages.find((msg) => "updateComponents" in msg);
    expect(
      update &&
        "updateComponents" in update &&
        update.updateComponents.components.some(
          (c) => c.component === "Infographic" && typeof c.syntax === "string",
        ),
    ).toBe(true);
  });
});
