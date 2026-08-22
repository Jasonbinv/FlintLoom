export type ChartKind = "bar" | "line";

export function chartSvg(
  labels: string[],
  values: number[],
  kind: ChartKind = "bar",
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

  if (kind === "bar") {
    const gap = 4;
    const barW = (plotW - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      const v = values[i] ?? 0;
      const h = (v / max) * plotH;
      const x = padLeft + i * (barW + gap);
      const y = padTop + plotH - h;
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="var(--accent-strong)" />`,
      );
      const labelX = x + barW / 2;
      parts.push(
        `<text x="${labelX.toFixed(1)}" y="${height - 6}" fill="var(--text-muted)" text-anchor="middle" font-size="10">${escapeXml(labels[i] ?? "")}</text>`,
      );
    }
  } else {
    const points: string[] = [];
    for (let i = 0; i < n; i++) {
      const v = values[i] ?? 0;
      const x = padLeft + (i / Math.max(n - 1, 1)) * plotW;
      const y = padTop + plotH - (v / max) * plotH;
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    parts.push(
      `<polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${points.join(" ")}" />`,
    );
    for (let i = 0; i < n; i++) {
      const v = values[i] ?? 0;
      const x = padLeft + (i / Math.max(n - 1, 1)) * plotW;
      const y = padTop + plotH - (v / max) * plotH;
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="var(--accent-strong)" />`);
      parts.push(
        `<text x="${x.toFixed(1)}" y="${height - 6}" fill="var(--text-muted)" text-anchor="middle" font-size="10">${escapeXml(labels[i] ?? "")}</text>`,
      );
    }
  }

  return `<svg class="a2ui-chart-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="chart">${parts.join("")}</svg>`;
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
