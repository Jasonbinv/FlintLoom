export const CHART_KINDS = [
  "bar",
  "hbar",
  "line",
  "area",
  "scatter",
  "pie",
  "doughnut",
  "radar",
  "heatmap",
] as const;

export type ChartKind = (typeof CHART_KINDS)[number];

const CHART_ALIASES: Record<string, ChartKind> = {
  column: "bar",
  donut: "doughnut",
  barh: "hbar",
  horizontalBar: "hbar",
  "horizontal-bar": "hbar",
  spider: "radar",
  heat_map: "heatmap",
  "heat-map": "heatmap",
};

export function parseChartKind(kind: unknown): ChartKind | undefined {
  if (kind === undefined) return "bar";
  if (typeof kind !== "string") return undefined;
  if ((CHART_KINDS as readonly string[]).includes(kind)) return kind as ChartKind;
  return CHART_ALIASES[kind];
}

const PALETTE = [
  "var(--accent-strong)",
  "var(--success)",
  "var(--warning)",
  "var(--accent-hover)",
  "#8b5cf6",
  "#06b6d4",
  "#f43f5e",
  "#84cc16",
];

export function chartSvg(
  labels: string[],
  values: number[],
  kind: ChartKind = "bar",
): string {
  if (kind === "pie" || kind === "doughnut") {
    return polarSvg(labels, values, kind);
  }
  if (kind === "hbar") {
    return hbarSvg(labels, values);
  }
  if (kind === "radar") {
    return radarSvg(labels, values);
  }
  if (kind === "heatmap") {
    return heatmapSvg(labels, [""], [values]);
  }
  return cartesianSvg(labels, values, kind);
}

function cartesianSvg(
  labels: string[],
  values: number[],
  kind: "bar" | "line" | "area" | "scatter",
): string {
  const width = 360;
  const height = 180;
  const padLeft = 36;
  const padRight = 12;
  const padTop = 12;
  const padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const max = Math.max(...values, 1);
  const n = labels.length;
  const parts: string[] = [];

  const pointAt = (i: number): { x: number; y: number } => {
    const v = values[i] ?? 0;
    const x = padLeft + (i / Math.max(n - 1, 1)) * plotW;
    const y = padTop + plotH - (v / max) * plotH;
    return { x, y };
  };

  if (kind === "bar") {
    const gap = 4;
    const barW = (plotW - gap * Math.max(n - 1, 0)) / Math.max(n, 1);
    for (let i = 0; i < n; i++) {
      const v = values[i] ?? 0;
      const h = (Math.max(v, 0) / max) * plotH;
      const x = padLeft + i * (barW + gap);
      const y = padTop + plotH - h;
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${PALETTE[i % PALETTE.length]}" />`,
      );
      parts.push(
        `<text x="${(x + barW / 2).toFixed(1)}" y="${height - 6}" fill="var(--text-muted)" text-anchor="middle" font-size="10">${escapeXml(labels[i] ?? "")}</text>`,
      );
    }
  } else {
    const coords = labels.map((_, i) => pointAt(i));
    if (kind === "area" && coords.length > 0) {
      const first = coords[0]!;
      const last = coords[coords.length - 1]!;
      const baseY = padTop + plotH;
      const poly = [
        `${first.x.toFixed(1)},${baseY.toFixed(1)}`,
        ...coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
        `${last.x.toFixed(1)},${baseY.toFixed(1)}`,
      ].join(" ");
      parts.push(
        `<polygon fill="color-mix(in srgb, var(--accent) 28%, transparent)" points="${poly}" />`,
      );
    }
    if (kind === "line" || kind === "area") {
      parts.push(
        `<polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}" />`,
      );
    }
    for (let i = 0; i < n; i++) {
      const p = coords[i]!;
      parts.push(
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${kind === "scatter" ? 4 : 3}" fill="${kind === "scatter" ? PALETTE[i % PALETTE.length] : "var(--accent-strong)"}" />`,
      );
      parts.push(
        `<text x="${p.x.toFixed(1)}" y="${height - 6}" fill="var(--text-muted)" text-anchor="middle" font-size="10">${escapeXml(labels[i] ?? "")}</text>`,
      );
    }
  }

  return wrapSvg(width, height, kind, parts.join(""));
}

