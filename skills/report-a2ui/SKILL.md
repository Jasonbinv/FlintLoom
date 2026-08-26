---
name: Report A2UI emit
description: Correct a2ui_emit envelopes for report confirmation and parameter pickers in FlintLoom workbench. Read before calling a2ui_emit for forms, buttons, or tables.
---

# Report & confirm UI via `a2ui_emit`

Use this skill whenever the user asks for an **interactive card**, **confirm before generate**, **pick options in UI**, or **show a table/chart in chat** — especially before writing reports with `doc_generate` / `doc_convert`.

## Before you emit

1. Call `skill` with `action: read`, `id: report-a2ui` if you need this checklist again.
2. Call tool **`a2ui_emit`** with argument **`messages`** (array of envelopes). Never invent keys like `type`, `input`, `fields`, or `form`.
3. If emit returns `failed: bad envelope`, fix the JSON shape below — **do not** tell the user the environment lacks UI. The workbench supports A2UI; the payload was wrong.

## Envelope rules (A2UI v0.9)

Each item in `messages` MUST be an object with:

- `"version": "v0.9"` (exact string)
- **Exactly one** of: `createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`

Forbidden in all strings: `http://` and `https://` (including Markdown text).

Allowed components only:

`Column`, `Row`, `Text`, `Markdown`, `Button`, `ChoicePicker`, `DataTable`, `Chart`, `Infographic`

There is **no** `Input`, `TextField`, or free-form multi-field form. Use `Text` to **display** preset values and `ChoicePicker` for **fixed options**.

- Root component id must be `"root"`.
- `catalogId` must be `"flintloom:a2ui:core"`.
- Prefer `surfaceId`: `"main"`.

## Wait vs display-only

- Surface **waits** (user must click; send disabled) when the tree includes **`Button`** or **`ChoicePicker`** without a separate confirm button (picker-only auto-submits on change).
- **`DataTable`**, **`Chart`**, **`Infographic`**, plain **`Text`/`Markdown`** without buttons → display only, no wait.

After user clicks a **Button**, you receive an action (e.g. `confirm`) on the same turn — then proceed (e.g. generate the report).

---

## Template A — Confirm report parameters (recommended)

Show preset title/tone/length as **Text**, one **Confirm** button. User edits parameters in chat if needed; UI is for confirm/cancel flow.

```json
{
  "messages": [
    {
      "version": "v0.9",
      "createSurface": { "surfaceId": "main", "catalogId": "flintloom:a2ui:core" }
    },
    {
      "version": "v0.9",
      "updateComponents": {
        "surfaceId": "main",
        "components": [
          { "id": "root", "component": "Column", "children": ["h", "p1", "p2", "p3", "btn"] },
          { "id": "h", "component": "Text", "text": "请确认报告参数" },
          { "id": "p1", "component": "Text", "text": "标题：AI技术发展现状与未来趋势分析报告" },
          { "id": "p2", "component": "Text", "text": "语气：专业、严谨" },
          { "id": "p3", "component": "Text", "text": "篇幅：详细报告" },
          {
            "id": "btn",
            "component": "Button",
            "child": "btn-label",
            "action": { "event": { "name": "confirm" } }
          },
          { "id": "btn-label", "component": "Text", "text": "确认生成" }
        ]
      }
    }
  ]
}
```

On `confirm`, run docforge / write markdown as requested.

---

## Template B — Pick tone or format (ChoicePicker + Button)

```json
{
  "messages": [
    {
      "version": "v0.9",
      "createSurface": { "surfaceId": "main", "catalogId": "flintloom:a2ui:core" }
    },
    {
      "version": "v0.9",
      "updateComponents": {
        "surfaceId": "main",
        "components": [
          { "id": "root", "component": "Column", "children": ["label", "pick", "go"] },
          { "id": "label", "component": "Text", "text": "选择报告语气" },
          {
            "id": "pick",
            "component": "ChoicePicker",
            "value": "pro",
            "options": [
              { "label": "专业严谨", "value": "pro" },
              { "label": "通俗易懂", "value": "plain" }
            ]
          },
          {
            "id": "go",
            "component": "Button",
            "child": "go-label",
            "action": { "event": { "name": "confirm" } }
          },
          { "id": "go-label", "component": "Text", "text": "下一步" }
        ]
      }
    }
  ]
}
```

Read selected value from action `data` when user clicks **下一步**.

---

## Template C — Table + chart (no wait)

```json
{
  "messages": [
    {
      "version": "v0.9",
      "createSurface": { "surfaceId": "main", "catalogId": "flintloom:a2ui:core" }
    },
    {
      "version": "v0.9",
      "updateComponents": {
        "surfaceId": "main",
        "components": [
          { "id": "root", "component": "Column", "children": ["tbl", "chart"] },
          {
            "id": "tbl",
            "component": "DataTable",
            "headers": ["item", "count"],
            "rows": [["apple", "3"], ["banana", "5"]]
          },
          {
            "id": "chart",
            "component": "Chart",
            "kind": "bar",
            "labels": ["apple", "banana"],
            "values": [3, 5]
          }
        ]
      }
    }
  ]
}
```

---

## Common errors → fix

| Error | Cause | Fix |
|-------|--------|-----|
| `bad envelope` | Missing `version`, wrong top-level keys, or multiple keys besides version | Use only v0.9 + one envelope key per message |
| `unknown component` | `Input`, `Form`, etc. | Use allowed components only |
| `bad button` | Button missing `child` or `action.event.name` | Copy Template A button shape |
| `bad ref` | `children` id not defined | Every child id must exist in `components` |
| `remote url` | URL in text | Remove links from all strings |

## Wrong example (never send)

```json
{
  "messages": [{
    "type": "input",
    "value": { "fields": [{ "name": "title", "type": "string" }] }
  }]
}
```

This always returns **`failed: bad envelope`**.
