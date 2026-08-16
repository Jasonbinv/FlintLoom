import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOrCreateToken } from "@flintloom/host";
import { formatCliOutput } from "../src/output.ts";

describe("loadOrCreateToken", () => {
  it("returns the same token on a second call for the same homeDir", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-cli-home-"));
    const first = loadOrCreateToken(homeDir);
    const second = loadOrCreateToken(homeDir);
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
  });
});

describe("formatCliOutput", () => {
  it("writes the last assistant/message to stdout when status is ok", () => {
    expect(
      formatCliOutput(
        [
          { type: "assistant/chunk", text: "partial" },
          { type: "assistant/message", text: "hello" },
        ],
        "ok",
      ),
    ).toEqual({ stdout: "hello\n", stderr: "" });
  });

  it("writes the last model/error to stderr when status is not ok", () => {
    expect(
      formatCliOutput(
        [
          { type: "model/error", kind: "chat", message: "missing api key" },
          { type: "turn/end", turnId: "t1", status: "failed" },
        ],
        "failed",
      ),
    ).toEqual({ stdout: "", stderr: "missing api key\n" });
  });

  it("writes the status to stderr when failed and there is no model/error", () => {
    expect(formatCliOutput([], "failed")).toEqual({
      stdout: "",
      stderr: "failed\n",
    });
  });
});
