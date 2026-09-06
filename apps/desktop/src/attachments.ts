import type { UserImage } from "./types.ts";
import { fileNameOf } from "./files.ts";

export const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;
export const MAX_ATTACHMENTS = 8;
export const UPLOADS_DIR = "uploads";
export const MAX_VISION_BYTES = 4 * 1024 * 1024;
export const MAX_VISION_IMAGES = 4;

const VISION_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export type PendingAttachment = {
  id: string;
  file: File;
  path: string;
  previewUrl?: string;
};

export function isVisionImage(file: File): boolean {
  return VISION_MIME.has(file.type) && file.size <= MAX_VISION_BYTES;
}

export function isPreviewableImage(file: File): boolean {
  return file.type.startsWith("image/");
}

export function previewUrlForFile(file: File): string | undefined {
  if (!isPreviewableImage(file)) return undefined;
  if (typeof URL.createObjectURL !== "function") return undefined;
  return URL.createObjectURL(file);
}

export function revokeAttachmentPreview(item: PendingAttachment): void {
  if (item.previewUrl !== undefined && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(item.previewUrl);
  }
}

export function safeAttachmentName(name: string): string {
  const base = fileNameOf(name).trim() || "file";
  const cleaned = base.replace(/[\\/:*?"<>|]/g, "_").replace(/^\.+/, "");
  return cleaned.length > 0 ? cleaned : "file";
}

export function appendAttachmentPaths(text: string, paths: string[]): string {
  const extra = paths.filter((path) => !text.includes(path));
  if (extra.length === 0) return text;
  const block = extra.map((path) => `\`${path}\``).join(" ");
  return text.length > 0 ? `${text}\n${block}` : block;
}

export type ClipboardLike = {
  getData: (format: string) => string;
  files?: ArrayLike<File> | null;
  items?: ArrayLike<{ kind: string; type: string; getAsFile: () => File | null }>;
};

function clipboardFiles(data: ClipboardLike): File[] {
  const seen = new Set<string>();
  const out: File[] = [];
  const add = (file: File | null | undefined) => {
    if (!file) return;
    const key = `${file.name}\0${file.size}\0${file.type}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };
  if (data.files) {
    for (const file of Array.from(data.files)) add(file);
  }
  if (data.items) {
    for (const item of Array.from(data.items)) {
      if (item.kind === "file") add(item.getAsFile());
    }
  }
  return out;
}

function fileNameOnlyText(text: string, files: File[]): boolean {
  const names = new Set(files.flatMap((file) => [file.name, fileNameOf(file.name)]));
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => names.has(line) || names.has(fileNameOf(line)));
}

export function filesToAttachFromClipboard(data: ClipboardLike): File[] {
  const files = clipboardFiles(data);
  if (files.length === 0) return [];
  const text = (data.getData("text/plain") ?? "").trim();
  if (text && !fileNameOnlyText(text, files)) return [];
  return files.filter((file) => file.size <= MAX_ATTACHMENT_BYTES);
}

export function nextAttachmentPath(
  dir: string,
  name: string,
  used: Set<string>,
): string {
  const safe = safeAttachmentName(name);
  const prefix = dir === "." || dir === "" ? "" : `${dir}/`;
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";
  let candidate = `${prefix}${safe}`;
  let n = 1;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${prefix}${stem}-${n}${ext}`;
  }
  used.add(candidate);
  return candidate;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("read"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read"));
    reader.readAsDataURL(file);
  });
}

export async function visionImagesFrom(
  attachments: readonly PendingAttachment[],
): Promise<UserImage[] | undefined> {
  const images: UserImage[] = [];
  for (const item of attachments) {
    if (!isVisionImage(item.file)) continue;
    if (images.length >= MAX_VISION_IMAGES) break;
    images.push({ mime: item.file.type, data: await fileToBase64(item.file) });
  }
  return images.length > 0 ? images : undefined;
}
