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
