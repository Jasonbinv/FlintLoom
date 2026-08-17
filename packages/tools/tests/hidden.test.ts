import { describe, expect, it } from "vitest";
import { isHiddenRelPath } from "../src/index.ts";

describe("isHiddenRelPath", () => {
  it("hides env and listed names but not .env.example", () => {
    expect(isHiddenRelPath(".env")).toBe(true);
    expect(isHiddenRelPath(".env.local")).toBe(true);
    expect(isHiddenRelPath("secret.env")).toBe(true);
    expect(isHiddenRelPath(".env.example")).toBe(false);
    expect(isHiddenRelPath("node_modules/pkg/x.js")).toBe(true);
    expect(isHiddenRelPath("docs/a.md")).toBe(false);
  });
});
