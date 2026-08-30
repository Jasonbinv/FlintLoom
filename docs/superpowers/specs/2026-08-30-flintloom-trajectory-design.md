# FlintLoom Trajectory 检查台设计

日期：2026-08-30  
状态：已复核  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：对话页内 **对话 | 轨迹** 选项卡。轨迹是同一条 `SessionEvent` / `WorkbenchEvent` 的只读检查账本，对标 deepseek-harness Trajectory 的核心（账本 + 本地详情 + Chat→轨迹跳转），不做时间轴 / 搜索 / 虚拟列表 / 回合折叠。

## 1. 这是什么

工作台对话页增加 **轨迹** 视图：按 turn / step 列出 USER、ASSISTANT、TOOL 及 error / guard / a2ui，点行在轨迹内部打开详情（完整 thinking、工具 IN/OUT、step 耗时与 token）。Chat 气泡（`ReasoningRow` / `ToolCallRow`）保持现有观感与折叠行为。

验收：`pnpm desktop` 跑一轮含思考 + 工具的对话。默认仍是气泡 Chat；切到「轨迹」能看到按 step 对齐的账本；点工具行旁「在轨迹中查看」跳到对应 TOOL 行并打开详情；详情里的 tool result 不被 2000 字截断，thinking 不被 `foldLoopingReasoning` 处理。现有 Chat 测试（工具堆叠、思考顺序、OUT 截断）继续通过。

## 2. 收紧的决策

| 点 | 决定 |
|---|---|
| 与 Chat 关系 | 方案 A：并排选项卡。Chat 仍展示思考抽屉和工具行。 |
| 数据源 | 轨迹 **只** 从事件数组投影。不读 `Bubble[]`，不改 `chatBubbles.ts` / `ReasoningRow.tsx`。 |
| Chat 更新路径 | `handleEvent` 的气泡增量逻辑 **一字不改**。事件另写入 `eventsRef`。 |
| 流式性能 | 对话页可见时 **禁止** 因轨迹而对每个 `reasoning-chunk` `setState`。`eventsRef.push` 无 React 更新；仅轨迹页可见时 rAF 合并重建账本。 |
| 保活 | **不对称**：切到轨迹时 Chat 的 `.log` 仍挂载（`hidden` + `inert`），展开与滚动保留。切回对话时 **卸载** 轨迹，避免账本文本进入 `document.body` 破坏现有截断断言。 |
| ASSISTANT 行 | 每个 LLM step 一条。合并该 step 的 `assistant/reasoning-chunk` + `assistant/chunk`；若随后有 `assistant/message`，正文以 message 为准。带 tool 的 step **经常没有** `assistant/message`，不得丢掉 chunk 正文。 |
| Thinking 折叠 | Chat 继续 `foldLoopingReasoning`（6000 截断）。轨迹详情用 **原文**。 |
| Tool OUT | Chat 继续 `truncateToolResult`（2000）。轨迹详情用 **全文**。账本预览可截断。 |
| 跳转 | `ToolCallRow` 增加独立按钮，`stopPropagation`，不改变点行展开。思考抽屉 v1 不跳转。 |
| Guard / A2UI | `guard/ask`，或 `a2ui/surface` 且 `wait === true`，强制切回 **对话**。 |
| 详情位置 | 轨迹层内部右侧约 360px，不占用文件栏，v1 不可拖拽。未选中时账本铺满。 |
| 时间轴 / 搜索 / 虚拟列表 / 回合折叠 | v1 不做。 |
| 后端 | 不改 `runTurn`、不新增 SSE 类型、不加 HTTP。 |

## 3. 非目标

- Chrome Network 风格时间轴、搜索框、Collapse turns/calls、TanStack virtual
- 用事件数组重建 Chat 气泡
- 在轨迹里渲染可交互 A2UI / Guard 按钮
- Schema 页签、Request #N、compaction、subtool
- 改 CLI / 频道的 thinking/tools 展示

## 4. 架构

```text
SSE / fetchSession().events
        │
        ├─ handleEvent → Bubble[] → ReasoningRow / ToolCallRow   （不变）
        │
        └─ eventsRef.push
              │
              └─ 仅当 chatView === "trajectory"
                    rAF → buildTrajectoryFromEvents → TrajectoryView
```

```text
chat-column
  header: 标题 | 对话 | 轨迹 | 状态
  .log            hidden/inert when 轨迹
  TrajectoryView  仅 chatView === "trajectory" 时挂载
  composer        始终
file-pane         始终
```

## 5. 事件 → 账本

纯函数 `buildTrajectoryFromEvents(events: WorkbenchEvent[]): TrajectoryRecord[]`。

稳定 id：`user:{turnId}`、`assistant:{turnId}:{step}`、`tool:{callId}`、其余用递增序号。`callId` 供 Chat 跳转。

| 事件 | 行 |
|---|---|
| `turn/start` | 回合号 +1；先 flush 进行中的 ASSISTANT |
| `user/message` | USER；该回合第一行标 `turnStart`。预览用正文，不把 base64 图放进账本 |
| `step/start` | 记录 step；flush 上一步 ASSISTANT |
| `assistant/reasoning-chunk` | 写入当前 step 的 thinking 缓冲 |
| `assistant/chunk` | 写入当前 step 的 output 缓冲 |
| `assistant/message` | output 以 message 为准，flush ASSISTANT |
| `step/stats` | 挂到当前 step 的 ASSISTANT Timing（flush 前或后补上同一 id） |
| `tool/call` | 先 flush ASSISTANT，再 TOOL `running` |
| `tool/result` | 按 `callId` 更新全文 result 与 `done`/`error`（`toolResultState`），带 `durationMs` |
| `model/error` | ERROR |
| `guard/ask` | GUARD |
| `guard/steward` | 与 Chat 相同：`ok` 且 summary 空则跳过，否则 GUARD |
| `a2ui/surface` | A2UI（Summary 即可） |
| `turn/end` | flush ASSISTANT |
| `turn/stats`、`guard/decision`、`guard/response`、`a2ui/action`、`end` | 不单独成行 |

