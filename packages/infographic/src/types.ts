export const INFOGRAPHIC_MAX_BYTES = 65536;

export type InfographicNode = {
  id: string;
  label: string;
  x: number;
  y: number;
};

export type InfographicEdge = {
  from: string;
  to: string;
  label?: string;
};

export type InfographicDocument = {
  nodes: InfographicNode[];
  edges: InfographicEdge[];
};

export type InfographicOp =
  | { op: "addNode"; id: string; label: string; x: number; y: number }
  | { op: "updateNode"; id: string; label?: string; x?: number; y?: number }
  | { op: "removeNode"; id: string }
  | { op: "addEdge"; from: string; to: string; label?: string }
  | { op: "removeEdge"; from: string; to: string };
