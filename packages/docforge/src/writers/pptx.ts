import JSZip from "jszip";
import type { Block } from "../generate-types.ts";

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function blockLines(block: Block): string[] {
  switch (block.type) {
    case "heading":
      return [block.text];
    case "paragraph":
      return [block.text];
    case "list":
      return block.items.map((item, index) =>
        block.ordered ? `${index + 1}. ${item}` : item,
      );
    case "code":
      return [block.text];
    case "table":
      return [
        block.headers.join(" | "),
        ...block.rows.map((row) => row.join(" | ")),
      ];
  }
}

function blocksToSlides(blocks: Block[]): string[][] {
  const slides: string[][] = [];
  let current: string[] = [];

  const pushSlide = () => {
    if (current.length > 0) {
      slides.push(current);
    }
    current = [];
  };

  for (const block of blocks) {
    if (block.type === "heading" && block.level <= 2) {
      pushSlide();
      current.push(...blockLines(block));
    } else {
      current.push(...blockLines(block));
    }
  }
  pushSlide();
  if (slides.length === 0) {
    slides.push([""]);
  }
  return slides;
}

function slideXml(lines: string[]): string {
  const paragraphs = lines
    .map((line) => `<a:p><a:r><a:t>${escapeXml(line)}</a:t></a:r></a:p>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`;
}

export async function renderPptx(blocks: Block[]): Promise<Buffer> {
  const slides = blocksToSlides(blocks);
  const zip = new JSZip();
  const overrides = slides
    .map(
      (_, index) =>
        `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )
    .join("");
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${overrides}
</Types>`,
  );
  for (let i = 0; i < slides.length; i++) {
    zip.file(`ppt/slides/slide${i + 1}.xml`, slideXml(slides[i]!));
  }
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}
