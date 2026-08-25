function tryDecode(bytes: Uint8Array, label: string, fatal = false): string | null {
  try {
    return new TextDecoder(label, { fatal }).decode(bytes);
  } catch {
    return null;
  }
}

export function scoreDecodedCnText(text: string): number {
  let score = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x4e00 && code <= 0x9fff) {
      score += 3;
    } else if (code === 0xfffd) {
      score -= 8;
    } else if (code >= 0xe000 && code <= 0xf8ff) {
      score -= 3;
    } else if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      score -= 2;
    } else if (code >= 0x80 && code < 0x100) {
      score -= 1;
    }
  }
  return score;
}

function stripUtf8Bom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function decodeCnLegacyTextBytes(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return stripUtf8Bom(new TextDecoder("utf-8").decode(bytes));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return stripUtf8Bom(new TextDecoder("utf-16le").decode(bytes));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return stripUtf8Bom(new TextDecoder("utf-16be").decode(bytes));
  }

  const utf8Fatal = tryDecode(bytes, "utf-8", true);
  if (utf8Fatal !== null) {
    return utf8Fatal;
  }

  const legacyChinese = tryDecode(bytes, "gb18030") ?? tryDecode(bytes, "gbk");
  const utf8Lossy = new TextDecoder("utf-8").decode(bytes);
  if (!legacyChinese) {
    return utf8Lossy;
  }
  return scoreDecodedCnText(legacyChinese) >= scoreDecodedCnText(utf8Lossy)
    ? legacyChinese
    : utf8Lossy;
}
