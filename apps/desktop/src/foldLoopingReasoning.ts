const DISPLAY_MAX = 6000;
const KEEP_PER_PREFIX = 2;
const MIN_BLOCK = 40;

function blockKey(block: string): string {
  const trimmed = block.replace(/\s+/g, " ").trim();
  return trimmed.slice(0, 96);
}

function collapseDuplicateBlocks(text: string): string {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  if (blocks.length < 6) return text;

  const seen = new Map<string, number>();
  const kept: string[] = [];
  let dropped = 0;
  for (const block of blocks) {
    const key = blockKey(block);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > KEEP_PER_PREFIX && block.length >= MIN_BLOCK) {
      dropped += 1;
      continue;
    }
    kept.push(block);
  }
  if (dropped < 3) return text;
  return `${kept.join("\n\n")}\n\n（思考过程重复 ${dropped} 段，已折叠）`;
}

export function foldLoopingReasoning(text: string): string {
  const folded = collapseDuplicateBlocks(text);
  if (folded.length <= DISPLAY_MAX) return folded;
  return `${folded.slice(0, DISPLAY_MAX).trimEnd()}\n\n（思考过长，已截断）`;
}
