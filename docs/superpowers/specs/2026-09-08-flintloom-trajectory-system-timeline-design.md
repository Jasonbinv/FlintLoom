# FlintLoom Trajectory SYSTEM + 时间轴设计

日期：2026-09-08  
状态：已复核（2026-09-08 对照 loop / 轨迹实现二次修订）  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：把实际送模的 system 写入 session log，轨迹增加 SYSTEM 行、只读三色时间轴和搜索。不造 CONTEXT，不改模型行为。

两刀验收，同一份 spec：

1. **数据 + SYSTEM 行**：`prompt/system`、事件 `time`、账本 SYSTEM。
2. **时间轴 + 搜索**：顶栏三色 Overview、右上搜索。

## 1. 这是什么

今天 `conversationSystemMessage()` 在 `runTurn` 里现场拼，不进 log，轨迹看不见「模型看见的第一段字」。补上之后，轨迹能检查 system 原文，并能按耗时扫一轮里 Input / Model / Tools 各占多久。

验收：

- 新开一轮对话，切到轨迹：USER 之后、ASSISTANT 之前有一条 SYSTEM，详情是送模原文。
- 同一 session 里 system 原文没变，不出现第二条 SYSTEM。
- 打开联网再开一轮：出现第二条 SYSTEM（正文含 web_search 句）。
- Chat 气泡不变；对话页 `document.body` 仍不含 system 全文。
- 轨迹页顶栏：灰 / 紫 / 橙时间轴 + 搜索框。点色条选中对应行。搜 `FlintLoom` 只留 SYSTEM（或含该词的行）。
- 旧会话没有 `prompt/system`：无 SYSTEM 行。有 `llmMs` / `durationMs` 的助手 / 工具仍画时间轴（缺 `time` 时按回合内顺序拼接，见 §7）。

## 2. 已定决策

| 点 | 决定 |
|---|---|
| CONTEXT | **不做**。不拆 system，不扫描 AGENTS.md / flintloom.yml。 |
| 写入时机 | 每次即将 `chatProvider.stream` 之前，用**即将送出的** system 原文与本 session 上一条 `prompt/system.text` 比较；不同才 `append`。每 session 至少一条。 |
| 事件名 | `prompt/system`：`{ turnId, step, text, time }`。 |
| `time` | `appendEvent` 统一打 `time: Date.now()`。已有 `time` 则保留。旧 log 缺字段仍能回放。`turn/start.startedAt` 保留，不与 `time` 混用。 |
| `deriveMessages` | **不读** `prompt/system`。system 仍由 loop 现场拼再入 log，避免历史里叠两条 system。 |
| Chat | `handleEvent` 在 `scheduleTrajectory` 之后按 `step/stats` 一样 `return`。`chatBubbles` 的 skip 列表加上 `prompt/system`。`deriveMessages` 对 `prompt/system` 空分支。不改 `ReasoningRow` / `ToolCallRow`。 |
| SYSTEM 标签 | 英文 `SYSTEM`。其它角色保持中文。 |
| 详情 | 摘要（全文）。有 `time` 则 Timing 页签只显示时刻，无 duration。默认摘要。 |
| 位置 | 该 turn 内、对应 `step` 的 USER 之后、该 step 的 ASSISTANT 之前。 |
| 时间轴 | 账本上方。按时长成比例。灰 SYSTEM/USER，紫 ASSISTANT（`llmMs`），橙 TOOL（`durationMs`）。点条选中行。 |
| 不做的交互 | 拖选过滤、滚轮缩放、Duration / Turns / Calls 开关。 |
| 搜索 | 右上。过滤 preview / thinking / output / args / result / system 全文。不分大小写。无匹配：「无匹配」。选中行被滤掉则关闭详情。时间轴只画当前可见行。 |
| 后端 HTTP | 不加新路由。SSE / `GET /v1/sessions/:id` 原样转发新事件。 |

## 3. 非目标

