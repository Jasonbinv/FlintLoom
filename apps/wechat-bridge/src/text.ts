const WECHAT_TEXT_MAX = 2000;

export function chunkWechatText(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }
  if (trimmed.length <= WECHAT_TEXT_MAX) {
    return [trimmed];
  }
  const chunks: string[] = [];
  let rest = trimmed;
  while (rest.length > 0) {
    chunks.push(rest.slice(0, WECHAT_TEXT_MAX));
    rest = rest.slice(WECHAT_TEXT_MAX);
  }
  return chunks;
}
