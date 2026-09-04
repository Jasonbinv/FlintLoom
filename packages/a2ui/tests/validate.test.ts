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
      ]),
    ).toThrow(/missing root/);
    expect(() =>
      svc.validateEmit([
        { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
        { version: "v0.9", updateComponents: { surfaceId: "s", components: [{ id: "root", component: "Video" }] } },
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

  it("accepts DataTable and Chart display components without wait", () => {
    const svc = createA2uiService();
    const tableSnap = svc.validateEmit([
      { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [
            { id: "root", component: "Column", children: ["tbl"] },
            {
              id: "tbl",
              component: "DataTable",
              headers: ["name", "qty"],
              rows: [["apple", "3"], ["pear", "2"]],
            },
          ],
        },
      },
    ]);
    expect(tableSnap.wait).toBe(false);

    const chartSnap = svc.validateEmit([
      { version: "v0.9", createSurface: { surfaceId: "c", catalogId: "flintloom:a2ui:core" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "c",
          components: [
            { id: "root", component: "Chart", kind: "bar", labels: ["A", "B"], values: [1, 4] },
          ],
        },
      },
    ]);
    expect(chartSnap.wait).toBe(false);

    expect(() =>
      svc.validateEmit([
        { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "s",
            components: [
              { id: "root", component: "Chart", labels: ["A"], values: ["1"] },
            ],
          },
        },
      ]),
    ).toThrow(/bad chart/);
  });

  it("rejects DataTable and Chart boundary violations", () => {
    const svc = createA2uiService();
    const base = [
      { version: "v0.9" as const, createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
    ];
    const tableComponents = (tbl: Record<string, unknown>) => [
      ...base,
      {
        version: "v0.9" as const,
        updateComponents: {
          surfaceId: "s",
          components: [{ id: "root", component: "DataTable", ...tbl }],
        },
      },
    ];

    expect(() =>
      svc.validateEmit(
        tableComponents({ headers: Array.from({ length: 21 }, (_, i) => `c${i}`), rows: [] }),
      ),
    ).toThrow(/bad table/);
    expect(() =>
      svc.validateEmit(
        tableComponents({
          headers: ["a"],
          rows: Array.from({ length: 101 }, () => ["x"]),
        }),
      ),
    ).toThrow(/bad table/);
    expect(() =>
      svc.validateEmit(tableComponents({ headers: ["a", "b"], rows: [["only-one"]] })),
    ).toThrow(/bad table/);
    expect(() =>
      svc.validateEmit(
        tableComponents({ headers: ["a"], rows: [["x".repeat(2001)]] }),
      ),
    ).toThrow(/bad table/);

    const chartComponents = (chart: Record<string, unknown>) => [
      ...base,
      {
        version: "v0.9" as const,
        updateComponents: {
          surfaceId: "s",
          components: [{ id: "root", component: "Chart", ...chart }],
        },
      },
    ];

    expect(() =>
      svc.validateEmit(
        chartComponents({
          labels: Array.from({ length: 25 }, (_, i) => `L${i}`),
          values: Array.from({ length: 25 }, () => 1),
        }),
      ),
    ).toThrow(/bad chart/);
    expect(() =>
      svc.validateEmit(chartComponents({ labels: ["A", "B"], values: [1] })),
    ).toThrow(/bad chart/);
    expect(() =>
      svc.validateEmit(chartComponents({ labels: ["A"], values: [Number.NaN] })),
    ).toThrow(/bad chart/);
    expect(() =>
      svc.validateEmit(chartComponents({ kind: "unknown-kind", labels: ["A"], values: [1] })),
    ).toThrow(/bad chart/);

    for (const kind of [
      "bar",
      "hbar",
      "line",
      "area",
      "scatter",
      "pie",
      "doughnut",
      "donut",
      "column",
      "radar",
      "spider",
    ] as const) {
      expect(() =>
        svc.validateEmit(chartComponents({ kind, labels: ["A"], values: [1] })),
      ).not.toThrow();
    }
  });

  it("accepts heatmap matrix charts and rejects mismatched shapes", () => {
    const svc = createA2uiService();
    const chartComponents = (chart: Record<string, unknown>) => [
      { version: "v0.9" as const, createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
      {
        version: "v0.9" as const,
        updateComponents: {
          surfaceId: "s",
          components: [{ id: "root", component: "Chart", ...chart }],
        },
      },
    ];

    expect(() =>
      svc.validateEmit(
        chartComponents({
          kind: "heatmap",
          xLabels: ["Mon", "Tue"],
          yLabels: ["AM", "PM"],
          values: [
            [1, 2],
            [3, 4],
          ],
        }),
      ),
    ).not.toThrow();
    expect(() =>
      svc.validateEmit(
        chartComponents({
          kind: "heat_map",
          xLabels: ["Mon"],
          yLabels: ["AM"],
          values: [[1]],
        }),
      ),
    ).not.toThrow();
    expect(() =>
      svc.validateEmit(
        chartComponents({
          kind: "heatmap",
          data: { path: "/heat" },
        }),
      ),
    ).not.toThrow();

    expect(() =>
      svc.validateEmit(
        chartComponents({
          kind: "heatmap",
          labels: ["A", "B"],
          values: [1, 2],
        }),
      ),
    ).toThrow(/bad chart/);
    const fromLabels = svc.validateEmit(
      chartComponents({
        kind: "heatmap",
        labels: ["X1", "X2"],
        values: [
          [1, 2],
          [3, 4],
        ],
      }),
    );
    const fromLabelsChart =
      fromLabels.messages[1] && "updateComponents" in fromLabels.messages[1]
        ? fromLabels.messages[1].updateComponents.components[0]
        : undefined;
    expect(fromLabelsChart?.xLabels).toEqual(["X1", "X2"]);
    expect(fromLabelsChart?.yLabels).toEqual(["Y1", "Y2"]);
    expect(fromLabelsChart?.values).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(() =>
      svc.validateEmit(
        chartComponents({
          kind: "heatmap",
          xLabels: ["Mon", "Tue"],
          yLabels: ["AM"],
          values: [[1]],
        }),
      ),
    ).toThrow(/bad chart/);
    expect(() =>
      svc.validateEmit(
        chartComponents({
          kind: "heatmap",
          xLabels: ["Mon"],
          yLabels: ["AM", "PM"],
          values: [
            [1, 2],
            [3, 4],
          ],
        }),
      ),
    ).toThrow(/bad chart/);
    expect(() =>
      svc.validateEmit(
        chartComponents({
          kind: "heatmap",
          xLabels: ["Mon"],
          yLabels: ["AM"],
          values: [[Number.NaN]],
        }),
      ),
    ).toThrow(/bad chart/);
  });

  it("accepts DataTable and Chart data path bindings without inline rows", () => {
    const svc = createA2uiService();
    const tableSnap = svc.validateEmit([
      { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [{ id: "root", component: "DataTable", data: { path: "/tbl" } }],
        },
      },
    ]);
    expect(tableSnap.wait).toBe(false);

    const chartSnap = svc.validateEmit([
      { version: "v0.9", createSurface: { surfaceId: "c", catalogId: "flintloom:a2ui:core" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "c",
          components: [{ id: "root", component: "Chart", kind: "line", data: { path: "/chart" } }],
        },
      },
    ]);
    expect(chartSnap.wait).toBe(false);
  });

  it("accepts Infographic with inline document or file path without wait", () => {
    const svc = createA2uiService();
    const docSnap = svc.validateEmit([
      { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [
            {
              id: "root",
              component: "Infographic",
              document: {
                nodes: [{ id: "a", label: "Start", x: 10, y: 20 }],
                edges: [],
              },
            },
          ],
        },
      },
    ]);
    expect(docSnap.wait).toBe(false);

    const fileSnap = svc.validateEmit([
      { version: "v0.9", createSurface: { surfaceId: "f", catalogId: "flintloom:a2ui:core" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "f",
          components: [
            { id: "root", component: "Infographic", file: "flow.infographic.json" },
          ],
        },
      },
    ]);
    expect(fileSnap.wait).toBe(false);

    expect(() =>
      svc.validateEmit([
        { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "s",
            components: [
              {
                id: "root",
                component: "Infographic",
                document: { nodes: [], edges: [{ from: "x", to: "y" }] },
              },
            ],
          },
        },
      ]),
    ).toThrow(/unknown node/);

    const syntaxSnap = svc.validateEmit([
      { version: "v0.9", createSurface: { surfaceId: "a", catalogId: "flintloom:a2ui:core" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "a",
          components: [
            {
              id: "root",
              component: "Infographic",
              syntax:
                "infographic list-row-simple-horizontal-arrow\ndata\n  lists\n    - label A\n      desc Start\n",
            },
          ],
        },
      },
    ]);
    expect(syntaxSnap.wait).toBe(false);

    const stepListSnap = svc.validateEmit([
      { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [
            {
              id: "root",
              component: "Infographic",
              syntax: "infographic stepList\nstep 1: 接收指令\n理解意图\nstep 2: 任务规划\n拆解步骤\n",
            },
          ],
        },
      },
    ]);
    const stepListUpdate = stepListSnap.messages.find((msg) => "updateComponents" in msg);
    const stepListRoot =
      stepListUpdate && "updateComponents" in stepListUpdate
        ? stepListUpdate.updateComponents.components.find((c) => c.id === "root")
        : undefined;
    expect(stepListRoot && "syntax" in stepListRoot ? stepListRoot.syntax : "").toContain(
      "list-column-simple-vertical-arrow",
    );
    expect(stepListRoot && "syntax" in stepListRoot ? stepListRoot.syntax : "").toContain("data");
    expect(stepListRoot && "syntax" in stepListRoot ? stepListRoot.syntax : "").toContain("接收指令");

    const igFileSnap = svc.validateEmit([
      { version: "v0.9", createSurface: { surfaceId: "g", catalogId: "flintloom:a2ui:core" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "g",
          components: [
            { id: "root", component: "Infographic", file: "steps.infographic.ig" },
          ],
        },
      },
    ]);
    expect(igFileSnap.wait).toBe(false);

    expect(() =>
      svc.validateEmit([
        { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "s",
            components: [
              {
                id: "root",
                component: "Infographic",
                syntax: "infographic x",
                document: { nodes: [{ id: "a", label: "A", x: 0, y: 0 }], edges: [] },
              },
            ],
          },
        },
      ]),
    ).toThrow(/bad infographic/);
    expect(() =>
      svc.validateEmit([
        { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "s",
            components: [
              {
                id: "root",
                component: "Infographic",
                syntax: "infographic x\nicon https://cdn.example/a.svg\n",
              },
            ],
          },
        },
      ]),
    ).toThrow(/remote url/);
  });

  it("repairs version 0.9 and type-as-envelope keys", () => {
    const svc = createA2uiService();
    const snap = svc.validateEmit([
      {
        type: "createSurface",
        version: "0.9",
        createSurface: { surfaceId: "main", catalogId: "flintloom:a2ui:core" },
      },
      {
        type: "updateComponents",
        version: "0.9",
        updateComponents: {
          surfaceId: "main",
          components: [{ id: "root", component: "Text", text: "ok" }],
        },
      },
    ]);
    expect(snap.wait).toBe(false);
    expect(snap.messages[0]).toMatchObject({
      version: "v0.9",
      createSurface: { surfaceId: "main", catalogId: "flintloom:a2ui:core" },
    });
  });

  it("synthesizes createSurface when type is the only envelope hint", () => {
    const svc = createA2uiService();
    const snap = svc.validateEmit([
      { type: "createSurface", version: "0.9", kind: "heatmap" },
      {
        type: "updateComponents",
        version: "0.9",
        updateComponents: {
          components: [{ id: "root", component: "Text", text: "hi" }],
        },
      },
    ]);
    expect(snap.surfaceId).toBe("main");
    expect(snap.wait).toBe(false);
  });

  it("repairs missing version and surfaceId on updateComponents", () => {
    const svc = createA2uiService();
    const snap = svc.validateEmit([
      {
        createSurface: { surfaceId: "main", catalogId: "flintloom:a2ui:core" },
        version: "v0.9",
      },
      {
        updateComponents: {
          components: [
            { id: "root", component: "Column", children: ["title"] },
            { id: "title", component: "Text", text: "hi" },
          ],
        },
      },
    ]);
    expect(snap.surfaceId).toBe("main");
    expect(snap.wait).toBe(false);
    const update = snap.messages[1];
    expect(update && "updateComponents" in update && update.version).toBe("v0.9");
    if (update && "updateComponents" in update) {
      expect(update.updateComponents.surfaceId).toBe("main");
    }
  });

  it("splits a Chart fused onto a Text node from a garbled radar emit", () => {
    const svc = createA2uiService();
    const snap = svc.validateEmit([
      {
        createSurface: {
          catalogId: "flintloom:a2ui:core",
          surfaceId: "main",
        },
        version: "v0.9",
      },
      {
        updateComponents: {
          components: [
            {
              children: ["title_text", "label_text", "radar_chart_id"],
              component: "Column",
              id: "root",
            },
            {
              component: "Text",
              id: "title_text",
              text: "核心技术维度评估 (雷达图)",
            },
            {
              component: "Text",
              id: "label_text",
              text: "模型综合能力分布 (基于 AI 行业趋势数据)'},{component:",
              'Chart<|"|>,id': "radar_chart_id",
              kind: "radar",
              labels: ["推理能力", "多模态理解", "代码生成", "响应速度", "安全性/伦理"],
              values: [85, 90, 80, 70, 75],
              "}],surfaceId": "main",
              "},version": "v0.9",
            },
          ],
        },
      },
    ]);
    expect(snap.surfaceId).toBe("main");
    const update = snap.messages[1];
    if (!update || !("updateComponents" in update)) {
      throw new Error("expected updateComponents");
    }
    const byId = new Map(update.updateComponents.components.map((c) => [c.id, c]));
    const label = byId.get("label_text");
    const chart = byId.get("radar_chart_id");
    expect(label?.component).toBe("Text");
    expect(label?.text).toBe("模型综合能力分布 (基于 AI 行业趋势数据)");
    expect(label?.kind).toBeUndefined();
    expect(chart?.component).toBe("Chart");
    expect(chart?.kind).toBe("radar");
    expect(chart?.labels).toEqual(["推理能力", "多模态理解", "代码生成", "响应速度", "安全性/伦理"]);
    expect(chart?.values).toEqual([85, 90, 80, 70, 75]);
  });

  it("does not invent a second Chart when a fused Text already has a sibling Chart", () => {
    const svc = createA2uiService();
    const snap = svc.validateEmit([
      {
        version: "v0.9",
        createSurface: { surfaceId: "main", catalogId: "flintloom:a2ui:core" },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "main",
          components: [
            { id: "root", component: "Column", children: ["label", "chart"] },
            {
              id: "label",
              component: "Text",
              text: "caption'},{component:",
              kind: "radar",
              labels: ["A", "B"],
              values: [1, 2],
            },
            {
              id: "chart",
              component: "Chart",
              kind: "radar",
              labels: ["A", "B"],
              values: [1, 2],
            },
          ],
        },
      },
    ]);
    const update = snap.messages[1];
    if (!update || !("updateComponents" in update)) {
      throw new Error("expected updateComponents");
    }
    const charts = update.updateComponents.components.filter((c) => c.component === "Chart");
    expect(charts).toHaveLength(1);
    const label = update.updateComponents.components.find((c) => c.id === "label");
    expect(label?.text).toBe("caption");
    expect(label?.kind).toBeUndefined();
  });

  it("coerces heatmap numeric strings and maps type to kind", () => {
    const svc = createA2uiService();
    const snap = svc.validateEmit([
      { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [
            {
              id: "root",
              component: "Chart",
              type: "heatmap",
              xLabels: ["Mon", "Tue"],
              yLabels: ["AM", "PM"],
              values: [
                ["1", "2"],
                ["3", "4"],
              ],
            },
          ],
        },
      },
    ]);
    const chart = snap.messages[1] && "updateComponents" in snap.messages[1]
      ? snap.messages[1].updateComponents.components[0]
      : undefined;
    expect(chart?.component).toBe("Chart");
    expect(chart?.kind).toBe("heatmap");
    expect(chart?.values).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("converts a heat-matrix DataTable into a Chart heatmap", () => {
    const svc = createA2uiService();
    const snap = svc.validateEmit([
      { version: "v0.9", createSurface: { surfaceId: "main", catalogId: "flintloom:a2ui:core" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "main",
          components: [
            { id: "root", component: "Column", children: ["title", "grid"] },
            { id: "title", component: "Text", text: "业务活跃度热力矩阵 (Heatmap)" },
            {
              id: "grid",
              component: "DataTable",
              headers: ["时段", "周一", "周二", "周三"],
              rows: [
                ["上午", "25", "40", "35"],
                ["晚上", "80", "85", "90"],
              ],
            },
          ],
        },
      },
    ]);
    const update = snap.messages[1];
    if (!update || !("updateComponents" in update)) {
      throw new Error("expected updateComponents");
    }
    const grid = update.updateComponents.components.find((c) => c.id === "grid");
    expect(grid?.component).toBe("Chart");
    expect(grid?.kind).toBe("heatmap");
    expect(grid?.xLabels).toEqual(["周一", "周二", "周三"]);
    expect(grid?.yLabels).toEqual(["上午", "晚上"]);
    expect(grid?.values).toEqual([
      [25, 40, 35],
      [80, 85, 90],
    ]);
    expect(grid?.headers).toBeUndefined();
  });

  it("leaves a two-column DataTable as a table", () => {
    const svc = createA2uiService();
    const snap = svc.validateEmit([
      { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [
            { id: "root", component: "Column", children: ["tbl"] },
            {
              id: "tbl",
              component: "DataTable",
              headers: ["item", "count"],
              rows: [
                ["apple", "3"],
                ["banana", "5"],
              ],
            },
          ],
        },
      },
    ]);
    const update = snap.messages[1];
    if (!update || !("updateComponents" in update)) {
      throw new Error("expected updateComponents");
    }
    const tbl = update.updateComponents.components.find((c) => c.id === "tbl");
    expect(tbl?.component).toBe("DataTable");
  });

  it("accepts heatmap with labels plus a 2d matrix and numeric DataTable cells", () => {
    const svc = createA2uiService();
    const snap = svc.validateEmit([
      {
        createSurface: { catalogId: "flintloom:a2ui:core", surfaceId: "main" },
        version: "v0.9",
      },
      {
        updateComponents: {
          surfaceId: "main",
          components: [
            { id: "root", component: "Column", children: ["h_cht", "t_table"] },
            {
              id: "h_cht",
              component: "Chart",
              kind: "heatmap",
              labels: ["X1", "X2"],
              values: [
                [1, 2],
                [3, 4],
              ],
            },
            {
              id: "t_table",
              component: "DataTable",
              headers: ["时段", "周一", "周二", "周三"],
              rows: [
                ["上午", 10, 20, 40],
                ["中午", 15, 35, 55],
                ["下午", 25, 50, 80],
              ],
            },
          ],
        },
        version: "v0.9",
      },
    ]);
    const update = snap.messages[1];
    if (!update || !("updateComponents" in update)) {
      throw new Error("expected updateComponents");
    }
    const byId = new Map(update.updateComponents.components.map((c) => [c.id, c]));
    const chart = byId.get("h_cht");
    expect(chart?.kind).toBe("heatmap");
    expect(chart?.xLabels).toEqual(["X1", "X2"]);
    expect(chart?.yLabels).toEqual(["Y1", "Y2"]);
    const table = byId.get("t_table");
    expect(table?.component).toBe("Chart");
    expect(table?.kind).toBe("heatmap");
    expect(table?.xLabels).toEqual(["周一", "周二", "周三"]);
    expect(table?.values).toEqual([
      [10, 20, 40],
      [15, 35, 55],
      [25, 50, 80],
    ]);
  });

  it("repairs a dashboard emit that uses createSurface.id and card/chart/table types", () => {
    const svc = createA2uiService();
    const snap = svc.validateEmit([
      {
        createSurface: {
          id: "dashboard_surface",
          layout: "vertical",
          title: "实时销售数据看板",
        },
      },
      {
        updateComponents: {
          components: [
            {
              content: {
                color: "#10b981",
                subValue: "+12.5% 较上月",
                title: "总销售额",
                value: "¥1,284,500",
              },
              id: "metric_total_sales",
              type: "card",
            },
            {
              content: {
                color: "#3b82f6",
                subValue: "-2.1% 较上月",
                title: "订单总量",
                value: "4,320",
              },
              id: "metric_orders",
              type: "card",
            },
          ],
          surfaceId: "dashboard_surface",
        },
      },
      {
        updateComponents: {
          components: [
            {
              chartType: "line",
              data: {
                categories: ["1月", "2月", "3月", "4月", "5月", "6月"],
                series: [{ data: [120, 150, 180, 140, 210, 250], name: "实际销售额" }],
              },
              id: "sales_chart",
              type: "chart",
            },
          ],
          surfaceId: "dashboard_surface",
        },
      },
      {
        updateComponents: {
          components: [
            {
              data: {
                headers: ["产品名称", "销量", "单价", "库存"],
                rows: [
                  ["智能手机 X1", "520", "¥3,999", "45"],
                  ["无线耳机 Pro", "890", "¥799", "120"],
                  ["平板电脑 Air", "310", "¥2,499", "12"],
                  ["智能手表 S3", "450", "¥1,299", "88"],
                ],
              },
              id: "product_table",
              type: "table",
            },
          ],
          surfaceId: "dashboard_surface",
        },
      },
    ]);
    expect(snap.surfaceId).toBe("dashboard_surface");
    expect(snap.wait).toBe(false);
    const create = snap.messages[0];
    expect(create && "createSurface" in create && create.createSurface.surfaceId).toBe("dashboard_surface");
    expect(create && "createSurface" in create && create.createSurface.catalogId).toBe("flintloom:a2ui:core");

    const byId = new Map<string, { id: string; component: string; [key: string]: unknown }>();
    for (const msg of snap.messages) {
      if (!("updateComponents" in msg)) continue;
      expect(msg.updateComponents.surfaceId).toBe("dashboard_surface");
      for (const comp of msg.updateComponents.components) {
        byId.set(comp.id, comp);
      }
    }
    expect(byId.get("root")?.component).toBe("Column");
    expect(byId.get("root")?.children).toEqual([
      "metric_total_sales",
      "metric_orders",
      "sales_chart",
      "product_table",
    ]);
    expect(byId.get("metric_total_sales")?.component).toBe("Text");
    expect(byId.get("metric_total_sales")?.text).toContain("总销售额");
    expect(byId.get("metric_total_sales")?.text).toContain("¥1,284,500");
    expect(byId.get("sales_chart")?.component).toBe("Chart");
    expect(byId.get("sales_chart")?.kind).toBe("line");
    expect(byId.get("sales_chart")?.labels).toEqual(["1月", "2月", "3月", "4月", "5月", "6月"]);
    expect(byId.get("sales_chart")?.values).toEqual([120, 150, 180, 140, 210, 250]);
    expect(byId.get("product_table")?.component).toBe("DataTable");
    expect(byId.get("product_table")?.headers).toEqual(["产品名称", "销量", "单价", "库存"]);
    expect(byId.get("product_table")?.rows).toEqual([
      ["智能手机 X1", "520", "¥3,999", "45"],
      ["无线耳机 Pro", "890", "¥799", "120"],
      ["平板电脑 Air", "310", "¥2,499", "12"],
      ["智能手表 S3", "450", "¥1,299", "88"],
    ]);
  });

  it("still rejects envelopes that name two different surfaces", () => {
    const svc = createA2uiService();
    expect(() =>
      svc.validateEmit([
        { version: "v0.9", createSurface: { surfaceId: "main", catalogId: "flintloom:a2ui:core" } },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "other",
            components: [{ id: "root", component: "Text", text: "hi" }],
          },
        },
      ]),
    ).toThrow(/mixed surface/);
  });

  it("repairs typed envelopes that put id and components on the message root", () => {
    const svc = createA2uiService();
    const snap = svc.validateEmit([
      {
        type: "createSurface",
        id: "dashboard_surface",
        title: "业务实时监控看板",
      },
      {
        type: "updateComponents",
        components: [
          {
            id: "metric_sales",
            type: "card",
            content: { title: "今日销售额", value: "¥128,400", subValue: "+8%" },
          },
          {
            id: "metric_users",
            type: "card",
            content: { title: "活跃用户", value: "3,240" },
          },
          {
            id: "metric_cvr",
            type: "card",
            title: "转化率",
            value: "3.8%",
          },
        ],
      },
    ]);
    expect(snap.surfaceId).toBe("dashboard_surface");
    expect(snap.wait).toBe(false);
    const byId = new Map<string, { id: string; component: string; [key: string]: unknown }>();
    for (const msg of snap.messages) {
      if (!("updateComponents" in msg)) continue;
      for (const comp of msg.updateComponents.components) {
        byId.set(comp.id, comp);
      }
    }
    expect(byId.get("root")?.component).toBe("Column");
    expect(byId.get("root")?.children).toEqual(["metric_sales", "metric_users", "metric_cvr"]);
    expect(byId.get("metric_sales")?.component).toBe("Text");
    expect(String(byId.get("metric_sales")?.text)).toContain("今日销售额");
    expect(byId.get("metric_cvr")?.component).toBe("Text");
    expect(String(byId.get("metric_cvr")?.text)).toContain("转化率");
  });

  it("wraps loose Text components in a root Column", () => {
    const svc = createA2uiService();
    const snap = svc.validateEmit([
      { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [{ id: "x", component: "Text", text: "hi" }],
        },
      },
    ]);
    const update = snap.messages.find((msg) => "updateComponents" in msg);
    if (!update || !("updateComponents" in update)) throw new Error("expected update");
    const byId = new Map(update.updateComponents.components.map((c) => [c.id, c]));
    expect(byId.get("root")?.component).toBe("Column");
    expect(byId.get("root")?.children).toEqual(["x"]);
  });

  it("repairs official v0.8 beginRendering/surfaceUpdate with nested components and explicitList", () => {
    const svc = createA2uiService();
    const snap = svc.validateEmit([
      { beginRendering: { surfaceId: "main", root: "root" } },
      {
        surfaceUpdate: {
          surfaceId: "main",
          components: [
            {
              id: "root",
              component: { Column: { children: { explicitList: ["title", "chart"] } } },
            },
            { id: "title", component: { Text: { text: { literalString: "Sales" } } } },
            {
              id: "chart",
              component: "Chart",
              kind: "bar",
              labels: ["A", "B"],
              values: [1, 4],
            },
          ],
        },
      },
    ]);
    expect(snap.surfaceId).toBe("main");
    expect(snap.wait).toBe(false);
    const byId = componentsById(snap.messages);
    expect(byId.get("root")?.component).toBe("Column");
    expect(byId.get("root")?.children).toEqual(["title", "chart"]);
    expect(byId.get("title")?.text).toBe("Sales");
    expect(byId.get("chart")?.component).toBe("Chart");
    const create = snap.messages.find((msg) => "createSurface" in msg);
    expect(create && "createSurface" in create && create.createSurface.catalogId).toBe("flintloom:a2ui:core");
  });

  it("repairs official catalogId, Card child, and ChildList children", () => {
    const svc = createA2uiService();
    const snap = svc.validateEmit([
      {
        version: "v0.9",
        createSurface: {
          surfaceId: "main",
          catalogId: "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
        },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "main",
          components: [
            { id: "root", component: "Card", child: "body" },
            { id: "body", component: "Column", children: { explicitList: ["chart"] } },
            {
              id: "chart",
              component: "Chart",
              kind: "bar",
              labels: ["Q1", "Q2"],
              values: [10, 20],
            },
          ],
        },
      },
    ]);
    const byId = componentsById(snap.messages);
    expect(byId.get("root")?.component).toBe("Column");
    expect(byId.get("root")?.children).toEqual(["body"]);
    expect(byId.get("body")?.children).toEqual(["chart"]);
    const create = snap.messages.find((msg) => "createSurface" in msg);
    expect(create && "createSurface" in create && create.createSurface.catalogId).toBe("flintloom:a2ui:core");
  });

  it("lifts components nested in createSurface and wraps a bare chart as root", () => {
    const svc = createA2uiService();
    const nested = svc.validateEmit([
      {
        version: "v0.9",
        createSurface: {
          surfaceId: "main",
          catalogId: "flintloom:a2ui:core",
          components: [
            { id: "title", component: "Text", text: "Trend" },
            { id: "chart", component: "Chart", kind: "line", labels: ["A"], values: [3] },
          ],
        },
      },
    ]);
    const nestedById = componentsById(nested.messages);
    expect(nestedById.get("root")?.component).toBe("Column");
    expect(nestedById.get("chart")?.component).toBe("Chart");

    const bare = svc.validateEmit([
      { id: "root", component: "Chart", kind: "pie", labels: ["a", "b"], values: [1, 2] },
    ]);
    const bareById = componentsById(bare.messages);
    expect(bareById.get("root")?.component).toBe("Chart");
    expect(bareById.get("root")?.kind).toBe("pie");
  });

  it("splits a combined createSurface+updateComponents envelope used by official-style emits", () => {
    const svc = createA2uiService();
    const snap = svc.validateEmit([
      {
        version: "v0.9",
        createSurface: { surfaceId: "main", catalogId: "flintloom:a2ui:core" },
        updateComponents: {
          surfaceId: "main",
          components: [{ id: "root", component: "Text", text: "ok" }],
        },
      },
    ]);
    expect(snap.messages).toHaveLength(2);
    expect(snap.messages[0] && "createSurface" in snap.messages[0]).toBe(true);
    expect(snap.messages[1] && "updateComponents" in snap.messages[1]).toBe(true);
  });
});

function componentsById(messages: unknown[]) {
  const byId = new Map<string, { id: string; component: string; [key: string]: unknown }>();
  for (const msg of messages) {
    if (!isRecord(msg) || !isRecord(msg.updateComponents) || !Array.isArray(msg.updateComponents.components)) {
      continue;
    }
    for (const comp of msg.updateComponents.components) {
      if (!isRecord(comp) || typeof comp.id !== "string") continue;
      byId.set(comp.id, comp as { id: string; component: string; [key: string]: unknown });
    }
  }
  return byId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