- CONTEXT、AGENTS.md 注入、工具 schema、Request #N、compaction、subtool
- 折叠 Turn/Calls、虚表、分页、Session log 下载
- 详情 Preview / Raw / Source、详情可拖宽
- 改 CLI / 频道展示
- 用 log 里的 system 替换 `conversationSystemMessage()` 的生成（只多记，不改拼法）

## 4. 架构

```text
runStep → conversationSystemMessage(...)
        → 若与 last prompt/system.text 不同
              appendEvent(prompt/system)
        → chatProvider.stream({ messages: [system, ...deriveMessages()] })

appendEvent 给每条 SessionEvent 补 time（已有则不动）

SSE / fetchSession
        ├─ handleEvent 气泡路径：prompt/system 直接 return
        └─ eventsRef → buildTrajectoryFromEvents
                         ├─ SYSTEM / USER / ASSISTANT / TOOL …
                         ├─ deriveTrajectoryTimeline(records)
                         └─ 搜索过滤 → Table + Timeline
```

类型写法（两边各写一份，桌面不改成 import `@flintloom/session`）：

```ts
type SessionEventBody = /* 现有判别联合 */ | { type: "prompt/system"; turnId: string; step: number; text: string };
export type SessionEvent = SessionEventBody & { time?: number };
```

桌面 `WorkbenchEventBody` 同样加上 `prompt/system` 再 `& { time?: number }`。`end` 也带可选 `time`。

## 5. 事件

```ts
{
  type: "prompt/system";
  turnId: string;
  step: number;
  text: string;
  time?: number;
}
```

`text` 必须等于该步 `messages[0].content`（即 `conversationSystemMessage(...)` 的返回值）。`step` 等于本步已经写入的 `step/start.step`。

与现有 `runStepIterations` 对齐的顺序：

1. `step/start`
2. `resolveConversationProvider` — **失败则不写** `prompt/system`（还没造 messages，也没送模）
3. 造 `messages`（`[system, ...deriveMessages()]`）
4. 与本 session **最后一条** `prompt/system.text` 比较，不同则写入
5. `stream` — 写入发生在调用 `stream` 之前。`stream` 随后抛错或 `error` chunk：事件保留（当时确实准备送这段）

`continueGuardTurn` / `continueTurn` 会再次进入 `runStepIterations`（新的 `step/start`）。比较规则相同；原文未变则不写。`text` 永远等于当时的 `conversationSystemMessage(...)` 返回值，不在 spec 里写死人格句子（后续按 schema 裁剪 system 时轨迹自动跟上）。

`appendEvent`：

```ts
const stamped = event.time === undefined ? { ...event, time: Date.now() } : event;
session.append(stamped);
onEvent?.(stamped);
```

Guard 续跑、A2UI 续跑凡走 `appendEvent` 的事件同样带 `time`。测试里直接 `session.append` 的旧夹具可以不带 `time`。

## 6. 轨迹投影

`TrajectoryKind` 增加 `"system"`。

稳定 id：`system:{turnId}:{step}`。

`TrajectoryRecord` 增加可选 `startedAt?: number`。`timing.durationMs` / `timing.llmMs` 继续表示时长。

**`startedAt` 必须取「开始」事件，禁止用 flush 时最后一条事件的 `time`。** 否则助手条会画在 step 结束时刻，时间轴是错的。

| 行 | startedAt | durationMs |
|---|---|---|
| SYSTEM | 该条 `prompt/system.time` | 无（点事件） |
| USER | 该条 `user/message.time` | 无（点事件） |
| ASSISTANT | 该 step 的 `step/start.time` | `step/stats.llmMs`（已有 `timing.llmMs`） |
| TOOL | 该 `tool/call.time` | `tool/result.durationMs` |
| 其它 | 对应事件 `time`（有则记） | 无，时间轴不画 |

`step/start` 没有 `time` 时，ASSISTANT 的 `startedAt` 为空，交给 §7 推断。TOOL 同理。

`buildTrajectoryFromEvents`：

