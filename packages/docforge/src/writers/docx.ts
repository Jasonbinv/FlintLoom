import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { Block } from "../generate-types.ts";

const FONT = {
  ascii: "Microsoft YaHei",
  hAnsi: "Microsoft YaHei",
  eastAsia: "Microsoft YaHei",
  hint: "eastAsia",
};
const EMOJI_FONT = {
  ascii: "Segoe UI Emoji",
  hAnsi: "Segoe UI Emoji",
  eastAsia: "Segoe UI Emoji",
  hint: "eastAsia",
};
const LANG = { value: "zh-CN", eastAsia: "zh-CN" };
const TEXT_COLOR = "111827";
const HEADER_FILL = "F3F4F6";
const BORDER_COLOR = "D1D5DB";
const TABLE_FONT_SIZE = 22;
const EMOJI_RE =
  /\p{Extended_Pictographic}(?:\uFE0F\u20E3|\uFE0F|\u200D\p{Extended_Pictographic}\uFE0F?)*/gu;

type RunOpts = { bold?: boolean; italics?: boolean; size?: number };

function run(text: string, opts?: RunOpts): TextRun {
  return new TextRun({
    text,
    font: FONT,
    language: LANG,
    color: TEXT_COLOR,
    bold: opts?.bold,
    italics: opts?.italics,
    size: opts?.size,
  });
}

function emojiRun(text: string, opts?: RunOpts): TextRun {
  return new TextRun({
    text,
    font: EMOJI_FONT,
    language: LANG,
    bold: opts?.bold,
    italics: opts?.italics,
    size: opts?.size,
  });
}

function runsPlain(text: string, opts?: RunOpts): TextRun[] {
  const runs: TextRun[] = [];
  let last = 0;
  for (const match of text.matchAll(EMOJI_RE)) {
    const start = match.index ?? 0;
    if (start > last) runs.push(run(text.slice(last, start), opts));
    runs.push(emojiRun(match[0], opts));
    last = start + match[0].length;
  }
  if (last < text.length) runs.push(run(text.slice(last), opts));
  return runs.length > 0 ? runs : [run(text, opts)];
}

function runsFromText(text: string, opts?: RunOpts): TextRun[] {
  const runs: TextRun[] = [];
  const emphasis = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  for (const match of text.matchAll(emphasis)) {
    const start = match.index ?? 0;
    if (start > last) runs.push(...runsPlain(text.slice(last, start), opts));
    if (match[1] !== undefined) {
      runs.push(...runsFromText(match[1], { ...opts, bold: true }));
    } else if (match[2] !== undefined) {
      runs.push(...runsFromText(match[2], { ...opts, italics: true }));
    }
    last = start + match[0].length;
  }
  if (last < text.length) runs.push(...runsPlain(text.slice(last), opts));
  return runs.length > 0 ? runs : runsPlain(text, opts);
}

type RasterKind = "png" | "jpg" | "gif" | "bmp";

function pngSize(data: Buffer): { width: number; height: number } | undefined {
  if (data.length < 24 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) {
    return undefined;
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width < 1 || height < 1) return undefined;
  return { width, height };
}

function rasterFromBytes(
  data: Buffer,
  typeHint?: RasterKind,
): { type: RasterKind; data: Buffer; width: number; height: number } | undefined {
  if (data.length === 0) return undefined;
  let type = typeHint;
  if (!type) {
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) type = "png";
    else if (data[0] === 0xff && data[1] === 0xd8) type = "jpg";
    else if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) type = "gif";
    else if (data[0] === 0x42 && data[1] === 0x4d) type = "bmp";
  }
  if (!type) return undefined;
  const size = type === "png" ? pngSize(data) : undefined;
  return { type, data, width: size?.width ?? 540, height: size?.height ?? 240 };
}

