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
});