- 记住当前 step 的 `step/start.time`，flush ASSISTANT 时写到该行 `startedAt`。
- 记住每个 `tool/call.time`，配对 `tool/result` 时保留为 TOOL `startedAt`。
- 遇到 `prompt/system`：flush 进行中的 ASSISTANT 后插入 SYSTEM。`output` = 全文，`preview` = `previewLine(text)`。
- 无 `prompt/system` 的历史：种类与 v1 相同。

`TrajectoryTable`：`kind === "system"` 标签为 `SYSTEM`。

`TrajectoryInspector`：`availableTabs` 对 SYSTEM 为 `summary`，有 `startedAt` 时加 `timing`（只显示 Started / time，格式用本地时间或已有 `formatDuration` 不适用于时刻——用 `toLocaleTimeString` 即可）。

## 7. 时间轴

一条水平条（对标已选布局 A），段的颜色表示语义，**不是**三条并排泳道。

`deriveTrajectoryTimeline(records)` 产出：

```ts
type TimelineLane = "input" | "model" | "tools";
type TrajectoryTimelineSpan = {
  recordId: string;
  lane: TimelineLane;
  startMs: number;      // 相对 domain 起点
  durationMs: number;   // 墙钟或推断时长；点事件为 0
  inferred: boolean;
};
type TrajectoryTimelineModel = {
  domainMs: number;
  spans: TrajectoryTimelineSpan[];
};
```

入选：`system` / `user`，或 ASSISTANT 有 `timing.llmMs`，或 TOOL 有 `timing.durationMs`。ERROR / GUARD / A2UI 不画。

**放置：**

1. 有 `startedAt`：`start = startedAt`，`duration = llmMs | durationMs | 0`，`inferred = false`。
2. 否则（旧 log）：按账本顺序，从该 turn 的 `turn/start.startedAt`（没有则从 0）起把有时长的段首尾相接；点事件插在下一段之前、时长 0。`inferred = true`。
3. domain = `max(end) - min(start)`。若 domain 为 0（只有点事件），domain 视为 1ms，避免除零。
4. **禁止**用「domain × 2%」去改 `durationMs` 或撑宽 domain。点事件 `durationMs = 0`，UI 用 CSS `min-width: 6px` 保证能点，可以叠在相邻段上。

lane：`system`/`user` → `input`（灰，`--text-tertiary`）；`assistant` → `model`（`--logo-gradient-end`）；`tool` → `tools`（现有 tool 成功色）。

无任何入选行：不渲染时间轴，只留搜索。

UI：`TrajectoryToolbar`（搜索，`aria-label="搜索轨迹"`）+ `TrajectoryTimeline`（绝对定位段）。点段：`onSelect(recordId)`。`aria-label` 含角色与 `formatDuration`（点事件说「瞬时」）。不引入图表库。

## 8. 搜索

`TrajectoryView` 持有 `query` 字符串。

`recordMatchesQuery(record, query)`：对 `preview`、`thinking`、`output`、`result`、`toolName`、`JSON.stringify(args ?? "")` 做 `toLowerCase().includes`。空 query（trim 后）全过。`JSON.stringify` 失败则跳过 args。

过滤后交给 Table 与 Timeline。无行且 query 非空：`无匹配`（不是「尚无轨迹」）。

## 9. 错误与空态

| 情况 | 行为 |
|---|---|
| 旧 session 无 `prompt/system` | 无 SYSTEM 行；不报错 |
| 旧事件无 `time` | 账本照常；有 `llmMs` / `durationMs` 的助手 / 工具仍进时间轴（`inferred`） |
| system 原文与上次相同 | 不写第二条 |
| 解析模型失败 | 不写 `prompt/system` |
| `stream` 已调用后失败 | 若已写入则保留 |
| 搜索无匹配 | 「无匹配」 |

## 10. 文件

