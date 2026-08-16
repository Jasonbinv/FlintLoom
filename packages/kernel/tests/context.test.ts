import { describe, expect, it } from "vitest";
import { Context } from "../src/index.ts";

describe("Context", () => {
  it("provide 的值在 plugin dispose 后消失", () => {
    const ctx = new Context();
    const stop = ctx.plugin({
      name: "probe",
      apply(c, _config) {
        c.provide("probe.n", 7);
      },
    });
    expect(ctx.get<number>("probe.n")).toBe(7);
    stop();
    expect(ctx.get<number>("probe.n")).toBeUndefined();
  });

  it("require 缺失则抛错且消息含键名", () => {
    const ctx = new Context();
    expect(() => ctx.require("models")).toThrow(/models/);
  });

  it("effect 在 plugin dispose 时按反序调用", () => {
    const ctx = new Context();
    const log: string[] = [];
    const stop = ctx.plugin({
      name: "fx",
      apply(c) {
        c.effect(() => {
          log.push("a");
        });
        c.effect(() => {
          log.push("b");
        });
      },
    });
    stop();
    expect(log).toEqual(["b", "a"]);
  });

  it("waterfall 先登记的监听在外层；不调用 next 则短路", async () => {
    const ctx = new Context();
    const log: string[] = [];
    ctx.hook("t", async (_payload, next) => {
      log.push("outer");
      return "short";
    });
    ctx.hook("t", async (_payload, next) => {
      log.push("inner");
      return next();
    });
    const result = await ctx.waterfall("t", {}, async () => {
      log.push("term");
      return "done";
    });
    expect(result).toBe("short");
    expect(log).toEqual(["outer"]);
  });

  it("waterfall 全部 next 则执行 terminal", async () => {
    const ctx = new Context();
    const log: string[] = [];
    ctx.hook("t", async (_payload, next) => {
      log.push("a");
      return next();
    });
    const result = await ctx.waterfall("t", {}, async () => {
      log.push("term");
      return "done";
    });
    expect(result).toBe("done");
    expect(log).toEqual(["a", "term"]);
  });

  it("plugin dispose 后 hook 不再触发", async () => {
    const ctx = new Context();
    const stop = ctx.plugin({
      name: "h",
      apply(c) {
        c.hook("t", async (_payload, next) => "from-plugin");
      },
    });
    stop();
    const result = await ctx.waterfall("t", {}, async () => "term");
    expect(result).toBe("term");
  });

  it("plugin apply 抛错后撤销已 provide 的键", () => {
    const ctx = new Context();
    expect(() =>
      ctx.plugin({
        name: "boom",
        apply(c) {
          c.provide("boom.k", 1);
          throw new Error("apply-fail");
        },
      }),
    ).toThrow(/apply-fail/);
    expect(() => ctx.require("boom.k")).toThrow(/boom\.k/);
  });
});
