import type { Context, FlintPlugin } from "@flintloom/kernel";
import { ModelRegistry } from "./registry.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/models",
  apply(ctx: Context) {
    ctx.provide("models", new ModelRegistry());
  },
};

export default plugin;
