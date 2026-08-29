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
});
