import { describe, expect, it } from "vitest";
import { validateMcpConfig } from "../src/config.ts";

describe("validateMcpConfig", () => {
  it("accepts valid config", () => {
    const cfg = validateMcpConfig({
      id: "fake",
      command: "node",
      args: ["script.mjs"],
      env: ["FAKE_TOKEN"],
      workspaceRoot: "/tmp/ws",
      envValues: { FAKE_TOKEN: "tok" },
    });
    expect(cfg).toEqual({
      id: "fake",
      command: "node",
      args: ["script.mjs"],
      env: ["FAKE_TOKEN"],
      envValues: { FAKE_TOKEN: "tok" },
      workspaceRoot: "/tmp/ws",
    });
  });

  it("rejects bad id command env and workspaceRoot", () => {
    expect(() => validateMcpConfig({ id: "", command: "x", workspaceRoot: "/w" })).toThrow(
      /id/,
    );
    expect(() =>
      validateMcpConfig({ id: "fake", command: "", workspaceRoot: "/w" }),
    ).toThrow(/command/);
    expect(() =>
      validateMcpConfig({
        id: "fake",
        command: "node",
        workspaceRoot: "/w",
        env: ["FLINTLOOM_API_KEY"],
      }),
    ).toThrow(/env/);
    expect(() =>
      validateMcpConfig({ id: "fake", command: "node", workspaceRoot: "" }),
    ).toThrow(/workspaceRoot/);
  });
});
