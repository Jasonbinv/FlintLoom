import { describe, expect, it } from "vitest";
import { Context } from "../src/index.ts";

describe("Context", () => {
  it("provide 的值在 plugin dispose 后消失", () => {
    const ctx = new Context();
    const stop = ctx.plugin({
      name: "probe",
      apply(c) {
        c.provide("probe.n", 7);
      },
    });
    expect(ctx.get<number>("probe.n")).toBe(7);
    stop();
    expect(ctx.get<number>("probe.n")).toBeUndefined();
  });
});