function hbarSvg(labels: string[], values: number[]): string {
  const width = 360;
  const height = Math.max(120, 28 + labels.length * 28);
  const padLeft = 72;
  const padRight = 16;
  const padTop = 12;
  const padBottom = 12;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const max = Math.max(...values, 1);
  const n = labels.length;
  const gap = 6;
  const barH = (plotH - gap * Math.max(n - 1, 0)) / Math.max(n, 1);
  const parts: string[] = [];

  for (let i = 0; i < n; i++) {
    const v = values[i] ?? 0;
    const w = (Math.max(v, 0) / max) * plotW;
    const y = padTop + i * (barH + gap);
    parts.push(
      `<rect x="${padLeft}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${barH.toFixed(1)}" fill="${PALETTE[i % PALETTE.length]}" />`,
    );
    parts.push(
      `<text x="${padLeft - 8}" y="${(y + barH / 2 + 4).toFixed(1)}" fill="var(--text-muted)" text-anchor="end" font-size="10">${escapeXml(labels[i] ?? "")}</text>`,
    );
  }

  return wrapSvg(width, height, "hbar", parts.join(""));
}

function radarSvg(labels: string[], values: number[]): string {
  const width = 360;
  const height = 220;
  const cx = 180;
  const cy = 108;
  const outerR = 72;
  const n = Math.max(labels.length, 1);
  const max = Math.max(...values.map((v) => Math.max(v, 0)), 1);
  const parts: string[] = [];
  const axisAngle = (i: number): number => -Math.PI / 2 + (i / n) * Math.PI * 2;

  for (const t of [0.33, 0.66, 1]) {
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="${(outerR * t).toFixed(1)}" fill="none" stroke="var(--border-subtle)" stroke-width="1" />`,
    );
  }
  for (let i = 0; i < n; i++) {
    const [x, y] = polar(cx, cy, outerR, axisAngle(i));
    parts.push(
      `<line x1="${cx}" y1="${cy}" x2="${fmt(x)}" y2="${fmt(y)}" stroke="var(--border-subtle)" stroke-width="1" />`,
    );
  }

  const pts = labels.map((_, i) => {
    const v = Math.max(values[i] ?? 0, 0);
    return polar(cx, cy, (v / max) * outerR, axisAngle(i));
  });
  parts.push(
    `<polygon fill="color-mix(in srgb, var(--accent) 28%, transparent)" stroke="var(--accent)" stroke-width="2" points="${pts.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ")}" />`,
  );
  for (const [x, y] of pts) {
    parts.push(`<circle cx="${fmt(x)}" cy="${fmt(y)}" r="3" fill="var(--accent-strong)" />`);
  }

  for (let i = 0; i < labels.length; i++) {
    const [x, y] = polar(cx, cy, outerR + 18, axisAngle(i));
    let anchor = "middle";
    if (x > cx + 6) anchor = "start";
    else if (x < cx - 6) anchor = "end";
    parts.push(
      `<text x="${fmt(x)}" y="${fmt(y + 4)}" fill="var(--text-muted)" text-anchor="${anchor}" font-size="10">${escapeXml(labels[i] ?? "")}</text>`,
    );
  }

  return wrapSvg(width, height, "radar", parts.join(""));
}

export function heatmapSvg(
  xLabels: string[],
  yLabels: string[],
  values: number[][],
): string {
  const cellW = 36;
  const cellH = 28;
  const padLeft = 56;
  const padTop = 10;
  const padRight = 12;
  const padBottom = 28;
  const cols = Math.max(xLabels.length, 1);
  const rows = Math.max(yLabels.length, 1);
  const width = padLeft + cols * cellW + padRight;
  const height = padTop + rows * cellH + padBottom;
  const flat = values.flat();
  const min = flat.length > 0 ? Math.min(...flat) : 0;
  const max = flat.length > 0 ? Math.max(...flat) : 1;
  const span = max - min;
  const parts: string[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = values[r]?.[c] ?? 0;
      const t = span === 0 ? 0.5 : (v - min) / span;
      const pct = Math.round(Math.max(0, Math.min(1, t)) * 100);
      const x = padLeft + c * cellW;
      const y = padTop + r * cellH;
      parts.push(
        `<rect x="${x}" y="${y}" width="${cellW - 2}" height="${cellH - 2}" rx="2" fill="color-mix(in srgb, var(--accent-strong) ${pct}%, var(--border-subtle))" />`,
      );
    }
  }
  for (let c = 0; c < xLabels.length; c++) {
    const x = padLeft + c * cellW + (cellW - 2) / 2;
    parts.push(
      `<text x="${x}" y="${height - 8}" fill="var(--text-muted)" text-anchor="middle" font-size="10">${escapeXml(xLabels[c] ?? "")}</text>`,
    );
  }
  for (let r = 0; r < yLabels.length; r++) {
    const y = padTop + r * cellH + cellH / 2 + 3;
    parts.push(
      `<text x="${padLeft - 6}" y="${y}" fill="var(--text-muted)" text-anchor="end" font-size="10">${escapeXml(yLabels[r] ?? "")}</text>`,
    );
  }

  return wrapSvg(width, height, "heatmap", parts.join(""));
}

