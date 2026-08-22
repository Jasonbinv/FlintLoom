import { describe, expect, it } from "vitest";
import {
  SKILL_DESCRIPTION_MAX,
  parseSkillMarkdown,
} from "../src/parse.ts";

describe("parseSkillMarkdown", () => {
  it("reads name description and body after the fence", () => {
    const parsed = parseSkillMarkdown(
      "---\nname: Demo\ndescription: A demo skill\n---\n# Hello\n",
    );
    expect(parsed).toEqual({
      name: "Demo",
      description: "A demo skill",
      body: "# Hello\n",
    });
  });

  it("accepts BOM and CRLF fences", () => {
    const parsed = parseSkillMarkdown(
      "\uFEFF---\r\nname: X\r\ndescription: Y\r\n---\r\nbody",
    );
    expect(parsed.name).toBe("X");
    expect(parsed.description).toBe("Y");
    expect(parsed.body).toBe("body");
  });

  it("rejects missing fence empty name and overlong description", () => {
    expect(() => parseSkillMarkdown("# no fence\n")).toThrow(/bad skill/);
    expect(() =>
      parseSkillMarkdown("---\nname: \ndescription: Y\n---\n"),
    ).toThrow(/bad skill/);
    expect(() =>
      parseSkillMarkdown(
        `---\nname: N\ndescription: ${"d".repeat(SKILL_DESCRIPTION_MAX + 1)}\n---\n`,
      ),
    ).toThrow(/bad skill/);
  });
});
