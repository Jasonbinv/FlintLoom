# FlintLoom channels.deliver 切片设计

日期：2026-08-22  
状态：已审阅  
范围：总 spec 第 15 刀：`ctx.channels.deliver` 与 loop turn 结束自动出站。

## 1. 行为

- `ChannelRegistry` 增加 `deliver(id, outbound)`；适配器可选实现 `deliver`
- `ChannelDeliver`：`sessionId`、`turnId`、`signal`
- Telegram 适配器 `deliver`：从 session log 取本 turn 最后一条 `assistant/message`，再调已有 `send`
- `runTurn` / `continueTurn` / `continueGuardTurn` 在 `turn/end` 之后、`channel` 非 `host`/`cli` 时调 `channels.deliver`；无 `deliver` 则忽略（`no deliver`）
- `awaiting_action` 不出站
- Telegram poller 去掉 `inbound` 后的 `channels.send`（出站改由 loop 触发 `deliver`）
- Webhook 仍只靠 `inbound` 返回的 `text` 写 HTTP JSON；无 `deliver`

## 2. 非目标

- 附件、A2UI 树出站、桌面/CLI 迁 inbound、新 HTTP
