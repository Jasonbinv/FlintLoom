import {
  INFOGRAPHIC_MAX_BYTES,
  type InfographicDocument,
  type InfographicEdge,
  type InfographicNode,
  type InfographicOp,
} from "./types.ts";

export { INFOGRAPHIC_MAX_BYTES } from "./types.ts";
export type {
  InfographicDocument,
  InfographicEdge,
  InfographicNode,
  InfographicOp,
} from "./types.ts";

const ID_RE = /^[A-Za-z0-9_-]+$/;

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkRemoteUrls(value: unknown): void {
  if (typeof value === "string") {
    if (value.includes("http://") || value.includes("https://")) {
      fail("remote url");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      checkRemoteUrls(item);
    }
    return;
  }
  if (isRecord(value)) {
    for (const v of Object.values(value)) {
      checkRemoteUrls(v);
    }
  }
}

function exactKeys(obj: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(obj);
  return actual.length === keys.length && keys.every((k) => actual.includes(k));
}

function parseNode(raw: unknown): InfographicNode {
  if (!isRecord(raw) || !exactKeys(raw, ["id", "label", "x", "y"])) {
    fail("bad document");
  }
  const { id, label, x, y } = raw;
  if (typeof id !== "string" || !ID_RE.test(id)) {
    fail("bad id");
  }
  if (typeof label !== "string") {
    fail("bad document");
  }
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
    fail("bad document");
  }
  return { id, label, x, y };
}

function parseEdge(raw: unknown): InfographicEdge {
  if (!isRecord(raw)) {
    fail("bad document");
  }
  const keys = Object.keys(raw);
  const hasLabel = keys.includes("label");
  if (hasLabel) {
    if (!exactKeys(raw, ["from", "to", "label"]) || typeof raw.label !== "string") {
      fail("bad document");
    }
  } else if (!exactKeys(raw, ["from", "to"])) {
    fail("bad document");
  }
  const { from, to } = raw;
  if (typeof from !== "string" || !ID_RE.test(from) || typeof to !== "string" || !ID_RE.test(to)) {
    fail("bad id");
  }
  if (hasLabel) {
    return { from, to, label: raw.label as string };
  }
  return { from, to };
}

function assertDocument(doc: InfographicDocument): InfographicDocument {
  const ids = new Set<string>();
  for (const node of doc.nodes) {
    if (ids.has(node.id)) {
      fail("duplicate id");
    }
    ids.add(node.id);
  }
  const edgeKeys = new Set<string>();
  for (const edge of doc.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      fail("unknown node");
    }
    const key = `${edge.from}\0${edge.to}`;
    if (edgeKeys.has(key)) {
      fail("duplicate edge");
    }
    edgeKeys.add(key);
  }
  checkRemoteUrls(doc);
  return doc;
}

export function parseDocument(raw: string): InfographicDocument {
  if (Buffer.byteLength(raw, "utf8") > INFOGRAPHIC_MAX_BYTES) {
    fail("too large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("bad json");
  }
  if (!isRecord(parsed) || !exactKeys(parsed, ["nodes", "edges"])) {
    fail("bad document");
  }
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    fail("bad document");
  }
  const nodes = parsed.nodes.map(parseNode);
  const edges = parsed.edges.map(parseEdge);
  return assertDocument({ nodes, edges });
}

function cloneDoc(doc: InfographicDocument): InfographicDocument {
  return {
    nodes: doc.nodes.map((n) => ({ ...n })),
    edges: doc.edges.map((e) => (e.label === undefined ? { from: e.from, to: e.to } : { ...e })),
  };
}

function isOp(value: unknown): value is InfographicOp {
  if (!isRecord(value) || typeof value.op !== "string") {
    return false;
  }
  switch (value.op) {
    case "addNode":
      return exactKeys(value, ["op", "id", "label", "x", "y"]);
    case "updateNode": {
      const keys = Object.keys(value);
      if (!keys.includes("op") || !keys.includes("id") || typeof value.id !== "string") {
        return false;
      }
      const allowed = new Set(["op", "id", "label", "x", "y"]);
      if (keys.some((k) => !allowed.has(k))) {
        return false;
      }
      return keys.includes("label") || keys.includes("x") || keys.includes("y");
    }
    case "removeNode":
      return exactKeys(value, ["op", "id"]);
    case "addEdge": {
      const keys = Object.keys(value);
      if (!keys.includes("op") || !keys.includes("from") || !keys.includes("to")) {
        return false;
      }
      const allowed = new Set(["op", "from", "to", "label"]);
      if (keys.some((k) => !allowed.has(k))) {
        return false;
      }
      if (keys.includes("label") && typeof value.label !== "string") {
        return false;
      }
      return true;
    }
    case "removeEdge":
      return exactKeys(value, ["op", "from", "to"]);
    default:
      return false;
  }
}

export function applyOps(doc: InfographicDocument, ops: unknown): InfographicDocument {
  if (!Array.isArray(ops) || ops.length < 1) {
    fail("empty ops");
  }
  const next = cloneDoc(doc);
  for (const rawOp of ops) {
    if (!isOp(rawOp)) {
      fail("bad op");
    }
    switch (rawOp.op) {
      case "addNode": {
        if (next.nodes.some((n) => n.id === rawOp.id)) {
          fail("duplicate id");
        }
        if (typeof rawOp.id !== "string" || typeof rawOp.label !== "string") {
          fail("bad op");
        }
        if (typeof rawOp.x !== "number" || typeof rawOp.y !== "number") {
          fail("bad op");
        }
        next.nodes.push({ id: rawOp.id, label: rawOp.label, x: rawOp.x, y: rawOp.y });
        break;
      }
      case "updateNode": {
        const node = next.nodes.find((n) => n.id === rawOp.id);
        if (!node) {
          fail("unknown node");
        }
        if (rawOp.label !== undefined) {
          if (typeof rawOp.label !== "string") {
            fail("bad op");
          }
          node.label = rawOp.label;
        }
        if (rawOp.x !== undefined) {
          if (typeof rawOp.x !== "number") {
            fail("bad op");
          }
          node.x = rawOp.x;
        }
        if (rawOp.y !== undefined) {
          if (typeof rawOp.y !== "number") {
            fail("bad op");
          }
          node.y = rawOp.y;
        }
        break;
      }
      case "removeNode": {
        const idx = next.nodes.findIndex((n) => n.id === rawOp.id);
        if (idx < 0) {
          fail("unknown node");
        }
        next.nodes.splice(idx, 1);
        next.edges = next.edges.filter((e) => e.from !== rawOp.id && e.to !== rawOp.id);
        break;
      }
      case "addEdge": {
        if (typeof rawOp.from !== "string" || typeof rawOp.to !== "string") {
          fail("bad op");
        }
        if (!next.nodes.some((n) => n.id === rawOp.from) || !next.nodes.some((n) => n.id === rawOp.to)) {
          fail("unknown node");
        }
        if (next.edges.some((e) => e.from === rawOp.from && e.to === rawOp.to)) {
          fail("duplicate edge");
        }
        const edge: InfographicEdge = { from: rawOp.from, to: rawOp.to };
        if (rawOp.label !== undefined) {
          edge.label = rawOp.label;
        }
        next.edges.push(edge);
        break;
      }
      case "removeEdge": {
        const idx = next.edges.findIndex((e) => e.from === rawOp.from && e.to === rawOp.to);
        if (idx < 0) {
          fail("unknown edge");
        }
        next.edges.splice(idx, 1);
        break;
      }
    }
  }
  return parseDocument(JSON.stringify(next, null, 2) + "\n");
}
