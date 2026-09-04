import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/index.ts";

describe("loadConfig", () => {
  it("读出 plugins 列表", () => {
    const cfg = loadConfig(`
plugins:
  - id: session
    name: "@flintloom/session"
`);
    expect(cfg.plugins).toEqual([
      { id: "session", name: "@flintloom/session" },
    ]);
  });

  it("缺少 plugins 则抛错", () => {
    expect(() => loadConfig("foo: 1\n")).toThrow(/plugins/);
  });

  it("enabled false 写入行；缺省视为开；非布尔抛 enabled", () => {
    const off = loadConfig(`
plugins:
  - id: session
    name: "@flintloom/session"
    enabled: false
`);
    expect(off.plugins[0]?.enabled).toBe(false);

    const on = loadConfig(`
plugins:
  - id: session
    name: "@flintloom/session"
`);
    expect(on.plugins[0]?.enabled).toBeUndefined();

    expect(() =>
      loadConfig(`
plugins:
  - id: session
    name: "@flintloom/session"
    enabled: "false"
`),
    ).toThrow(/enabled/);
  });
});
