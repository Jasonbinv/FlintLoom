import { INFOGRAPHIC_MAX_BYTES } from "./types.ts";

export { INFOGRAPHIC_MAX_BYTES } from "./types.ts";

/** Templates that exist in @antv/infographic and render reliably in chat. */
export const ANTV_CHAT_TEMPLATES = {
  steps: "list-column-simple-vertical-arrow",
  timeline: "list-row-simple-horizontal-arrow",
  compare: "compare-binary-horizontal-simple-vs",
  cards: "list-grid-compact-card",
  sequence: "sequence-steps-simple",
  mindmap: "hierarchy-mindmap-branch-gradient-capsule-item",
  tree: "hierarchy-tree-tech-style-capsule-item",
  org: "hierarchy-structure",
} as const;

const TEMPLATE_ALIASES: Record<string, string> = {
  steplist: ANTV_CHAT_TEMPLATES.steps,
  "step-list": ANTV_CHAT_TEMPLATES.steps,
  steps: ANTV_CHAT_TEMPLATES.steps,
  step: ANTV_CHAT_TEMPLATES.steps,
  process: ANTV_CHAT_TEMPLATES.steps,
  workflow: ANTV_CHAT_TEMPLATES.steps,
  decision: ANTV_CHAT_TEMPLATES.steps,
  branch: ANTV_CHAT_TEMPLATES.steps,
  cards: ANTV_CHAT_TEMPLATES.cards,
  card: ANTV_CHAT_TEMPLATES.cards,
  timeline: ANTV_CHAT_TEMPLATES.timeline,
  milestone: ANTV_CHAT_TEMPLATES.timeline,
  roadmap: ANTV_CHAT_TEMPLATES.timeline,
  list: ANTV_CHAT_TEMPLATES.timeline,
  flow: ANTV_CHAT_TEMPLATES.sequence,
  flowchart: ANTV_CHAT_TEMPLATES.sequence,
  compare: ANTV_CHAT_TEMPLATES.compare,
  vs: ANTV_CHAT_TEMPLATES.compare,
  versus: ANTV_CHAT_TEMPLATES.compare,
  "compare-binary-simple-horizontal": ANTV_CHAT_TEMPLATES.compare,
  tree: ANTV_CHAT_TEMPLATES.tree,
  hierarchy: ANTV_CHAT_TEMPLATES.tree,
  mindmap: ANTV_CHAT_TEMPLATES.mindmap,
  "mind-map": ANTV_CHAT_TEMPLATES.mindmap,
  org: ANTV_CHAT_TEMPLATES.org,
};

const KNOWN_TEMPLATE_PREFIXES = [
  "list-",
  "compare-",
  "hierarchy-",
  "sequence-",
  "relation-",
  "chart-",
];

const STEP_RE = /^(?:step\s+)?(\d+)\s*[:：.、)]\s*(.+)$/i;
const QUARTER_RE = /^(?:(20\d{2}|FY\s*\d{2,4})\s*)?(Q[1-4])\s*[:：.、)\-–—]\s*(.+)$/i;
const MILESTONE_RE =
  /^(?:里程碑|阶段|phase|milestone|quarter|week|sprint)\s*([A-Za-z0-9]+|\d+)\s*[:：.、)]\s*(.+)$/i;
const INLINE_QUARTER_RE = /(?:20\d{2}\s*)?Q[1-4]\s*[:：.、)\-–—]/gi;
const BULLET_RE = /^[-*•]\s+(.+)$/;
const OFFICIAL_KEY_RE = /^(data|lists|compares|sequences|nodes|values|root|theme|design|template)$/i;

type Item = { label: string; desc?: string };

type TreeNode = { label: string; desc?: string; children: TreeNode[]; indent: number };

type TreeTok =
  | { kind: "root"; indent: number }
  | { kind: "children"; indent: number }
  | { kind: "label"; indent: number; value: string }
  | { kind: "desc"; indent: number; value: string };

function fail(message: string): never {
  throw new Error(message);
}

