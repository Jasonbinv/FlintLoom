import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyConfig,
  Context,
  installPluginFromPath,
  loadConfig,
} from "../src/index.ts";

const APPLY_MJS = `export default {
  name: "sample",
  apply(ctx) {
    ctx.provide("plugin-add-test", 1);
  },
};
`;

function writePlugin(dir: string, source: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.mjs"), source);
}

function writeYml(workspace: string, text = "plugins: []\n"): void {
  writeFileSync(join(workspace, "flintloom.yml"), text);
}

describe("installPluginFromPath", () => {
  it("copies the bundle, appends yml, and applyConfig loads it", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-add-ws-"));
    const home = mkdtempSync(join(tmpdir(), "flintloom-add-home-"));
    const source = mkdtempSync(join(tmpdir(), "flintloom-add-src-"));
    writePlugin(source, APPLY_MJS);
    writeYml(workspace);
    mkdirSync(join(source, "node_modules"));
    writeFileSync(join(source, "node_modules", "ignored.js"), "nope");

    const { id, dest } = await installPluginFromPath({
      workspaceRoot: workspace,
      homeDir: home,
      sourcePath: source,
      id: "sample",
    });

    expect(id).toBe("sample");
    expect(dest).toBe(join(home, ".flintloom", "plugins", "sample"));
    expect(existsSync(join(dest, "index.mjs"))).toBe(true);
    expect(existsSync(join(dest, "node_modules"))).toBe(false);

    const config = loadConfig(
      readFileSync(join(workspace, "flintloom.yml"), "utf8"),
    );
    expect(config.plugins).toHaveLength(1);
    expect(config.plugins[0]).toEqual({ id: "sample", name: dest });

    const ctx = new Context();
    const stop = await applyConfig(ctx, config);
    expect(ctx.require("plugin-add-test")).toBe(1);
    stop();
  });

  it("defaults id to the source directory basename", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-add-base-ws-"));
    const home = mkdtempSync(join(tmpdir(), "flintloom-add-base-home-"));
    const parent = mkdtempSync(join(tmpdir(), "flintloom-add-base-parent-"));
    const source = join(parent, "myplug");
    writePlugin(source, APPLY_MJS);
    writeYml(workspace);
    const { id } = await installPluginFromPath({
      workspaceRoot: workspace,
      homeDir: home,
      sourcePath: source,
    });
    expect(id).toBe("myplug");
    expect(existsSync(join(home, ".flintloom", "plugins", "myplug", "index.mjs"))).toBe(
      true,
    );
  });

  it("refuses a duplicate id without changing dest", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-add-dup-ws-"));
    const home = mkdtempSync(join(tmpdir(), "flintloom-add-dup-home-"));
    const source = mkdtempSync(join(tmpdir(), "flintloom-add-dup-src-"));
    writePlugin(source, APPLY_MJS);
    writeYml(workspace);
    await installPluginFromPath({
      workspaceRoot: workspace,
      homeDir: home,
      sourcePath: source,
      id: "sample",
    });
    const dest = join(home, ".flintloom", "plugins", "sample");
    const yml = readFileSync(join(workspace, "flintloom.yml"), "utf8");
    await expect(
      installPluginFromPath({
        workspaceRoot: workspace,
        homeDir: home,
        sourcePath: source,
        id: "sample",
      }),
    ).rejects.toThrow(/id/);
    expect(readFileSync(join(workspace, "flintloom.yml"), "utf8")).toBe(yml);
    expect(existsSync(join(dest, "index.mjs"))).toBe(true);
  });

  it("refuses when dest exists even if yml lacks the id", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-add-dest-ws-"));
    const home = mkdtempSync(join(tmpdir(), "flintloom-add-dest-home-"));
    const source = mkdtempSync(join(tmpdir(), "flintloom-add-dest-src-"));
    writePlugin(source, APPLY_MJS);
    writeYml(workspace);
    mkdirSync(join(home, ".flintloom", "plugins", "sample"), {
      recursive: true,
    });
    await expect(
      installPluginFromPath({
        workspaceRoot: workspace,
        homeDir: home,
        sourcePath: source,
        id: "sample",
      }),
    ).rejects.toThrow(/id/);
    expect(readFileSync(join(workspace, "flintloom.yml"), "utf8")).toBe(
      "plugins: []\n",
    );
  });

  it("does not leave dest or yml changes when apply is missing", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-add-noapply-ws-"));
    const home = mkdtempSync(join(tmpdir(), "flintloom-add-noapply-home-"));
    const source = mkdtempSync(join(tmpdir(), "flintloom-add-noapply-src-"));
    writePlugin(source, "export default { name: 'x' };\n");
    writeYml(workspace);
    await expect(
      installPluginFromPath({
        workspaceRoot: workspace,
        homeDir: home,
        sourcePath: source,
        id: "sample",
      }),
    ).rejects.toThrow();
    expect(existsSync(join(home, ".flintloom", "plugins", "sample"))).toBe(
      false,
    );
    expect(readFileSync(join(workspace, "flintloom.yml"), "utf8")).toBe(
      "plugins: []\n",
    );
    const pluginsDir = join(home, ".flintloom", "plugins");
    if (existsSync(pluginsDir)) {
      expect(
        readdirSync(pluginsDir).filter((name) => name.includes(".tmp-")),
      ).toEqual([]);
    }
  });

  it("throws entry when the directory has no entry", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-add-empty-ws-"));
    const home = mkdtempSync(join(tmpdir(), "flintloom-add-empty-home-"));
    const source = mkdtempSync(join(tmpdir(), "flintloom-add-empty-src-"));
    writeYml(workspace);
    await expect(
      installPluginFromPath({
        workspaceRoot: workspace,
        homeDir: home,
        sourcePath: source,
        id: "sample",
      }),
    ).rejects.toThrow(/entry/);
  });

  it("throws plugins when flintloom.yml is missing", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-add-noyaml-ws-"));
    const home = mkdtempSync(join(tmpdir(), "flintloom-add-noyaml-home-"));
    const source = mkdtempSync(join(tmpdir(), "flintloom-add-noyaml-src-"));
    writePlugin(source, APPLY_MJS);
    await expect(
      installPluginFromPath({
        workspaceRoot: workspace,
        homeDir: home,
        sourcePath: source,
        id: "sample",
      }),
    ).rejects.toThrow(/plugins/);
  });

  it("throws path when the source is not a directory", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-add-file-ws-"));
    const home = mkdtempSync(join(tmpdir(), "flintloom-add-file-home-"));
    const source = mkdtempSync(join(tmpdir(), "flintloom-add-file-src-"));
    const file = join(source, "index.mjs");
    writePlugin(source, APPLY_MJS);
    writeYml(workspace);
    await expect(
      installPluginFromPath({
        workspaceRoot: workspace,
        homeDir: home,
        sourcePath: file,
        id: "sample",
      }),
    ).rejects.toThrow(/path/);
  });

  it("throws id when id contains a separator", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-add-badid-ws-"));
    const home = mkdtempSync(join(tmpdir(), "flintloom-add-badid-home-"));
    const source = mkdtempSync(join(tmpdir(), "flintloom-add-badid-src-"));
    writePlugin(source, APPLY_MJS);
    writeYml(workspace);
    await expect(
      installPluginFromPath({
        workspaceRoot: workspace,
        homeDir: home,
        sourcePath: source,
        id: "a/b",
      }),
    ).rejects.toThrow(/id/);
  });
});
