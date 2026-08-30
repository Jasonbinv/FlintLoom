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

Use this skill for steps, timelines, compare, hierarchy, posters. Use box-line JSON only for simple node/edge graphs.

## Hard rules

- First line must be `infographic <template-name>`.
- Two-space indent. `key value` pairs. Lists use `-`.
- **No** `http://` or `https://` (emit fails with `remote url`).
- **No** remote `icon` URLs. Omit `icon` unless it is a local keyword with no URL.
- Do not invent `type` / `input` / `form` keys on A2UI envelopes.
- Do not fall back to Chart `kind: "bar"` when the user asked for an infographic.

## Write a workspace file

Save syntax as `name.infographic.ig` (suffix must be exactly `.infographic.ig`). Host preview returns the syntax; the desktop renders it.

## Show in chat (A2UI)

**Prefer this.** Call `a2ui_emit` with **only** `syntax` — do not invent `messages`, `type`, `kind`, or `version: "0.9"`.

```json
{
  "syntax": "infographic list-row-simple-horizontal-arrow\ndata\n  lists\n    - label Step 1\n      desc Start\n    - label Step 2\n      desc Next\n    - label Step 3\n      desc Done\n"
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

Other useful templates: `list-column-simple-vertical-arrow`, `compare-binary-simple-horizontal`, `hierarchy-tree-simple`. Keep item count small (≤12).
