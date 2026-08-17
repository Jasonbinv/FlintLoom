import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ToolRegistry } from "@flintloom/tools";
import { createRuntime, loadOrCreateToken, startHost } from "../src/index.ts";
import { writeAssembly } from "./assembly.ts";

function twoNodeDoc() {
  return {
    nodes: [
      { id: "parse", label: "Parse", x: 20, y: 40 },
      { id: "kb", label: "KB", x: 200, y: 40 },
    ],
    edges: [{ from: "parse", to: "kb" }],
  };
}

describe("infographic preview HTTP", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    if (close) {
      await close();
      close = undefined;
    }
  });

  it("returns svg for infographic json and text for plain json", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-ig-http-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-ig-http-home-"));
    writeAssembly(workspaceRoot);
    writeFileSync(
      join(workspaceRoot, "flow.infographic.json"),
      JSON.stringify(twoNodeDoc(), null, 2) + "\n",
    );
    writeFileSync(join(workspaceRoot, "notes.json"), '{"ok":true}\n');
    writeFileSync(join(workspaceRoot, "bad.infographic.json"), "{");
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);
    const headers = { Authorization: `Bearer ${token}` };

    const svg = await fetch(`${host.url}/v1/files/preview?path=flow.infographic.json`, { headers });
    expect(svg.status).toBe(200);
    const svgBody = (await svg.json()) as { kind: string; text: string };
    expect(svgBody.kind).toBe("svg");
    expect(svgBody.text).toContain("<svg");
    expect(svgBody.text).toContain("Parse");

    const plain = await fetch(`${host.url}/v1/files/preview?path=notes.json`, { headers });
    const plainBody = (await plain.json()) as { kind: string; text: string };
    expect(plainBody.kind).toBe("text");
    expect(plainBody.text).toContain('"ok"');

    const bad = await fetch(`${host.url}/v1/files/preview?path=bad.infographic.json`, { headers });
    const badBody = (await bad.json()) as { kind: string; text: string };
    expect(badBody.kind).toBe("failed");
    expect(badBody.text).toMatch(/^failed:/);
  });

  it("omitting the plugin drops tools but still previews svg", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-ig-omit-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-ig-omit-home-"));
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
    writeFileSync(
      join(workspaceRoot, "flow.infographic.json"),
      JSON.stringify(twoNodeDoc(), null, 2) + "\n",
    );
    const { ctx } = await createRuntime(workspaceRoot, homeDir);
    const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
    expect(names).not.toContain("infographic_get");
    expect(names).not.toContain("infographic_patch");

    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);
    const res = await fetch(`${host.url}/v1/files/preview?path=flow.infographic.json`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as { kind: string; text: string };
    expect(body.kind).toBe("svg");
    expect(body.text).toContain("<svg");
  });
});
