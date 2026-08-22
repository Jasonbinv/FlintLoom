# FlintLoom 薄 Electron 桌面壳设计

日期：2026-08-22  
状态：已审阅  
范围：`pnpm desktop:app` 用 Electron 窗口打开现有 Vite 工作台；host 与 `/v1` 代理行为与 `pnpm desktop` 相同。

## 1. 行为

- `scripts/desktop-electron.ts`：`ensureHost` + Vite `5173` + spawn Electron
- `apps/electron`：`BrowserWindow` 加载 `FLINT_DESKTOP_URL`（默认 `http://127.0.0.1:5173`）
- `pnpm desktop` 仍为纯浏览器；不改 React 页面逻辑

## 2. 非目标

- 打包安装器、自动更新、系统托盘、工作区选择器、preload 注入 token