function polarSvg(
  labels: string[],
  values: number[],
  kind: "pie" | "doughnut",
): string {
  const width = 360;
  const height = 200;
  const cx = 100;
  const cy = 100;
  const outerR = 78;
  const innerR = kind === "doughnut" ? 42 : 0;
  const weights = values.map((v) => Math.max(v, 0));
  const total = weights.reduce((sum, v) => sum + v, 0);
  const parts: string[] = [];

  if (total <= 0) {
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="${outerR}" fill="none" stroke="var(--border-subtle)" stroke-width="1" />`,
    );
  } else if (weights.filter((v) => v > 0).length === 1) {
    const idx = weights.findIndex((v) => v > 0);
    const color = PALETTE[Math.max(idx, 0) % PALETTE.length];
    if (innerR > 0) {
      parts.push(ringPath(cx, cy, outerR, innerR, -Math.PI / 2, (3 * Math.PI) / 2, color));
    } else {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${outerR}" fill="${color}" />`);
    }
  } else {
    let angle = -Math.PI / 2;
    for (let i = 0; i < labels.length; i++) {
      const sweep = (weights[i]! / total) * Math.PI * 2;
      if (sweep <= 0) continue;
      const next = angle + sweep;
      const color = PALETTE[i % PALETTE.length];
      if (innerR > 0) {
        parts.push(ringPath(cx, cy, outerR, innerR, angle, next, color));
      } else {
        parts.push(slicePath(cx, cy, outerR, angle, next, color));
      }
      angle = next;
    }
  }

  const legendX = 204;
  const legendY0 = Math.max(24, 100 - (labels.length * 18) / 2);
  for (let i = 0; i < labels.length; i++) {
    const y = legendY0 + i * 18;
    parts.push(
      `<rect x="${legendX}" y="${y - 8}" width="10" height="10" rx="2" fill="${PALETTE[i % PALETTE.length]}" />`,
    );
    parts.push(
      `<text x="${legendX + 16}" y="${y}" fill="var(--text-secondary)" font-size="11">${escapeXml(labels[i] ?? "")}</text>`,
    );
  }

  return wrapSvg(width, height, kind, parts.join(""));
}

function slicePath(
  cx: number,
  cy: number,
  r: number,
  start: number,
  end: number,
  fill: string,
): string {
  const [x1, y1] = polar(cx, cy, r, start);
  const [x2, y2] = polar(cx, cy, r, end);
  const large = end - start > Math.PI ? 1 : 0;
  return `<path d="M ${fmt(cx)} ${fmt(cy)} L ${fmt(x1)} ${fmt(y1)} A ${fmt(r)} ${fmt(r)} 0 ${large} 1 ${fmt(x2)} ${fmt(y2)} Z" fill="${fill}" />`;
}

function ringPath(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  start: number,
  end: number,
  fill: string,
): string {
  const [x1, y1] = polar(cx, cy, outerR, start);
  const [x2, y2] = polar(cx, cy, outerR, end);
  const [ix2, iy2] = polar(cx, cy, innerR, end);
  const [ix1, iy1] = polar(cx, cy, innerR, start);
  const large = end - start > Math.PI ? 1 : 0;
  return `<path d="M ${fmt(x1)} ${fmt(y1)} A ${fmt(outerR)} ${fmt(outerR)} 0 ${large} 1 ${fmt(x2)} ${fmt(y2)} L ${fmt(ix2)} ${fmt(iy2)} A ${fmt(innerR)} ${fmt(innerR)} 0 ${large} 0 ${fmt(ix1)} ${fmt(iy1)} Z" fill="${fill}" />`;
}

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

function fmt(n: number): string {
  return n.toFixed(1);
}

function wrapSvg(width: number, height: number, kind: ChartKind, body: string): string {
  return `<svg class="a2ui-chart-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${kind} chart">${body}</svg>`;
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
