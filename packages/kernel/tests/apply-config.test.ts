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
    expect(seen[0]).toEqual({ fromYml: 1, apiKey: "k" });
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
});