```text
packages/session/src/events.ts              # prompt/system + time
packages/session/tests/session.test.ts      # deriveMessages 忽略 prompt/system
packages/loop/src/run-turn.ts               # appendEvent 打 time；条件写入
packages/loop/tests/run-turn.test.ts        # 写入 / 去重 / 联网第二条
apps/desktop/src/types.ts                   # 与 session 对齐
apps/desktop/src/trajectoryRecords.ts       # system 行 + startedAt/durationMs
apps/desktop/src/trajectoryTimeline.ts      # deriveTrajectoryTimeline
apps/desktop/src/TrajectoryToolbar.tsx      # 搜索
apps/desktop/src/TrajectoryTimeline.tsx
apps/desktop/src/TrajectoryView.tsx
apps/desktop/src/TrajectoryTable.tsx
apps/desktop/src/TrajectoryInspector.tsx
apps/desktop/src/App.tsx                    # handleEvent 忽略 prompt/system
apps/desktop/src/chatBubbles.ts             # 与 turn/start、step/stats 一样跳过 prompt/system
packages/session/src/session.ts             # deriveMessages switch 增加 prompt/system: break
apps/desktop/src/app.css                    # .trajectory-timeline-* / toolbar
apps/desktop/tests/trajectoryRecords.test.ts
apps/desktop/tests/trajectoryTimeline.test.ts
apps/desktop/tests/TrajectoryView.test.tsx
apps/desktop/tests/App.test.tsx             # Chat 不见 system 全文
```

不改 `ReasoningRow.tsx`、`foldLoopingReasoning.ts`、`toolDisplay.ts` 截断语义。

## 11. 测试

**Slice 1**

- `runTurn`：`prompt/system.text` **严格等于** 该次 `stream` 收到的 `messages[0].content`；该 session 恰好一条。
- 同一 session 第二轮、`webSearch` 仍关：不再新增。
- 第二轮 `webSearch: true`：新增一条，且等于第二次 `stream` 的 system。
- 未注册 chat 模型：`runTurn` 失败且 events **没有** `prompt/system`。
- `deriveMessages()` 不含 `role: "system"`；含 `prompt/system` 的 log 仍只投影 user/assistant/tool。
- `buildTrajectoryFromEvents`：顺序 `user, system, assistant`；id `system:t1:1`；ASSISTANT `startedAt` 来自 `step/start.time`，不是 `step/stats.time`。
- `App`：对话页 `document.body` 不含 system 全文；切轨迹后可见 SYSTEM。

**Slice 2**

- 有真实 `startedAt`：助手 / 工具 span 的 `startMs` 差等于两次 `startedAt` 之差；`inferred === false`。
- 无 `time`、仅有 `llmMs`/`durationMs`：仍产出 span，`inferred === true`，助手与工具在时间上首尾相接。
- 点事件不增加 `domainMs`。
- `TrajectoryView`：搜一个只出现在 SYSTEM `output` 里的词，账本只剩 SYSTEM；清空恢复。
- 点时间轴 span 选中对应 `data-trajectory-id`。

现有轨迹 / Chat 截断 / 工具堆叠用例继续绿。

## 12. 明确不做的改动

- 不把 workspace 文件注入模型。
- 不把工具 JSON schema 写入 log。
- 不为时间轴引入图表库。
- 不在对话页挂载时间轴（只在轨迹层）。

## 13. 复核时修掉的问题

1. 助手 / 工具若用「flush 时最后一条事件的 `time`」当 `startedAt`，条会画在结束时刻。改为 `step/start.time` / `tool/call.time`。
2. 「旧会话只画有耗时的助手 / 工具」与「无 time 不进时间轴」矛盾。改为缺 `time` 时按回合顺序拼接，并标 `inferred`。
3. 「domain × 2%」会虚构墙钟并挤歪邻居。点事件时长保持 0，用 CSS `min-width`。
4. 缺模型时若先写 `prompt/system`，log 会有未送出的 system。改为解析 provider 成功、`messages` 造好后再写。
5. `deriveMessages` / `chatBubbles` 漏写新类型会让 TypeScript 或气泡路径不稳，已列入文件与分支。
