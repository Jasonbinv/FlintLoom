import { describe, expect, it } from "vitest";
import { isInfographicRelPath } from "../src/path.ts";

describe("isInfographicRelPath", () => {
  it("matches suffix case-insensitively and rejects plain json", () => {
    expect(isInfographicRelPath("flow.infographic.json")).toBe(true);
    expect(isInfographicRelPath("Foo.Infographic.JSON")).toBe(true);
    expect(isInfographicRelPath("docs\\a.infographic.json")).toBe(true);
    expect(isInfographicRelPath("notes.json")).toBe(false);
    expect(isInfographicRelPath("flow.infographic.json.bak")).toBe(false);
  });
});
