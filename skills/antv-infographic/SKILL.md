---
name: AntV Infographic
description: Use when the user wants an AntV infographic in FlintLoom chat or a .infographic.ig file — timeline, steps, compare, SWOT, mind map, tree, relation graph, sequence, word cloud, or chart-style poster (not a box-and-line *.infographic.json graph).
---

# AntV infographic in FlintLoom

Two engines. Do not mix `syntax` with box-line `document`.

| Kind | Files / A2UI | Tools |
|------|----------------|-------|
| Box-line | `*.infographic.json` + `nodes` / `edges` | `infographic_get` / `infographic_patch` |
| AntV (this skill) | `*.infographic.ig` or A2UI `syntax` | `a2ui_emit` with **only** `syntax` |

Desktop already renders `@antv/infographic`. Do not write HTML, `unpkg`, or follow Infographic-repo creator skills.

## Hard rules

- First line: `infographic <template-name>`.
- Two-space indent. `key value` (space, not `label:`). Lists: `- label …`.
- One data field that matches the family.
- No `http://` or `https://` (emit fails). Icons: keyword only (`rocket`, `shield check`), never URLs.
- Official names starting with `list-` / `sequence-` / `compare-` / `hierarchy-` / `relation-` / `chart-` pass through. Do not rename them to `stepList`.
- Aliases `stepList` / `timeline` / `compare` / `cards` / `mindmap` / `tree` / `org` / `quadrant` / `四象限` are repaired.
- 思维导图 / mind map → `mindmap` or `hierarchy-mindmap-*`. Never `stepList`.
- 四象限图 / quadrant / 2×2 矩阵 → `compare-quadrant-*`. Never `compare-swot` (that is four letter-card columns, not XY axes).
- Do not invent `compare-binary-simple-horizontal` or `hierarchy-tree-simple`.
- Do not fall back to A2UI Chart `kind: "bar"` when the user asked for an infographic.

## Pick a family, then one template

| Want | Use this name | Data |
|------|----------------|------|
| Vertical steps | `list-column-simple-vertical-arrow` | `lists` |
| Timeline / milestones | `list-row-simple-horizontal-arrow` | `lists` |
| Numbered sequence | `sequence-steps-simple` | `sequences` |
| Card grid | `list-grid-compact-card` | `lists` |
| Two-side compare | `compare-binary-horizontal-simple-vs` | `compares` (exactly 2 roots; details in `children`) |
| SWOT | `compare-swot` | `compares` (4 roots; each **must** have `children` `- label` points — never put points in root `desc`) |
| 四象限 / 2×2 | `compare-quadrant-quarter-simple-card` | `compares` (exactly 4 roots: `label` + `desc` + optional `icon`. Never `compare-swot`) |
| 圆形四象限 | `compare-quadrant-quarter-circular` | same 4 roots (`label` + `desc`) |
| Mind map | `hierarchy-mindmap-branch-gradient-capsule-item` | `root` + `children` |
| Tree / org | `hierarchy-tree-tech-style-capsule-item` | `root` + `children` |
| Relation / dependency | `relation-dagre-flow-tb-simple-circle-node` | `nodes` + `relations` |
| Swimlane interaction | `sequence-interaction-default-compact-card` | `sequences` (lanes + `children`) + `relations` |
| Numeric trend / compare | `chart-line-plain-text` / `chart-bar-plain-text` / `chart-column-simple` / `chart-pie-plain-text` | `values` |
| Word cloud | `chart-wordcloud` | `values` |

Other real names in the same family are fine. Keep ≤12 items. Match label language to the user.

Heading + bullet prose and YAML `root` / `label:` / `children:` are repaired for list / compare / mindmap only. SWOT, relation, chart, and sequence-interaction need the official nested DSL below. A true decision tree with many `->` branches is still better as box-line JSON or a `relation-*` graph, not `stepList`.

## Official body

```
infographic <template>
data
  title 可选标题
  lists|sequences|compares|root|nodes|values
theme
  palette #3b82f6 #8b5cf6 #f97316
```

- `compare-binary-*`: two roots only; items go in each side's `children`.
- `compare-swot`: four roots (`优势` / `劣势` / `机遇` / `威胁`). The colored letter-card only shows the title; every bullet must be `children` / `- label`. Root `desc` is ignored.
- `compare-quadrant-*`: exactly 4 roots in order 左上、右上、左下、右下. Use `label` + `desc` (optional `icon`). Do not use `children`. Never substitute `compare-swot`.
- `relation-*`: `nodes` with `label` (optional `id`); `relations` as `A - 说明 -> B`.
- `chart-*`: `values` with `label` + numeric `value`.
- `hierarchy-*`: one `root`, nest `children` / `- label`.

## Show in chat

Call `a2ui_emit` with **only** `syntax`.

```json
{"syntax":"infographic compare-swot\ndata\n  compares\n    - label 优势\n      children\n        - label 品牌认知\n    - label 劣势\n      children\n        - label 成本高\n    - label 机会\n      children\n        - label 新品类\n    - label 威胁\n      children\n        - label 竞品\n"}
```

四象限:

```json
{"syntax":"infographic compare-quadrant-quarter-simple-card\ndata\n  title 风险控制\n  desc 风险频率与损失程度\n  compares\n    - label 高频高损\n      desc 直接规避风险\n    - label 低频高损\n      desc 采取风险控制措施\n    - label 高频低损\n      desc 通过保险转移风险\n    - label 低频低损\n      desc 选择接受风险\n"}
```

Mind map: `infographic mindmap` plus title + branches, or official `data.root`. Relation: `nodes` + `relations`. Chart: `values`.

Saved file suffix must be `.infographic.ig`. `syntax`, `document`, `file`, and `data` are mutually exclusive.

If you must emit envelopes, each item needs `"version": "v0.9"` and exactly one of `createSurface` / `updateComponents`. Never put `type` or `kind` on the envelope.
