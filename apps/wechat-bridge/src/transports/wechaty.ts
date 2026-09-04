import type { Bridge } from "../bridge.ts";
import { handleInboundWithSink } from "../bridge.ts";
import type { BridgeConfig } from "../config.ts";

type WechatyMessage = {
  text(): string;
  talker(): { id: string };
  room(): { id: string } | null;
  self(): boolean;
  say(text: string): Promise<void>;
};

type WechatyBot = {
  on(event: "login", listener: (user: { name(): string }) => void): void;
  on(event: "message", listener: (message: WechatyMessage) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
};

type WechatyModule = {
  Wechaty: new (opts: { name: string; puppet: unknown }) => WechatyBot;
};

export async function startWechatyTransport(
  config: BridgeConfig,
  bridge: Bridge,
): Promise<() => Promise<void>> {
  let WechatyCtor: WechatyModule["Wechaty"];
  try {
    const mod = (await import("wechaty")) as WechatyModule;
    WechatyCtor = mod.Wechaty;
  } catch {
    throw new Error(
      "wechaty is not installed. Run: pnpm add wechaty wechaty-puppet-wechat4u --filter @flintloom/wechat-bridge",
    );
  }

  let puppet: unknown;
  try {
    const puppetMod = await import(config.wechatyPuppet);
    const exportName = config.wechatyPuppet.includes("wechat4u")
      ? "Wechat4u"
      : "default";
    puppet =
      exportName === "Wechat4u"
        ? (puppetMod as { Wechat4u: new (opts?: { token?: string }) => unknown }).Wechat4u
        : (puppetMod as { default: new (opts?: { token?: string }) => unknown }).default;
  } catch {
    throw new Error(`failed to load puppet ${config.wechatyPuppet}`);
  }

  const PuppetClass = puppet as new (opts?: { token?: string }) => unknown;
  const bot = new WechatyCtor({
    name: "flintloom-wechat-bridge",
    puppet: new PuppetClass(
      config.wechatyToken ? { token: config.wechatyToken } : undefined,
    ),
  });

  bot.on("login", (user) => {
    console.log(`[wechat-bridge] Wechaty logged in as ${user.name()}`);
    console.warn(
      "[wechat-bridge] 个人微信自动化有封号风险，请使用小号并阅读 docs/wechat-bridge.md",
    );
  });

  bot.on("error", (err) => {
    console.error("[wechat-bridge] Wechaty error:", err.message);
  });

  bot.on("message", (message) => {
    void handleWechatyMessage(bridge, message);
  });

  await bot.start();
  console.log("[wechat-bridge] Wechaty mode started; waiting for messages…");

  return async () => {
    await bot.stop();
  };
}

async function handleWechatyMessage(bridge: Bridge, message: WechatyMessage): Promise<void> {
  if (message.self()) {
    return;
  }
  const text = message.text().trim();
  if (text.length === 0) {
    return;
  }
  const room = message.room();
  const inbound = {
    from: message.talker().id,
    text,
    room: room?.id,
  };
  await handleInboundWithSink(bridge, {
    async sendReply(_msg, chunk) {
      await message.say(chunk);
    },
  }, inbound);
}
