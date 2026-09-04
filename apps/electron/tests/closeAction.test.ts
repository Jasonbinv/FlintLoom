import { describe, expect, it } from "vitest";
import {
  CLOSE_DIALOG,
  decideAfterAsk,
  decideClose,
  isCloseAction,
  parseCloseAction,
  parseShellPrefs,
  serializeShellPrefs,
  shellPrefsPath,
} from "../closeAction.mjs";

describe("parseCloseAction", () => {
  it("accepts ask tray quit", () => {
    expect(parseCloseAction("ask")).toBe("ask");
    expect(parseCloseAction("tray")).toBe("tray");
    expect(parseCloseAction("quit")).toBe("quit");
    expect(isCloseAction("tray")).toBe(true);
  });

  it("falls back to ask", () => {
    expect(parseCloseAction(undefined)).toBe("ask");
    expect(parseCloseAction("nope")).toBe("ask");
    expect(parseCloseAction(1)).toBe("ask");
    expect(isCloseAction("nope")).toBe(false);
    expect(isCloseAction(undefined)).toBe(false);
  });
});

describe("parseShellPrefs", () => {
  it("reads closeAction and ignores extra keys", () => {
    expect(parseShellPrefs({ closeAction: "tray", extra: 1 })).toEqual({
      closeAction: "tray",
    });
  });

  it("defaults missing or invalid closeAction to ask", () => {
    expect(parseShellPrefs(null)).toEqual({ closeAction: "ask" });
    expect(parseShellPrefs({})).toEqual({ closeAction: "ask" });
    expect(parseShellPrefs({ closeAction: "xyz" })).toEqual({
      closeAction: "ask",
    });
  });
});

describe("serializeShellPrefs and path", () => {
  it("writes only closeAction", () => {
    expect(JSON.parse(serializeShellPrefs({ closeAction: "quit" }))).toEqual({
      closeAction: "quit",
    });
  });

  it("joins homeDir with .flintloom/shell-prefs.json", () => {
    const p = shellPrefsPath("C:/Users/me");
    expect(p.replaceAll("\\", "/")).toBe("C:/Users/me/.flintloom/shell-prefs.json");
  });
});

describe("decideClose", () => {
  it("maps prefs to ask hide quit", () => {
    expect(decideClose("ask")).toBe("ask");
    expect(decideClose("tray")).toBe("hide");
    expect(decideClose("quit")).toBe("quit");
  });
});

describe("decideAfterAsk", () => {
  it("tray button hides and can persist", () => {
    expect(decideAfterAsk(0, true)).toEqual({ kind: "hide", persist: "tray" });
    expect(decideAfterAsk(0, false)).toEqual({ kind: "hide" });
  });

  it("quit button quits and can persist", () => {
    expect(decideAfterAsk(1, true)).toEqual({ kind: "quit", persist: "quit" });
    expect(decideAfterAsk(1, false)).toEqual({ kind: "quit" });
  });

  it("cancel does nothing and never persists", () => {
    expect(decideAfterAsk(2, true)).toEqual({ kind: "noop" });
    expect(decideAfterAsk(-1, true)).toEqual({ kind: "noop" });
  });
});

describe("CLOSE_DIALOG", () => {
  it("uses the spec copy and button order", () => {
    expect(CLOSE_DIALOG.title).toBe("关闭 FlintLoom");
    expect(CLOSE_DIALOG.message).toBe("关闭窗口时要怎么做？");
    expect(CLOSE_DIALOG.buttons).toEqual(["最小化到托盘", "退出", "取消"]);
    expect(CLOSE_DIALOG.defaultId).toBe(0);
    expect(CLOSE_DIALOG.cancelId).toBe(2);
    expect(CLOSE_DIALOG.checkboxLabel).toBe("记住我的选择");
  });
});
