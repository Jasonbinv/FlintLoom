function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function flattenEmitMessages(raw: unknown): unknown[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: unknown[] = [];
  for (const item of raw) {
    if (isRecord(item) && Array.isArray(item.messages)) {
      const inner = flattenEmitMessages(item.messages);
      if (inner) out.push(...inner);
      continue;
    }
    out.push(item);
  }
  return out;
}
