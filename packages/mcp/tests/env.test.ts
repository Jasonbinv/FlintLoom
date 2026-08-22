import { describe, expect, it } from "vitest";
import { BASELINE_ENV_NAMES, buildChildEnv } from "../src/env.ts";

describe("buildChildEnv", () => {
  it("copies baseline vars and declared names without FLINTLOOM_*", () => {
    const prevPath = process.env.PATH;
    process.env.PATH = "/bin";
    process.env.FLINTLOOM_API_KEY = "secret";
    process.env.FAKE_TOKEN = "tok";
    try {
      const env = buildChildEnv({
        declared: ["FAKE_TOKEN"],
      });
      expect(env.PATH).toBe("/bin");
      expect(env.FAKE_TOKEN).toBe("tok");
      expect(env.FLINTLOOM_API_KEY).toBeUndefined();
      for (const name of BASELINE_ENV_NAMES) {
        if (name.startsWith("FLINTLOOM")) {
          expect(env[name]).toBeUndefined();
        }
      }
    } finally {
      if (prevPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = prevPath;
      }
      delete process.env.FLINTLOOM_API_KEY;
      delete process.env.FAKE_TOKEN;
    }
  });

  it("uses envValues and throws with env name when missing", () => {
    expect(() =>
      buildChildEnv({
        declared: ["NEED_ME"],
      }),
    ).toThrow(/NEED_ME/);

    const env = buildChildEnv({
      declared: ["NEED_ME"],
      envValues: { NEED_ME: "from-overlay" },
    });
    expect(env.NEED_ME).toBe("from-overlay");
  });

  it("rejects FLINTLOOM_* in declared list", () => {
    expect(() =>
      buildChildEnv({
        declared: ["FLINTLOOM_API_KEY"],
      }),
    ).toThrow(/env/);
  });
});
