import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatGenerationDate,
  generationDirFromTopic,
  placeGeneratedRelPath,
  preferExistingGeneratedRel,
  routeGeneratedWriteRel,
  slugGenerationTopic,
} from "../src/generatedPath.ts";

describe("slugGenerationTopic", () => {
  it("keeps Chinese topic text and strips illegal path characters", () => {
    expect(slugGenerationTopic("  a:b/c*d  ")).toBe("abcd");
  });

  it("strips request boilerplate and format words, then caps at 8 characters", () => {
    expect(slugGenerationTopic("写一个关于三国故事的文案，写成 word 和 ppt")).toBe(
      "三国故事",
    );
    expect(
      slugGenerationTopic("把英语KET考纲中关于阅读的内容，做成一个word和PPT"),
    ).toBe("英语KET考纲阅");
    expect(slugGenerationTopic("做一个word和PPT示例")).toBe("示例");
    expect(slugGenerationTopic("word示例")).toBe("示例");
  });

  it("falls back to chat when nothing usable remains", () => {
    expect(slugGenerationTopic("   ")).toBe("chat");
    expect(slugGenerationTopic(':*?"<>|')).toBe("chat");
    expect(slugGenerationTopic("写成PDF")).toBe("chat");
  });

  it("caps length at 8 characters", () => {
    expect(slugGenerationTopic("字".repeat(50))).toBe("字".repeat(8));
  });
});

describe("generationDirFromTopic", () => {
  it("builds ai_generation/date_topic from local date", () => {
    const noon = new Date(2026, 7, 30, 12, 0, 0).getTime();
    expect(generationDirFromTopic("做一个word和PPT示例", noon)).toBe(
      "ai_generation/2026-08-30_示例",
    );
    expect(formatGenerationDate(noon)).toBe("2026-08-30");
  });
});

describe("placeGeneratedRelPath", () => {
  const dir = "ai_generation/2026-08-30_word示例";

  it("leaves paths unchanged without a generation dir", () => {
    expect(placeGeneratedRelPath("note.docx")).toBe("note.docx");
    expect(placeGeneratedRelPath("note.docx", undefined)).toBe("note.docx");
  });

  it("places a root-level file into the generation dir", () => {
    expect(placeGeneratedRelPath("example.md", dir)).toBe(`${dir}/example.md`);
    expect(placeGeneratedRelPath("note.docx", dir)).toBe(`${dir}/note.docx`);
    expect(placeGeneratedRelPath("slide.pptx", dir)).toBe(`${dir}/slide.pptx`);
  });

  it("does not rewrite hidden names or nested custom paths", () => {
    expect(placeGeneratedRelPath(".env", dir)).toBe(".env");
    expect(placeGeneratedRelPath("reports/note.docx", dir)).toBe("reports/note.docx");
    expect(placeGeneratedRelPath(`${dir}/example.md`, dir)).toBe(`${dir}/example.md`);
  });

  it("lifts a hallucinated ai_generation folder into the session dir", () => {
    expect(placeGeneratedRelPath("ai_generation/20240522_KET_Syllabus/ket.md", dir)).toBe(
      `${dir}/ket.md`,
    );
    expect(placeGeneratedRelPath("ai_generation/2023_10_27_KET_Syllabus/ket.docx", dir)).toBe(
      `${dir}/ket.docx`,
    );
  });

  it("lifts a legacy type-folder file into the generation dir", () => {
    expect(placeGeneratedRelPath("docx/note.docx", dir)).toBe(`${dir}/note.docx`);
    expect(placeGeneratedRelPath("PPT/slide.pptx", dir)).toBe(`${dir}/slide.pptx`);
    expect(placeGeneratedRelPath("md/draft.md", dir)).toBe(`${dir}/draft.md`);
  });
});

describe("routeGeneratedWriteRel", () => {
  const dir = "ai_generation/2026-08-30_word示例";

  it("keeps an existing root file in place", () => {
    const root = mkdtempSync(join(tmpdir(), "flintloom-gen-keep-"));
    writeFileSync(join(root, "README.md"), "# hi\n");
    expect(routeGeneratedWriteRel("README.md", root, dir)).toBe("README.md");
  });

  it("routes a new root file into the generation dir", () => {
    const root = mkdtempSync(join(tmpdir(), "flintloom-gen-new-"));
    expect(routeGeneratedWriteRel("example.md", root, dir)).toBe(`${dir}/example.md`);
  });
});

describe("preferExistingGeneratedRel", () => {
  const dir = "ai_generation/2026-08-30_word示例";

  it("finds a file already written under the generation dir", () => {
    const root = mkdtempSync(join(tmpdir(), "flintloom-gen-src-"));
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, "example.md"), "# x\n");
    expect(preferExistingGeneratedRel("example.md", root, dir)).toBe(`${dir}/example.md`);
  });

  it("prefers the original path when it exists", () => {
    const root = mkdtempSync(join(tmpdir(), "flintloom-gen-orig-"));
    writeFileSync(join(root, "example.md"), "# root\n");
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, "example.md"), "# gen\n");
    expect(preferExistingGeneratedRel("example.md", root, dir)).toBe("example.md");
  });
});
