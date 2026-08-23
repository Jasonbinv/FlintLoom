const PREFIX = "wechat:";

export function wechatSessionId(from: string, room?: string): string {
  const key = room && room.length > 0 ? room : from;
  return `${PREFIX}${key}`;
}

export function isAllowedSender(
  from: string,
  room: string | undefined,
  allowed: Set<string> | undefined,
): boolean {
  if (allowed === undefined || allowed.size === 0) {
    return true;
  }
  if (allowed.has("*")) {
    return true;
  }
  if (room !== undefined && room.length > 0 && allowed.has(room)) {
    return true;
  }
  return allowed.has(from);
}
