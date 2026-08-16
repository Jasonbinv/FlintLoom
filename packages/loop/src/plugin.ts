import type { Context, FlintPlugin } from "@flintloom/kernel";
import { runTurn } from "./run-turn.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/loop",
  apply(ctx: Context) {
    ctx.require("models");
    ctx.require("tools");
    ctx.provide("loop", { runTurn });
  },
};

export default plugin;
