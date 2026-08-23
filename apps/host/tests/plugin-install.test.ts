import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { handlePluginInstallRequest } from "../src/plugin-install.ts";
import { writeAssembly } from "./assembly.ts";

const APPLY_MJS = `export default {
  name: "sample",
  apply(ctx) {
    ctx.provide("plugin-install-test", 1);
  },
};
`;

function mockRes() {
  const state = {
    status: 0,
    body: "",
    headersSent: false,
    writableEnded: false,
  };
  const res = {
    get headersSent() {
      return state.headersSent;
    },
    get writableEnded() {
      return state.writableEnded;
    },
    writeHead(status: number) {
      state.status = status;
      state.headersSent = true;
      return this;
    },
    end(chunk?: string) {
      if (typeof chunk === "string") state.body = chunk;
      state.writableEnded = true;
    },
  };
  return { res: res as unknown as ServerResponse, state };
}

function installReq(body: unknown): IncomingMessage {
  const req = Readable.from([JSON.stringify(body)]) as IncomingMessage;
  Object.assign(req, { method: "POST" });
  return req;
}

function writePlugin(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.mjs"), APPLY_MJS);
}

describe("plugin install HTTP", () => {
  it("installs a local plugin and reloads runtime", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-install-ws-"));
    const home = mkdtempSync(join(tmpdir(), "flintloom-install-home-"));
    const source = mkdtempSync(join(tmpdir(), "flintloom-install-src-"));
    writeAssembly(workspace);
    writePlugin(source);

    const reloadRuntime = vi.fn(async () => undefined);
    const { res, state } = mockRes();

    const handled = await handlePluginInstallRequest(installReq({ sourcePath: source }), res, {
      pathname: "/v1/plugins/install",
      method: "POST",
      homeDir: home,
      workspaceRoot: workspace,
      busy: new Set<string>(),
      reloadRuntime,
    });

    expect(handled).toBe(true);
    expect(state.status).toBe(200);
    const body = JSON.parse(state.body) as { ok: boolean; id: string; dest: string };
    expect(body.ok).toBe(true);
    expect(body.id).toBe(source.split(/[/\\]/).pop());
    expect(existsSync(join(body.dest, "index.mjs"))).toBe(true);
    expect(reloadRuntime).toHaveBeenCalledOnce();

    const yml = readFileSync(join(workspace, "flintloom.yml"), "utf8");
    expect(yml).toContain(body.dest);
  });

  it("returns 409 when host is busy", async () => {
    const { res, state } = mockRes();
    const handled = await handlePluginInstallRequest(
      installReq({ sourcePath: "/tmp/plugin" }),
      res,
      {
        pathname: "/v1/plugins/install",
        method: "POST",
        homeDir: "/tmp/home",
        workspaceRoot: "/tmp/ws",
        busy: new Set<string>(["s1"]),
        reloadRuntime: vi.fn(),
      },
    );
    expect(handled).toBe(true);
    expect(state.status).toBe(409);
    expect(state.body).toBe("busy");
  });

  it("returns 400 for invalid source path", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-install-bad-"));
    const home = mkdtempSync(join(tmpdir(), "flintloom-install-bad-home-"));
    writeAssembly(workspace);

    const { res, state } = mockRes();
    const handled = await handlePluginInstallRequest(
      installReq({ sourcePath: join(workspace, "missing-plugin") }),
      res,
      {
        pathname: "/v1/plugins/install",
        method: "POST",
        homeDir: home,
        workspaceRoot: workspace,
        busy: new Set<string>(),
        reloadRuntime: vi.fn(),
      },
    );
    expect(handled).toBe(true);
    expect(state.status).toBe(400);
    expect(state.body).toBe("path");
  });
});
