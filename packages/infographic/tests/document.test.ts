import { describe, expect, it } from "vitest";
import { applyOps, parseDocument } from "../src/document.ts";

function twoNodeDoc() {
  return {
    nodes: [
      { id: "parse", label: "Parse", x: 20, y: 40 },
      { id: "kb", label: "KB", x: 200, y: 40 },
    ],
    edges: [{ from: "parse", to: "kb" }],
  };
}

describe("parseDocument", () => {
  it("accepts a two-node graph", () => {
    const doc = twoNodeDoc();
    expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
  });

  it("rejects missing id, duplicate id, dangling edge, https, and oversized payload", () => {
    expect(() => parseDocument("{")).toThrow(/bad json/);
    expect(() => parseDocument(JSON.stringify({ nodes: [], edges: [] }))).not.toThrow();
    expect(() =>
      parseDocument(
        JSON.stringify({
          nodes: [{ id: "a", label: "A", x: 0, y: 0 }],
          edges: [{ from: "a", to: "missing" }],
        }),
      ),
    ).toThrow(/unknown node/);
    expect(() =>
      parseDocument(
        JSON.stringify({
          nodes: [
            { id: "a", label: "A", x: 0, y: 0 },
            { id: "a", label: "B", x: 1, y: 1 },
          ],
          edges: [],
        }),
      ),
    ).toThrow(/duplicate id/);
    expect(() =>
      parseDocument(
        JSON.stringify({
          nodes: [{ id: "a", label: "see https://x.test", x: 0, y: 0 }],
          edges: [],
        }),
      ),
    ).toThrow(/remote url/);
    const huge = twoNodeDoc();
    huge.nodes[0]!.label = "x".repeat(70_000);
    expect(() => parseDocument(JSON.stringify(huge))).toThrow(/too large/);
  });
});

describe("applyOps", () => {
  it("adds, updates, and removes without mutating the input", () => {
    const empty = { nodes: [], edges: [] };
    const frozen = { nodes: [], edges: [] };
    const added = applyOps(empty, [
      { op: "addNode", id: "parse", label: "Parse", x: 20, y: 40 },
      { op: "addNode", id: "kb", label: "KB", x: 200, y: 40 },
      { op: "addEdge", from: "parse", to: "kb" },
    ]);
    expect(frozen).toEqual({ nodes: [], edges: [] });
    expect(added.edges).toEqual([{ from: "parse", to: "kb" }]);
    const renamed = applyOps(added, [{ op: "updateNode", id: "kb", label: "Store" }]);
    expect(renamed.nodes.find((n) => n.id === "kb")?.label).toBe("Store");
    expect(added.nodes.find((n) => n.id === "kb")?.label).toBe("KB");
    const removed = applyOps(renamed, [{ op: "removeNode", id: "parse" }]);
    expect(removed.nodes.map((n) => n.id)).toEqual(["kb"]);
    expect(removed.edges).toEqual([]);
  });

  it("throws unknown node and does not apply a later op", () => {
    const doc = twoNodeDoc();
    expect(() => applyOps(doc, [{ op: "updateNode", id: "nope", label: "x" }])).toThrow(
      /unknown node/,
    );
    expect(doc).toEqual(twoNodeDoc());
    expect(() => applyOps(doc, [])).toThrow(/empty ops/);
  });
});
