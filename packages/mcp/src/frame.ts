export function encodeFrame(payload: unknown): Buffer {
  const body = JSON.stringify(payload);
  const header = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n`;
  return Buffer.from(header + body, "utf8");
}

export function createFrameReader(
  onMessage: (msg: Record<string, unknown>) => void,
): { push(chunk: Buffer): void } {
  let buffer = Buffer.alloc(0);

  const push = (chunk: Buffer): void => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }
      const headerText = buffer.subarray(0, headerEnd).toString("utf8");
      const match = /^Content-Length:\s*(\d+)/i.exec(headerText);
      if (match === null) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (buffer.length < start + length) {
        return;
      }
      const body = buffer.subarray(start, start + length).toString("utf8");
      buffer = buffer.subarray(start + length);
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        onMessage(parsed);
      } catch {
        // skip bad json
      }
    }
  };

  return { push };
}
