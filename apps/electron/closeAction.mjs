import { join } from "node:path";

export const CLOSE_ACTIONS = ["ask", "tray", "quit"];

export function isCloseAction(value) {
  return value === "ask" || value === "tray" || value === "quit";
}

export function parseCloseAction(value) {
  return isCloseAction(value) ? value : "ask";
}

export function parseShellPrefs(raw) {
  const closeAction =
    raw && typeof raw === "object"
      ? parseCloseAction(raw.closeAction)
      : "ask";
  return { closeAction };
}

export function serializeShellPrefs(prefs) {
  return `${JSON.stringify({ closeAction: parseCloseAction(prefs.closeAction) }, null, 2)}\n`;
}

export function shellPrefsPath(homeDir) {
  return join(homeDir, ".flintloom", "shell-prefs.json");
}

export const CLOSE_DIALOG = {
  title: "关闭 FlintLoom",
  message: "关闭窗口时要怎么做？",
  buttons: ["最小化到托盘", "退出", "取消"],
  defaultId: 0,
  cancelId: 2,
  checkboxLabel: "记住我的选择",
};

export function decideClose(action) {
  if (action === "tray") return "hide";
  if (action === "quit") return "quit";
  return "ask";
}

export function decideAfterAsk(responseIndex, remember) {
  if (responseIndex === 0) {
    return remember ? { kind: "hide", persist: "tray" } : { kind: "hide" };
  }
  if (responseIndex === 1) {
    return remember ? { kind: "quit", persist: "quit" } : { kind: "quit" };
  }
  return { kind: "noop" };
}
