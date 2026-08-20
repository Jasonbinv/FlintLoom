import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import channelPlugin, {
  createChannelRegistry,
  type ChannelInbound,
  type ChannelRegistry,
} from "../src/index.ts";

const input: ChannelInbound = {
  text: "hi",
  sessionId: "webhook",
  workspaceRoot: "/tmp",
  signal: new AbortController().signal,
};

describe("channels registry", () => {
  it("plugin provides channels; register inbound dispose clears has", async () => {
    const ctx = new Context();
    const stop = ctx.plugin(channelPlugin);
    const channels = ctx.require<ChannelRegistry>("channels");
    const unregister = channels.register("webhook", {
      async inbound(next) {
        expect(next.text).toBe("hi");
        return { turnId: "t1", status: "ok", text: "out" };
      },
    });
    expect(channels.has("webhook")).toBe(true);
    await expect(channels.inbound("webhook", input)).resolves.toEqual({
      turnId: "t1",
      status: "ok",
      text: "out",
    });
    unregister();
    expect(channels.has("webhook")).toBe(false);
    stop();
    expect(() => ctx.require<ChannelRegistry>("channels")).toThrow(/channels/);
  });

  it("throws on unknown inbound id and duplicate register", () => {
    const channels = createChannelRegistry();
    const adapter = {
      async inbound() {
        return { turnId: "t", status: "ok" as const, text: "" };
      },
    };
    channels.register("webhook", adapter);
    expect(() => channels.register("webhook", adapter)).toThrow(/webhook/);
    expect(() => channels.inbound("nope", input)).toThrow(/nope/);
  });
});
