import { describe, expect, it } from "vitest";
import { createA2uiService } from "../src/validate.ts";

export function confirmMessages(surfaceId = "main") {
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

describe("createA2uiService", () => {
  it("accepts a confirm card and takeEmit returns the tree once", () => {
    const svc = createA2uiService();
    const messages = confirmMessages();
    const snap = svc.validateEmit(messages);
    expect(snap.wait).toBe(true);
    expect(snap.surfaceId).toBe("main");
    expect(svc.takeEmit(snap.emitId)?.messages).toEqual(messages);
    expect(svc.takeEmit(snap.emitId)).toBeUndefined();
    expect(() => svc.validateAction({ surfaceId: "main", name: "confirm" }, messages)).not.toThrow();
  });

  it("rejects missing root, unknown component, bad catalog, https, and oversized payload", () => {
    const svc = createA2uiService();
    expect(() => svc.validateEmit([])).toThrow(/bad messages/);
    expect(() =>
      svc.validateEmit([
        { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
        { version: "v0.9", updateComponents: { surfaceId: "s", components: [{ id: "x", component: "Text", text: "hi" }] } },
      ]),
    ).toThrow(/missing root/);
    expect(() =>
      svc.validateEmit([
        { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
        { version: "v0.9", updateComponents: { surfaceId: "s", components: [{ id: "root", component: "Chart" }] } },
      ]),
    ).toThrow(/unknown component/);
    expect(() =>
      svc.validateEmit([
        { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "https://example.com/catalog.json" } },
      ]),
    ).toThrow(/bad catalog/);
    expect(() =>
      svc.validateEmit([
        { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
        { version: "v0.9", updateComponents: { surfaceId: "s", components: [{ id: "root", component: "Text", text: "see https://x.test" }] } },
      ]),
    ).toThrow(/remote url/);
    const huge = confirmMessages();
    (huge[1] as { updateComponents: { components: { text?: string }[] } }).updateComponents.components[1]!.text =
      "x".repeat(70_000);
    expect(() => svc.validateEmit(huge)).toThrow(/too large/);
  });

  it("validateAction uses provided messages, not takeEmit", () => {
    const svc = createA2uiService();
    const messages = confirmMessages();
    const snap = svc.validateEmit(messages);
    svc.takeEmit(snap.emitId);
    expect(() => svc.validateAction({ surfaceId: "main", name: "confirm" }, messages)).not.toThrow();
    expect(() => svc.validateAction({ surfaceId: "main", name: "nope" }, messages)).toThrow(/unknown action/);
  });
});