function normalizeTemplateKey(name: string): string {
  return name.trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function resolveTemplateName(raw: string): string {
  const key = normalizeTemplateKey(raw);
  if (TEMPLATE_ALIASES[key]) return TEMPLATE_ALIASES[key];
  if (KNOWN_TEMPLATE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    if (key === "compare-binary-simple-horizontal") return ANTV_CHAT_TEMPLATES.compare;
    return raw;
  }
  return ANTV_CHAT_TEMPLATES.steps;
}

function isHierarchyTemplate(template: string): boolean {
  return template.startsWith("hierarchy-mindmap") || template.startsWith("hierarchy-tree") || template.startsWith("hierarchy-structure");
}

function dataFieldFor(template: string): "lists" | "compares" | "sequences" {
  const prefix = template.split("-")[0];
  if (prefix === "compare") return "compares";
  if (prefix === "sequence") return "sequences";
  return "lists";
}

function hasOfficialDataBlock(body: string): boolean {
  return /^\s*data\b/m.test(body) && /^\s*(lists|compares|sequences|nodes|values|root)\b/m.test(body);
}

function hasYamlishColons(body: string): boolean {
  return /^\s*-?\s*label\s*[:：]/m.test(body) || /^\s*(root|children)\s*[:：]\s*$/m.test(body);
}

function isWellFormedHierarchy(body: string): boolean {
  return (
    /^\s*data\b/m.test(body) &&
    /^\s*root\b/m.test(body) &&
    /^\s*-\s+label\s+\S/m.test(body) &&
    !hasYamlishColons(body)
  );
}

function looksLikeBranchLabel(label: string): boolean {
  return /^(?:\d+\s*[\.、．)]|[一二三四五六七八九十百]+[、.．])/u.test(label);
}

function flattenIgValue(value: string): string {
  return value.replace(/\s*->\s*/g, " → ").replace(/\s+/g, " ").trim();
}

function matchHeading(line: string): Item | undefined {
  const quarter = line.match(QUARTER_RE);
  if (quarter?.[2] && quarter[3]) {
    const year = quarter[1]?.replace(/\s+/g, "") ?? "";
    const label = year ? `${year} ${quarter[2].toUpperCase()}` : quarter[2].toUpperCase();
    return { label, desc: quarter[3].trim() };
  }
  const milestone = line.match(MILESTONE_RE);
  if (milestone?.[1] && milestone[2]) {
    return { label: milestone[1], desc: milestone[2].trim() };
  }
  const step = line.match(STEP_RE);
  if (step?.[2]) return { label: step[2].trim() };
  return undefined;
}

function splitInlineQuarters(text: string): Item[] {
  const matches = [...text.matchAll(INLINE_QUARTER_RE)];
  if (matches.length < 2) return [];
  const items: Item[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const start = match.index ?? 0;
    const head = text.slice(start, start + match[0].length);
    const parsed = matchHeading(`${head}${text.slice(start + match[0].length, matches[i + 1]?.index ?? text.length)}`);
    if (parsed) items.push(parsed);
  }
  return items;
}

function parseInventedItems(lines: string[]): Item[] {
  const items: Item[] = [];
  let current: { label: string; desc: string[] } | undefined;
  let fromTitle = false;
  let fromBullets = false;
  const flush = () => {
    if (!current) return;
    const desc = current.desc.join(" ").trim();
    items.push(desc ? { label: current.label, desc } : { label: current.label });
    current = undefined;
    fromTitle = false;
    fromBullets = false;
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (fromBullets) flush();
      continue;
    }
    if (OFFICIAL_KEY_RE.test(trimmed)) {
      return [];
    }
    const bullet = trimmed.match(BULLET_RE);
    if (bullet?.[1]) {
      if (current && fromTitle) {
        current.desc.push(flattenIgValue(bullet[1]));
        fromBullets = true;
      } else {
        flush();
        current = { label: flattenIgValue(bullet[1]), desc: [] };
        fromTitle = false;
        fromBullets = false;
      }
      continue;
    }
    const heading = matchHeading(trimmed);
    if (heading) {
      flush();
      current = { label: heading.label, desc: heading.desc ? [heading.desc] : [] };
      fromTitle = true;
      fromBullets = false;
      continue;
    }
    if (current && fromTitle && !fromBullets) {
      current.desc.push(flattenIgValue(trimmed));
      continue;
    }
    flush();
    current = { label: flattenIgValue(trimmed), desc: [] };
    fromTitle = true;
    fromBullets = false;
  }
  flush();
  if (items.length > 0) return items;
  return splitInlineQuarters(lines.join(" "));
}

