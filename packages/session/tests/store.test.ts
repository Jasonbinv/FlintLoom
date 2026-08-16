import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import plugin, { SessionStore } from "../src/index.ts";

describe("session plugin", () => {
  it("getOrCreate 同一 id 返回同一 Session", () => {
    const ctx = new Context();
    ctx.plugin(plugin);
    const store = ctx.require<SessionStore>("sessions");
    const a = store.getOrCreate("s1");
    const b = store.getOrCreate("s1");
    expect(a).toBe(b);
    expect(store.get("missing")).toBeUndefined();
  });
});
