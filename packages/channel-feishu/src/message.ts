export function feishuTextFromContent(content: unknown): string | undefined {
  if (typeof content !== "string" || content.length === 0) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed === null || typeof parsed !== "object") {
      return undefined;
    }
    const text = (parsed as { text?: unknown }).text;
    if (typeof text !== "string") {
      return undefined;
    }
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}
