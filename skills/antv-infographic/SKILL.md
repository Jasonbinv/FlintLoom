---
name: AntV Infographic
description: Render AntV declarative infographics in FlintLoom. Use when the user wants a timeline, step list, comparison, hierarchy, or poster-style infographic (not a box-and-line graph). Read before writing .infographic.ig files or emitting A2UI Infographic syntax.
---

# AntV infographic in FlintLoom

FlintLoom has **two** infographic engines. Do not mix them.

| Kind | Files / A2UI | Tools |
|------|----------------|-------|
| Box-line (existing) | `*.infographic.json` + `document: { nodes, edges }` | `infographic_get` / `infographic_patch` |
| AntV templates (this skill) | `*.infographic.ig` **or** A2UI `syntax` | `fs` write + `a2ui_emit` |

Use this skill for steps, timelines, compare, card grids, and mind maps. Use box-line JSON only for simple node/edge graphs.

## Hard rules

- First line must be `infographic <template-name>`.
- Two-space indent. `key value` pairs. Lists use `-`.
- **No** `http://` or `https://` (emit fails with `remote url`).
- **No** remote `icon` URLs. Omit `icon` unless it is a local keyword with no URL.
- Do not invent `type` / `input` / `form` keys on A2UI envelopes.
- Do not fall back to Chart `kind: "bar"` when the user asked for an infographic.

## Chat-ready templates (use these names)

| Want | Template | Data field |
|------|----------|------------|
| Vertical steps | `list-column-simple-vertical-arrow` | `lists` |
| Horizontal timeline / milestones | `list-row-simple-horizontal-arrow` | `lists` |
| Two-side compare | `compare-binary-horizontal-simple-vs` | `compares` |
| Card grid | `list-grid-compact-card` | `lists` |
| Numbered sequence | `sequence-steps-simple` | `sequences` |
| Mind map | `hierarchy-mindmap-branch-gradient-capsule-item` | `root` + `children` |
| Tree | `hierarchy-tree-tech-style-capsule-item` | `root` + `children` |

Aliases `stepList` / `timeline` / `compare` / `cards` / `mindmap` / `tree` are rewritten to the table above. Heading + bullet prose is repaired into `label` / `desc` or a `root` tree. YAML-style `root` / `label:` / `children:` is also rewritten into official `data.root`.

When the user asks for **思维导图 / mind map**, you MUST use `infographic mindmap` (or the mind-map template). Never substitute `stepList` — that draws a flowchart.

**Do not use** `compare-binary-simple-horizontal` or `hierarchy-tree-simple` — they are not in this AntV build.

## Cannot auto-draw from invented prose

These need official nested DSL (or another tool):

- True decision trees / branching flowcharts (`->` stays text, not a graph)
- SWOT four-quadrant
- Relation networks
- Numeric bar/line infographic posters
- Remote icons or downloaded illustrations

## Write a workspace file

Save syntax as `name.infographic.ig` (suffix must be exactly `.infographic.ig`). Host preview returns the syntax; the desktop renders it.

## Show in chat (A2UI)

**Prefer this.** Call `a2ui_emit` with **only** `syntax`.

```json
{
  "syntax": "infographic list-row-simple-horizontal-arrow\ndata\n  lists\n    - label Step 1\n      desc Start\n    - label Step 2\n      desc Next\n    - label Step 3\n      desc Done\n"
}
```

Mind map example:

```json
{
  "syntax": "infographic mindmap\nAI 学习路径\nStep 1: 数学与编程基础\n线性代数、Python\nStep 2: 机器学习核心\n监督学习、特征工程\n"
}
```

Compare example:

```json
{
  "syntax": "infographic compare-binary-horizontal-simple-vs\ndata\n  compares\n    - label 传统模式\n      desc 手工编码，周期长\n    - label AI 模式\n      desc 自然语言驱动，反馈快\n"
}
```

If you must emit envelopes, each item needs `"version": "v0.9"` (not `"0.9"`) and exactly one of `createSurface` / `updateComponents`. Never put `type` or `kind` on the envelope.

`syntax`, `document`, `file`, and `data` are mutually exclusive. For a saved file use `"file": "steps.infographic.ig"`.

## Minimal syntax

```
infographic list-row-simple-horizontal-arrow
data
  lists
    - label 第一步
      desc 开始
    - label 第二步
      desc 完成
```

Keep item count small (≤12).