function decodeRasterDataUri(
  src: string,
): { type: RasterKind; data: Buffer; width: number; height: number } | undefined {
  const match = src.match(/^data:image\/(png|jpeg|jpg|gif|bmp);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return undefined;
  const raw = match[1]!.toLowerCase();
  const type: RasterKind =
    raw === "jpeg" || raw === "jpg" ? "jpg" : raw === "gif" ? "gif" : raw === "bmp" ? "bmp" : "png";
  return rasterFromBytes(Buffer.from(match[2]!.replace(/\s+/g, ""), "base64"), type);
}

function resolveLocalImage(src: string, baseDir?: string): string | undefined {
  if (!baseDir) return undefined;
  const cleaned = src.trim().split(/[?#]/)[0] ?? "";
  if (!cleaned || /^https?:/i.test(cleaned) || cleaned.startsWith("data:")) return undefined;
  const abs = resolve(baseDir, cleaned);
  const rel = relative(baseDir, abs);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return abs;
}

async function loadRaster(
  src: string,
  baseDir?: string,
): Promise<{ type: RasterKind; data: Buffer; width: number; height: number } | undefined> {
  const fromUri = decodeRasterDataUri(src);
  if (fromUri) return fromUri;
  const abs = resolveLocalImage(src, baseDir);
  if (!abs) return undefined;
  try {
    return rasterFromBytes(await readFile(abs));
  } catch {
    return undefined;
  }
}

/** 表格与图片之间留约 12pt（240 twips），避免导出后贴在一起。 */
const BLOCK_GAP_TWIPS = 240;

function spacerParagraph(): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: BLOCK_GAP_TWIPS },
    children: [],
  });
}

async function imageParagraph(
  block: Extract<Block, { type: "image" }>,
  baseDir?: string,
): Promise<Paragraph | undefined> {
  const decoded = await loadRaster(block.src, baseDir);
  if (!decoded) return undefined;
  const maxWidth = 540;
  let width = decoded.width;
  let height = decoded.height;
  if (width > maxWidth) {
    height = Math.max(1, Math.round((height * maxWidth) / width));
    width = maxWidth;
  }
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: BLOCK_GAP_TWIPS, after: BLOCK_GAP_TWIPS },
    children: [
      new ImageRun({
        type: decoded.type,
        data: decoded.data,
        transformation: { width, height },
        altText: { title: block.alt || "chart", description: block.alt || "chart" },
      }),
    ],
  });
}

const LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

export async function renderDocx(blocks: Block[], opts?: { imageBaseDir?: string }): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        children.push(
          new Paragraph({
            heading: LEVELS[block.level - 1],
            spacing: { before: BLOCK_GAP_TWIPS, after: 120 },
            children: runsFromText(block.text),
          }),
        );
        break;
      case "paragraph":
        children.push(new Paragraph({ children: runsFromText(block.text) }));
        break;
      case "list":
        for (const [i, item] of block.items.entries()) {
          const prefix = block.ordered ? `${i + 1}. ` : "• ";
          children.push(new Paragraph({ children: runsFromText(prefix + item) }));
        }
        break;
      case "code":
        children.push(new Paragraph({ children: runsFromText(block.text) }));
        break;
      case "table": {
        const colCount = Math.max(block.headers.length, 1);
        const border = {
          style: BorderStyle.SINGLE,
          size: 8,
          color: BORDER_COLOR,
        };
        const cell = (text: string, header = false) =>
          new TableCell({
            width: { size: Math.floor(100 / colCount), type: WidthType.PERCENTAGE },
            shading: header
              ? { type: ShadingType.CLEAR, fill: HEADER_FILL, color: "auto" }
              : undefined,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: runsFromText(text, { bold: header, size: TABLE_FONT_SIZE }),
              }),
            ],
          });
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.AUTOFIT,
            alignment: AlignmentType.CENTER,
            borders: {
              top: border,
              bottom: border,
              left: border,
              right: border,
              insideHorizontal: border,
              insideVertical: border,
            },
            rows: [
              new TableRow({
                children: block.headers.map((h) => cell(h, true)),
              }),
              ...block.rows.map(
                (row) =>
                  new TableRow({
                    children: block.headers.map((_, idx) => cell(row[idx] ?? "")),
                  }),
              ),
            ],
          }),
        );
        children.push(spacerParagraph());
        break;
      }
      case "image": {
        const image = await imageParagraph(block, opts?.imageBaseDir);
        if (image) children.push(image);
        break;
      }
    }
  }
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: FONT,
            language: LANG,
          },
        },
      },
    },
    sections: [{ children }],
  });
  const packed = await Packer.toBuffer(doc);
  return Buffer.from(packed);
}
