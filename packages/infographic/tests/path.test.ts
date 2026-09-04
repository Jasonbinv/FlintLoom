import { describe, expect, it } from "vitest";
import { isAntvInfographicRelPath, isInfographicRelPath } from "../src/path.ts";

describe("isInfographicRelPath", () => {
  it("matches suffix case-insensitively and rejects plain json", () => {
    expect(isInfographicRelPath("flow.infographic.json")).toBe(true);
    expect(isInfographicRelPath("Foo.Infographic.JSON")).toBe(true);
    expect(isInfographicRelPath("docs\\a.infographic.json")).toBe(true);
    expect(isInfographicRelPath("notes.json")).toBe(false);
    expect(isInfographicRelPath("flow.infographic.json.bak")).toBe(false);
    expect(isInfographicRelPath("steps.infographic.ig")).toBe(false);
  });
});

describe("isAntvInfographicRelPath", () => {
  it("matches AntV syntax suffix and rejects box-line json", () => {
    expect(isAntvInfographicRelPath("steps.infographic.ig")).toBe(true);
    expect(isAntvInfographicRelPath("Foo.Infographic.IG")).toBe(true);
    expect(isAntvInfographicRelPath("docs\\a.infographic.ig")).toBe(true);
    expect(isAntvInfographicRelPath("flow.infographic.json")).toBe(false);
    expect(isAntvInfographicRelPath("notes.ig")).toBe(false);
  });
});
