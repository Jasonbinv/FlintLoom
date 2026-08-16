import { readFile } from "node:fs/promises";
import JSZip from "jszip";

const SLIDE = /^ppt\/slides\/slide(\d+)\.xml$/;
const DRAWING_TEXT = /<a:t[^>]*>([^<]*)<\/a:t>/g;

export async function parsePptx(
  absPath: string,
): Promise<{ pages: number; markdown: string }> {
  const zip = await JSZip.loadAsync(await readFile(absPath));
  const slides = Object.keys(zip.files)
    .map((name) => {
      const match = SLIDE.exec(name);
      return match ? { name, n: Number(match[1]) } : undefined;
    })
    .filter((row): row is { name: string; n: number } => row !== undefined)
    .sort((a, b) => a.n - b.n);

  const parts: string[] = [];
  for (const slide of slides) {
    const xml = await zip.file(slide.name)!.async("string");
    const texts: string[] = [];
    for (const match of xml.matchAll(DRAWING_TEXT)) {
      texts.push(match[1]);
    }
    parts.push(`## Slide ${slide.n}\n\n${texts.join("\n")}`);
  }
  return { pages: slides.length, markdown: parts.join("\n\n") };
}
