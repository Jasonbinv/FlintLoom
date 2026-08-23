import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startHost } from "../src/index.ts";
import { ASSEMBLY } from "./assembly.ts";

const DISCORD_YML = `${ASSEMBLY}  - id: channel-discord
    name: "@flintloom/channel-discord"
    config:
      token: tok
      allowedChannelIds:
        - "123"
`;

function writeDiscordAssembly(workspaceRoot: string): void {
  writeFileSync(join(workspaceRoot, "flintloom.yml"), DISCORD_YML);
}

function jsonMessages(result: unknown): Response {
  return new Response(JSON.stringify(result), { status: 200 });
}

describe("discord host overlay", () => {
  let close: (() => Promise<void>) | undefined;
  const originalFetch = globalThis.fetch;
  afterEach(async () => {
    if (close !== undefined) {
      await close();
      close = undefined;
    }
    globalThis.fetch = originalFetch;
  });

  it("startHost polls discord channels from workspace .env", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-discord-host-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-discord-home-"));
    writeDiscordAssembly(workspaceRoot);
    writeFileSync(
      join(workspaceRoot, ".env"),
      "FLINTLOOM_DISCORD_TOKEN=discordtok\nFLINTLOOM_DISCORD_CHANNEL_IDS=999\n",
    );
    const urls: string[] = [];
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      urls.push(u);
      if (u.includes("/channels/999/messages")) {
        return jsonMessages([]);
      }
      if (init?.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      return originalFetch(url, init);
    };
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    await vi.waitFor(() => {
      expect(urls.some((u) => u.includes("discord.com/api/v10/channels/999/messages"))).toBe(
        true,
      );
    });
    await host.close();
    close = undefined;
  });
});
