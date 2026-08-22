# FlintLoom channels.send 切片设计

日期：2026-08-22  
状态：已审阅  
范围：总 spec 第 12 刀：`ctx.channels.send` 出站登记与 Telegram 回包。

## 1. 行为

- `ChannelRegistry` 增加 `send(id, outbound)`；适配器可选实现 `send`
- `ChannelOutbound`：`sessionId`、`text`、`signal`
- Telegram 适配器 `send`：`sessionId` 为 `telegram:<chatId>` 时 `sendMessage`；空文本跳过；>4096 截断
- Poller 在 `inbound` 成功后改调 `channels.send("telegram", …)`，不再直接 `botPost sendMessage`
- Webhook 无出站；无 `send` 的适配器调用 `send` 抛 `no send`

## 2. 非目标

- loop 自动出站、`channels.deliver`、新 HTTP、桌面/CLI 迁 inbound、附件
