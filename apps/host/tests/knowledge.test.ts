import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadOrCreateToken, startHost } from "../src/index.ts";
import { writeAssembly } from "./assembly.ts";

describe("knowledge HTTP", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    if (close) {
      await close();
      close = undefined;
    }
  });

  async function start(): Promise<{
    url: string;
    token: string;
    workspaceRoot: string;
  }> {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-kb-http-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-kb-http-home-"));
    writeFileSync(join(workspaceRoot, "README.md"), "# Hello\nbody token\n");
    writeFileSync(join(workspaceRoot, ".env"), "sk-secret\n");
    writeAssembly(workspaceRoot);
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    return { url: host.url, token: loadOrCreateToken(homeDir), workspaceRoot };
  }

  it("imports, lists, searches, upserts, and hides secrets", async () => {
    const { url, token, workspaceRoot } = await start();
    const auth = { Authorization: `Bearer ${token}` };
    const unauth = await fetch(`${url}/v1/knowledge`);
    expect(unauth.status).toBe(401);

    const imported = await fetch(`${url}/v1/knowledge/import`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ path: "README.md" }),
    });
    expect(imported.status).toBe(200);
    const first = (await imported.json()) as { id: number; status: string; title: string };
    expect(first.status).toBe("ok");
    expect(first.title).toBe("Hello");

    const listRes = await fetch(`${url}/v1/knowledge`, { headers: auth });
    const listText = await listRes.text();
    expect(listRes.status).toBe(200);
    expect(listText).not.toContain(realpathSync.native(workspaceRoot));
    const list = JSON.parse(listText) as {
      items: { path: string; current: boolean }[];
    };
    expect(list.items.some((row) => row.path === "README.md" && row.current)).toBe(true);

    const searchRes = await fetch(`${url}/v1/knowledge/search?q=body%20token`, {
      headers: auth,
    });
    const search = (await searchRes.json()) as { hits: { snippet: string }[] };
    expect(search.hits).toHaveLength(1);
    expect(search.hits[0]?.snippet).toContain("body token");

    const imported2 = await fetch(`${url}/v1/knowledge/import`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ path: "README.md" }),
    });
    expect(((await imported2.json()) as { id: number }).id).toBe(first.id);

    expect(
      (
        await fetch(`${url}/v1/knowledge/import`, {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ path: "missing.md" }),
        })
      ).status,
    ).toBe(404);

    const hidden = await fetch(`${url}/v1/knowledge/import`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ path: ".env" }),
    });
    expect(hidden.status).toBe(200);
    const hiddenBody = (await hidden.json()) as { id?: number; failReason: string };
    expect(hiddenBody.failReason).toBe("hidden");
    expect(hiddenBody.id).toBeUndefined();
    const listAfter = (await (
      await fetch(`${url}/v1/knowledge`, { headers: auth })
    ).json()) as { items: { path: string }[] };
    expect(listAfter.items.some((row) => row.path === ".env")).toBe(false);

    expect((await fetch(`${url}/v1/knowledge/search`, { headers: auth })).status).toBe(400);
  });

  it("returns 404 when knowledge plugin is omitted", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-kb-nokb-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-kb-nokb-home-"));
    writeFileSync(
      join(workspaceRoot, "flintloom.yml"),
      `plugins:
  - id: models
    name: "@flintloom/models"
  - id: tools
    name: "@flintloom/tools"
  - id: session
    name: "@flintloom/session"
  - id: models-chat
    name: "@flintloom/models-chat"
  - id: loop
    name: "@flintloom/loop"
`,
    );
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);
    const res = await fetch(`${host.url}/v1/knowledge`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});
