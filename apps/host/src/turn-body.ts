import type { UserImage } from "@flintloom/session";

const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGES = 4;

export type TurnBody = {
  sessionId: string;
  text: string;
  images?: UserImage[];
  webSearch?: boolean;
};

function decodeBase64Length(data: string): number | undefined {
  const trimmed = data.trim();
  if (trimmed.length === 0 || trimmed.length % 4 !== 0) {
    return undefined;
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    return undefined;
  }
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0;
  return (trimmed.length * 3) / 4 - padding;
}

export function parseUserImages(raw: unknown): UserImage[] | undefined | "invalid" {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_IMAGES) {
    return "invalid";
  }
  const images: UserImage[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") {
      return "invalid";
    }
    const mime = (item as { mime?: unknown }).mime;
    const data = (item as { data?: unknown }).data;
    if (typeof mime !== "string" || typeof data !== "string") {
      return "invalid";
    }
    if (!ALLOWED_IMAGE_MIME.has(mime)) {
      return "invalid";
    }
    const byteLength = decodeBase64Length(data);
    if (byteLength === undefined || byteLength > MAX_IMAGE_BYTES) {
      return "invalid";
    }
    images.push({ mime, data: data.trim() });
  }
  return images;
}

export function parseTurnBody(raw: string): TurnBody | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") {
      return undefined;
    }
    const sessionId = (parsed as { sessionId?: unknown }).sessionId;
    const text = (parsed as { text?: unknown }).text;
    if (typeof sessionId !== "string" || typeof text !== "string") {
      return undefined;
    }
    const images = parseUserImages((parsed as { images?: unknown }).images);
    if (images === "invalid") {
      return undefined;
    }
    const webSearch = (parsed as { webSearch?: unknown }).webSearch;
    if (webSearch !== undefined && typeof webSearch !== "boolean") {
      return undefined;
    }
    if (text.trim().length === 0 && images === undefined) {
      return undefined;
    }
    return {
      sessionId,
      text,
      images,
      ...(webSearch === true ? { webSearch: true } : {}),
    };
  } catch {
    return undefined;
  }
}
