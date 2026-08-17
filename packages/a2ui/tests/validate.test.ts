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

  it("requires button fields, layout children, picker options, and legal paths", () => {
    const svc = createA2uiService();
    const catalog = { version: "v0.9" as const, createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } };
    expect(() =>
      svc.validateEmit([
        catalog,
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "s",
            components: [{ id: "root", component: "Column" }],
          },
        },
      ]),
    ).toThrow(/bad children/);
    expect(() =>
      svc.validateEmit([
        catalog,
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "s",
            components: [
              { id: "root", component: "Column", children: ["ok"] },
              { id: "ok", component: "Button", child: "ok-label" },
              { id: "ok-label", component: "Text", text: "OK" },
            ],
          },
        },
      ]),
    ).toThrow(/bad button/);
    expect(() =>
      svc.validateEmit([
        catalog,
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "s",
            components: [
              { id: "root", component: "Column", children: ["ok"] },
              {
                id: "ok",
                component: "Button",
                child: "ok-label",
                action: { event: { name: "" } },
              },
              { id: "ok-label", component: "Text", text: "OK" },
            ],
          },
        },
      ]),
    ).toThrow(/bad button/);
    expect(() =>
      svc.validateEmit([
        catalog,
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "s",
            components: [
              { id: "root", component: "Column", children: ["pick"] },
              { id: "pick", component: "ChoicePicker", options: [] },
            ],
          },
        },
      ]),
    ).toThrow(/bad options/);
    expect(() =>
      svc.validateEmit([
        catalog,
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "s",
            components: [
              { id: "root", component: "Column", children: ["pick"] },
              {
                id: "pick",
                component: "ChoicePicker",
                options: Array.from({ length: 21 }, (_, i) => ({ label: `L${i}`, value: `v${i}` })),
              },
            ],
          },
        },
      ]),
    ).toThrow(/bad options/);
    expect(() =>
      svc.validateEmit([
        catalog,
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "s",
            components: [{ id: "root", component: "Text", text: { path: "/foo-bar" } }],
          },
        },
      ]),
    ).toThrow(/bad path/);
    expect(() =>
      svc.validateEmit([
        catalog,
        {
          version: "v0.9",
          updateDataModel: { surfaceId: "s", path: "title", value: "x" },
        },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "s",
            components: [{ id: "root", component: "Text", text: { path: "/title" } }],
          },
        },
      ]),
    ).toThrow(/bad path/);
  });

  it("sets wait from the reachable tree, not an unreachable sibling", () => {
    const svc = createA2uiService();
    const snap = svc.validateEmit([
      { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [
            { id: "root", component: "Column", children: ["title"] },
            { id: "title", component: "Text", text: "hi" },
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
    ]);
    expect(snap.wait).toBe(false);
    expect(() =>
      svc.validateAction({ surfaceId: "s", name: "confirm" }, snap.messages),
    ).toThrow(/unknown action/);
  });

  it("accepts a reachable choice picker as wait and honors updateDataModel paths", () => {
    const svc = createA2uiService();
    const messages = [
      { version: "v0.9" as const, createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
      { version: "v0.9" as const, updateDataModel: { surfaceId: "s", path: "/color", value: "red" } },
      {
        version: "v0.9" as const,
        updateComponents: {
          surfaceId: "s",
          components: [
            { id: "root", component: "Column", children: ["title", "pick"] },
            { id: "title", component: "Text", text: { path: "/color" } },
            {
              id: "pick",
              component: "ChoicePicker",
              options: [
                { label: "Red", value: "red" },
                { label: "Blue", value: "blue" },
              ],
              value: { path: "/color" },
            },
          ],
        },
      },
    ];
    const snap = svc.validateEmit(messages);
    expect(snap.wait).toBe(true);
    expect(() => svc.validateAction({ surfaceId: "s", name: "choice" }, messages)).not.toThrow();
  });
});