循环结束后若 thinking/output 缓冲仍有内容，flush 一条 `running: true` 的 ASSISTANT（流式思考中）。无 result 的 TOOL 保持 `running`。

`step/stats` 在 loop 里出现在 tool/call **之前**（流结束后、执行工具前）。Timing 是 LLM 耗时，不含后续工具；工具耗时只在 TOOL 的 `durationMs`。

## 6. 界面

### 6.1 选项卡

`chat-header` 标题旁 `role="tablist"`：**对话** | **轨迹**。默认 `对话`。`aria-selected` 绑定当前页。

### 6.2 账本

两列：角色标签（USER / ASSISTANT / TOOL / ERROR / GUARD / A2UI）+ 预览。回合第一行加 `Turn N`。ASSISTANT / TOOL 加 `Step N`，与 Chat 工具行 `step N` 同号。

预览（仅此列截断，约 160 字 / 首行）：

- USER：正文首行
- ASSISTANT：有 output 用 output，否则 thinking 首行；`running` 可标「思考中」
- TOOL：`toolDisplayTitle` · `toolDisplaySummary` → 结果首行；running 且无结果则无箭头
- 其它：一句话

点行选中，打开右侧详情。

### 6.3 详情

按行类型只渲染有内容的页签：

| 行 | 页签 | 默认 |
|---|---|---|
| USER | Summary | Summary |
| ASSISTANT | Summary、Thinking（原文）、Output、Timing（有 stats 才有） | 有 thinking 则 Thinking，否则 Output |
| TOOL | Summary、Payload（完整 JSON）、Result（全文 + 可复用 `MessageFileCards`）、Timing（有 `durationMs` 才有） | 有 result 则 Result，否则 Payload |
| ERROR / GUARD / A2UI | Summary | Summary |

Timing 文案复用 `formatDuration` / `formatTokens`。关闭详情后账本铺满。

### 6.4 Chat 跳转

`ToolCallRow` 增加 `callId` + 可选 `onInspect`。按钮在 header **之外**（或 header 内独立 `<button>` 且 `stopPropagation`），`aria-label="在轨迹中查看"`。点击：`chatView = "trajectory"`，把 `inspectCallId` 交给轨迹，滚动并选中 `tool:{callId}`，然后 `onInspectDone` 清空，以便同一 call 再点仍触发。

### 6.5 会话切换

加载 / 新建 / 切换会话时：`eventsRef` 换成该会话事件（新会话空数组），清空 `inspectCallId`。**保留** 当前选项卡。`switchSession` / `resetToNewSession` 的气泡重置逻辑不变。

## 7. 错误与空态

- 空事件：「尚无轨迹」
- `tool/call` 无 result：TOOL `running`
- 未知行：只有 Summary
- 详情不画 A2UI 控件、不提供 Guard 允许/拒绝（那些只在 Chat）

## 8. 文件

```text
apps/desktop/src/trajectoryRecords.ts   # 类型 + buildTrajectoryFromEvents
apps/desktop/src/TrajectoryView.tsx     # 账本 + 详情壳
apps/desktop/src/TrajectoryTable.tsx
apps/desktop/src/TrajectoryInspector.tsx
apps/desktop/src/App.tsx                # 选项卡、eventsRef、rAF、保活、跳转、guard 切回
apps/desktop/src/ToolCallRow.tsx        # callId + onInspect 按钮
apps/desktop/src/app.css                # .trajectory-* 与 .chat-view-tabs
apps/desktop/tests/trajectoryRecords.test.ts
apps/desktop/tests/TrajectoryView.test.tsx
apps/desktop/tests/ToolCallRow.test.tsx # inspect 不抢展开
apps/desktop/tests/App.test.tsx         # 选项卡、跳转、guard 切回、Chat 回归
```

## 9. 测试要求

- `buildTrajectoryFromEvents`：多 step；reasoning 归并；有 tool 无 `assistant/message` 时仍有 ASSISTANT（thinking + chunk 正文）；call/result 配对且 result 全文；`step/stats` 挂到对应 ASSISTANT；running 半成品。
- `ToolCallRow`：点 header 仍展开 IN/OUT；点 inspect 调用 `onInspect(callId)` 且不切换展开。
- `App`：默认对话；切轨迹再切回，思考抽屉若曾展开则仍在 DOM（`.log` 未卸载）；在对话页时 `document.body` **不含** 轨迹全文（工具 2001 字结果仍只以截断形式出现）；inspect 切到轨迹并选中该行；`guard/ask` 从轨迹切回对话。
- 现有 `shows tool call row with truncated result`、`groups consecutive tool steps`、思考顺序用例必须继续绿。

## 10. 明确不做的改动

- 不修改 `ReasoningRow.tsx`、`foldLoopingReasoning.ts`、`chatBubbles.ts`、`toolDisplay.ts` 的截断/折叠语义。
- 不为轨迹引入新依赖。
- 不把 `.disclosure-row` / `.reasoning-drawer` 样式复用到轨迹。
