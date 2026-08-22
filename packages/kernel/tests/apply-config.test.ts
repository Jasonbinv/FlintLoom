import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyConfig, Context, type FlintPlugin } from "../src/index.ts";

function plugin(name: string, apply: FlintPlugin["apply"]): FlintPlugin {
  return { name, apply };
}

describe("applyConfig", () => {
  it("按行 apply 并合并 runtime config", async () => {
    const seen: Record<string, unknown>[] = [];
    const ctx = new Context();
    const mods: Record<string, FlintPlugin> = {
      a: plugin("a", (c, config) => {
        seen.push(config);
        c.provide("a", true);
      }),
      b: plugin("b", (c) => {
        c.require("a");
        c.provide("b", true);
      }),
    };

    const stop = await applyConfig(
      ctx,
      {
        plugins: [
          { id: "a", name: "pkg-a", config: { fromYml: 1 } },
          { id: "b", name: "pkg-b" },
        ],
      },
      {
        importFn: async (name) => (name === "pkg-a" ? mods.a : mods.b),
        runtimeConfigById: { a: { apiKey: "k" } },
      },
    );

    expect(ctx.require("b")).toBe(true);
    expect(seen[0]).toEqual({ fromYml: 1, apiKey: "k", id: "a" });
    stop();
    expect(() => ctx.require("a")).toThrow(/a/);
  });

  it("重复 id 拒绝启动", async () => {
    const ctx = new Context();
    await expect(
      applyConfig(ctx, {
        plugins: [
          { id: "a", name: "x" },
          { id: "a", name: "y" },
        ],
      }, { importFn: async () => plugin("x", () => {}) }),
    ).rejects.toThrow(/id/);
  });

  it("没有 apply 则抛 name", async () => {
    const ctx = new Context();
    await expect(
      applyConfig(
        ctx,
        { plugins: [{ id: "a", name: "bad-pkg" }] },
        { importFn: async () => ({}) },
      ),
    ).rejects.toThrow(/bad-pkg/);
  });

  it("第二行失败则撤销第一行", async () => {
    const ctx = new Context();
    await expect(
      applyConfig(
        ctx,
        {
          plugins: [
            { id: "a", name: "pkg-a" },
            { id: "b", name: "pkg-b" },
          ],
        },
        {
          importFn: async (name) =>
            name === "pkg-a"
              ? plugin("a", (c) => {
                  c.provide("a", 1);
                })
              : plugin("b", () => {
                  throw new Error("boom");
                }),
        },
      ),
    ).rejects.toThrow(/boom/);
    expect(() => ctx.require("a")).toThrow(/a/);
  });

  it("异步 apply 成功后工具已登记；失败则回滚", async () => {
    const ctx = new Context();
    const mods: Record<string, FlintPlugin> = {
      async: {
        name: "async",
        async apply(c) {
          c.provide("async.ok", true);
          await Promise.resolve();
        },
      },
      asyncFail: {
        name: "async-fail",
        async apply(c) {
          c.provide("async-fail.k", 1);
          throw new Error("async-boom");
        },
      },
    };

    const stop = await applyConfig(
      ctx,
      { plugins: [{ id: "async", name: "pkg-async" }] },
      { importFn: async () => mods.async },
    );
    expect(ctx.require("async.ok")).toBe(true);
    stop();

    const ctx2 = new Context();
    await expect(
      applyConfig(
        ctx2,
        { plugins: [{ id: "fail", name: "pkg-async-fail" }] },
        { importFn: async () => mods.asyncFail },
      ),
    ).rejects.toThrow(/async-boom/);
    expect(() => ctx2.require("async-fail.k")).toThrow(/async-fail\.k/);
  });

  it("默认 importFn 从绝对路径目录加载 apply", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-abs-plugin-"));
    writeFileSync(
      join(dir, "index.mjs"),
      `export default {
  name: "plugin-add-test",
  apply(ctx) {
    ctx.provide("plugin-add-test", 1);
  },
};
`,
    );
    const ctx = new Context();
    const stop = await applyConfig(ctx, {
      plugins: [{ id: "plugin-add-test", name: dir }],
    });
    expect(ctx.require("plugin-add-test")).toBe(1);
    stop();
  });
});
