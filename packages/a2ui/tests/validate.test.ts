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
});
