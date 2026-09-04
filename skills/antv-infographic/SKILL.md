---
name: AntV Infographic
description: Use when the user wants an AntV infographic in FlintLoom chat or a .infographic.ig file — timeline, steps, compare, SWOT, mind map, tree, relation graph, sequence, word cloud, or chart-style poster (not a box-and-line *.infographic.json graph).
---

# AntV infographic in FlintLoom

Two engines. Do not mix AntV chat posters with box-line `document`.

| Kind | Files | Tools |
|------|----------------|-------|
| Box-line | `*.infographic.json` + `nodes` / `edges` | `infographic_get` / `infographic_patch` |
| AntV (this skill) | chat poster or `*.infographic.ig` | **`infographic_render`** with `template` + `items` |

Desktop already renders `@antv/infographic`. Do not write HTML, `unpkg`, or follow Infographic-repo creator skills. Do not call `a2ui_emit` for infographics.

## Hard rules

- Call **`infographic_render`**. Pass `template` plus `items[{label, desc?, children?}]`. Optional `syntax` is a full official DSL block if items cannot express the graph (relation / chart).
- Official names starting with `list-` / `sequence-` / `compare-` / `hierarchy-` / `relation-` / `chart-` pass through. Do not rename them to `stepList`.
- Aliases `steps` / `timeline` / `compare` / `cards` / `mindmap` / `tree` / `org` / `quadrant` / `swot` / `四象限` are repaired.
- 思维导图 / mind map → `mindmap` or `hierarchy-mindmap-*`. Never `stepList`.
- 四象限图 / quadrant / 2×2 矩阵 / 艾森豪威尔 / Eisenhower → `compare-quadrant-*`. Never `compare-swot` (that is four letter-card columns, not XY axes). Never put AntV `compares` into A2UI `updateDataModel`.
- Do not invent `compare-binary-simple-horizontal` or `hierarchy-tree-simple`.
- Do not fall back to A2UI Chart `kind: "bar"` when the user asked for an infographic.
- If the user asked for a chart, table, button, or picker (not an infographic poster), use `a2ui_emit`. Do not offer infographic after `a2ui_emit` fails.
- No `http://` or `https://`. Icons: keyword only (`rocket`, `shield check`), never URLs.

## Pick a family, then one template

| Want | Use this name | Data |
|------|----------------|------|
| Vertical steps | `list-column-simple-vertical-arrow` or alias `steps` | `items` |
| Timeline / milestones | `list-row-simple-horizontal-arrow` or alias `timeline` | `items` |
| Numbered sequence | `sequence-steps-simple` | `items` |
| Card grid | `list-grid-compact-card` | `items` |
| Two-side compare | `compare-binary-horizontal-simple-vs` or alias `compare` | `items` (exactly 2 roots; details in `children`) |
| SWOT | `compare-swot` or alias `swot` | `items` (4 roots; each **must** have `children` `- label` points — never put points in root `desc`) |
| 四象限 / 2×2 | `compare-quadrant-quarter-simple-card` or alias `quadrant` | `items` (exactly 4 roots: `label` + `desc` + optional `icon`. Never `compare-swot`) |
| 圆形四象限 | `compare-quadrant-quarter-circular` | same 4 roots (`label` + `desc`) |
| Mind map | `hierarchy-mindmap-branch-gradient-capsule-item` or alias `mindmap` | `items` as branches (`label`; nest further labels in `children`) |
| Tree / org | `hierarchy-tree-tech-style-capsule-item` | `items` as branches |
| Relation / dependency | `relation-dagre-flow-tb-simple-circle-node` | optional `syntax` with `nodes` + `relations` |
| Swimlane interaction | `sequence-interaction-default-compact-card` | optional `syntax` with `sequences` + `relations` |
| Numeric trend / compare | `chart-line-plain-text` / `chart-bar-plain-text` / `chart-column-simple` / `chart-pie-plain-text` | optional `syntax` with `values` |
| Word cloud | `chart-wordcloud` | optional `syntax` with `values` |

Other real names in the same family are fine. Keep ≤12 items. Match label language to the user.

A true decision tree with many `->` branches is still better as box-line JSON or a `relation-*` graph, not `steps`.

## Show in chat

Call `infographic_render` with `template` and `items`. Do not call `a2ui_emit`.

SWOT:

```json
{
  "template": "swot",
  "items": [
    { "label": "优势", "children": ["品牌认知"] },
    { "label": "劣势", "children": ["成本高"] },
    { "label": "机遇", "children": ["新品类"] },
    { "label": "威胁", "children": ["竞品"] }
  ]
}
```

四象限:

```json
{
  "template": "quadrant",
  "title": "风险控制",
  "items": [
    { "label": "高频高损", "desc": "直接规避风险" },
    { "label": "低频高损", "desc": "采取风险控制措施" },
    { "label": "高频低损", "desc": "通过保险转移风险" },
    { "label": "低频低损", "desc": "选择接受风险" }
  ]
}
```

Steps: `template` `steps` plus ordered `items` with `label` and optional `desc`. Mind map: `template` `mindmap` plus branch `items`. Relation / chart: pass `syntax` starting with `infographic <template>` and official `nodes`/`relations` or `values`.

If you must pass `syntax`, first line is `infographic <template-name>`, two-space indent, `key value` (space, not `label:`), lists as `- label …`. One data field that matches the family.

Saved file suffix must be `.infographic.ig`.