function splitBranchChildren(item: Item): string[] {
  if (!item.desc) return [];
  const parts = item.desc
    .split(/[、,;；]/)
    .map((part) => flattenIgValue(part))
    .filter((part) => part.length > 0 && part.length <= 40);
  if (parts.length >= 2) return parts.slice(0, 8);
  return item.desc.length <= 28 ? [flattenIgValue(item.desc)] : [];
}

function parseYamlishTokens(lines: string[]): TreeTok[] {
  const toks: TreeTok[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    const trimmed = line.trim();
    if (/^(data|theme|design|template)[:：]?$/i.test(trimmed)) continue;
    if (/^root[:：]?$/i.test(trimmed)) {
      toks.push({ kind: "root", indent });
      continue;
    }
    if (/^children[:：]?$/i.test(trimmed)) {
      toks.push({ kind: "children", indent });
      continue;
    }
    const label = trimmed.match(/^(?:-\s*)?label(?:\s*[:：]\s*|\s+)(.+)$/i);
    if (label?.[1]) {
      toks.push({ kind: "label", indent, value: flattenIgValue(label[1].replace(/[:：]$/, "")) });
      continue;
    }
    const desc = trimmed.match(/^(?:-\s*)?desc(?:\s*[:：]\s*|\s+)(.+)$/i);
    if (desc?.[1]) {
      toks.push({ kind: "desc", indent, value: flattenIgValue(desc[1].replace(/[:：]$/, "")) });
    }
  }
  return toks;
}

function labelIndentsVary(toks: TreeTok[]): boolean {
  const indents = toks.filter((tok) => tok.kind === "label").map((tok) => tok.indent);
  if (indents.length < 2) return false;
  return Math.max(...indents) - Math.min(...indents) >= 2;
}

