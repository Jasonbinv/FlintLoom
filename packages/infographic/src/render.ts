import type { InfographicDocument, InfographicNode } from "./types.ts";

const NODE_W = 120;
const NODE_H = 40;
const PAD = 24;
const STROKE = "#e8e8e8";
const FILL = "#1a1a1a";

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function nodeCenter(node: InfographicNode): { cx: number; cy: number } {
  return { cx: node.x + NODE_W / 2, cy: node.y + NODE_H / 2 };
}

function arrowHead(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const size = 8;
  const bx = x2 - ux * size;
  const by = y2 - uy * size;
  const px = -uy * (size / 2);
  const py = ux * (size / 2);
  const points = `${x2},${y2} ${bx + px},${by + py} ${bx - px},${by - py}`;
  return `<polygon points="${points}" fill="${STROKE}" />`;
}

export function renderSvg(doc: InfographicDocument): string {
  let minX = 0;
  let minY = 0;
  let maxX = 200;
  let maxY = 80;
  if (doc.nodes.length > 0) {
    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;
    for (const node of doc.nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + NODE_W);
      maxY = Math.max(maxY, node.y + NODE_H);
    }
    minX -= PAD;
    minY -= PAD;
    maxX += PAD;
    maxY += PAD;
  }
  const width = maxX - minX;
  const height = maxY - minY;

  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const parts: string[] = [];

  for (const edge of doc.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) {
      continue;
    }
    const a = nodeCenter(from);
    const b = nodeCenter(to);
    parts.push(
      `<line x1="${a.cx}" y1="${a.cy}" x2="${b.cx}" y2="${b.cy}" stroke="${STROKE}" />`,
    );
    parts.push(arrowHead(a.cx, a.cy, b.cx, b.cy));
    if (edge.label !== undefined) {
      const mx = (a.cx + b.cx) / 2;
      const my = (a.cy + b.cy) / 2;
      parts.push(
        `<text x="${mx}" y="${my}" fill="${STROKE}" text-anchor="middle" dominant-baseline="middle">${escapeXml(edge.label)}</text>`,
      );
    }
  }

  for (const node of doc.nodes) {
    parts.push(
      `<rect x="${node.x}" y="${node.y}" width="${NODE_W}" height="${NODE_H}" fill="${FILL}" stroke="${STROKE}" />`,
    );
    const { cx, cy } = nodeCenter(node);
    parts.push(
      `<text x="${cx}" y="${cy}" fill="${STROKE}" text-anchor="middle" dominant-baseline="middle">${escapeXml(node.label)}</text>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}">${parts.join("")}</svg>`;
}