function buildTreeByIndent(toks: TreeTok[]): TreeNode | undefined {
  let root: TreeNode | undefined;
  const stack: TreeNode[] = [];
  for (const tok of toks) {
    if (tok.kind === "root") {
      root = { label: "", children: [], indent: tok.indent };
      stack.length = 0;
      stack.push(root);
      continue;
    }
    if (tok.kind === "children") continue;
    if (tok.kind === "desc") {
      const current = stack[stack.length - 1];
      if (current) current.desc = tok.value;
      continue;
    }
    if (!root) {
      root = { label: tok.value, children: [], indent: tok.indent };
      stack.push(root);
      continue;
    }
    const current = stack[stack.length - 1];
    if (current && !current.label) {
      current.label = tok.value;
      continue;
    }
    while (stack.length > 1 && stack[stack.length - 1]!.indent >= tok.indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (!parent) continue;
    const node: TreeNode = { label: tok.value, children: [], indent: tok.indent };
    parent.children.push(node);
    stack.push(node);
  }
  return root;
}

function buildTreeByMarkers(toks: TreeTok[]): TreeNode | undefined {
  let i = 0;
  const root: TreeNode = { label: "", children: [], indent: 0 };
  while (i < toks.length && toks[i]!.kind === "root") i += 1;
  if (toks[i]?.kind === "label") {
    root.label = toks[i]!.value;
    i += 1;
  }
  if (toks[i]?.kind === "desc") {
    root.desc = toks[i]!.value;
    i += 1;
  }
  if (toks[i]?.kind === "children") i += 1;
  while (i < toks.length) {
    const tok = toks[i]!;
    if (tok.kind === "desc") {
      if (!root.desc) root.desc = tok.value;
      i += 1;
      continue;
    }
    if (tok.kind !== "label") {
      i += 1;
      continue;
    }
    const branch: TreeNode = { label: tok.value, children: [], indent: tok.indent };
    i += 1;
    if (toks[i]?.kind === "desc") {
      branch.desc = toks[i]!.value;
      i += 1;
    }
    if (toks[i]?.kind === "children") {
      i += 1;
      while (i < toks.length && toks[i]!.kind === "label") {
        const following = toks.slice(i + 1).find((next) => next.kind !== "desc");
        if (following?.kind === "children") break;
        if (looksLikeBranchLabel(toks[i]!.value) && looksLikeBranchLabel(branch.label)) break;
        const leaf: TreeNode = { label: toks[i]!.value, children: [], indent: toks[i]!.indent };
        i += 1;
        if (toks[i]?.kind === "desc") {
          leaf.desc = toks[i]!.value;
          i += 1;
        }
        branch.children.push(leaf);
      }
    }
    root.children.push(branch);
  }
  return root;
}

function parseYamlishTree(lines: string[]): TreeNode | undefined {
  const toks = parseYamlishTokens(lines);
  if (toks.length === 0) return undefined;
  if (!toks.some((tok) => tok.kind === "root" || tok.kind === "children")) return undefined;
  const tree = labelIndentsVary(toks) ? buildTreeByIndent(toks) : buildTreeByMarkers(toks);
  if (!tree) return undefined;
  if (!tree.label && tree.children.length > 0) tree.label = "中心主题";
  if (!tree.label) return undefined;
  return tree;
}

function emitTreeChildren(nodes: TreeNode[], depth: number, lines: string[]): void {
  const pad = " ".repeat(depth * 2);
  const inner = " ".repeat(depth * 2 + 2);
  for (const node of nodes) {
    lines.push(`${pad}- label ${flattenIgValue(node.label)}`);
    if (node.desc) lines.push(`${inner}desc ${flattenIgValue(node.desc)}`);
    if (node.children.length > 0) {
      lines.push(`${inner}children`);
      emitTreeChildren(node.children, depth + 2, lines);
    }
  }
}

function emitTreeBlock(root: TreeNode): string {
  const lines = ["data", "  root", `    label ${flattenIgValue(root.label)}`];
  if (root.desc) lines.push(`    desc ${flattenIgValue(root.desc)}`);
  if (root.children.length > 0) {
    lines.push("    children");
    emitTreeChildren(root.children, 3, lines);
  }
  return lines.join("\n");
}

function emitMindmapBlock(items: Item[]): string {
  const titledRoot = items[0] && !items[0].desc && items.length > 1;
  const rootLabel = titledRoot ? items[0]!.label : "中心主题";
  const branches = titledRoot ? items.slice(1) : items;
  const lines = ["data", "  root", `    label ${flattenIgValue(rootLabel)}`, "    children"];
  for (const branch of branches) {
    lines.push(`      - label ${flattenIgValue(branch.label)}`);
    const kids = splitBranchChildren(branch);
    if (kids.length > 0) {
      lines.push("        children");
      for (const kid of kids) {
        lines.push(`          - label ${kid}`);
      }
    } else if (branch.desc) {
      lines.push(`        desc ${flattenIgValue(branch.desc)}`);
    }
  }
  return lines.join("\n");
}

function emitDataBlock(field: "lists" | "compares" | "sequences", items: Item[]): string {
  return [
    "data",
    `  ${field}`,
    ...items.flatMap((item) => {
      const rows = [`    - label ${flattenIgValue(item.label)}`];
      if (item.desc) rows.push(`      desc ${flattenIgValue(item.desc)}`);
      return rows;
    }),
  ].join("\n");
}

export function repairAntvSyntax(raw: string): string {
  const text = raw.trim();
  const lines = text.split(/\r?\n/);
  const first = lines[0] ?? "";
  const head = first.match(/^\s*infographic(?:\s+(\S+))?/i);
  if (!head) return text;
  const template = resolveTemplateName(head[1] ?? ANTV_CHAT_TEMPLATES.timeline);
  const bodyLines = lines.slice(1);
  const rest = bodyLines.join("\n");
  if (isHierarchyTemplate(template) && !isWellFormedHierarchy(rest)) {
    const tree = parseYamlishTree(bodyLines);
    if (tree) {
      return `infographic ${template}\n${emitTreeBlock(tree)}`;
    }
  }
  if (hasOfficialDataBlock(rest) && !hasYamlishColons(rest)) {
    return `infographic ${template}\n${rest}`.trim();
  }
  const items = parseInventedItems(bodyLines);
  if (items.length === 0) {
    return `infographic ${template}\n${rest}`.trim();
  }
  const body = isHierarchyTemplate(template)
    ? emitMindmapBlock(items)
    : emitDataBlock(dataFieldFor(template), items);
  return `infographic ${template}\n${body}`;
}

export function parseAntvSyntax(raw: string): string {
  if (Buffer.byteLength(raw, "utf8") > INFOGRAPHIC_MAX_BYTES) {
    fail("too large");
  }
  if (raw.includes("http://") || raw.includes("https://")) {
    fail("remote url");
  }
  const text = raw.trim();
  if (!/^\s*infographic\b/i.test(text)) {
    fail("bad syntax");
  }
  return repairAntvSyntax(text);
}
