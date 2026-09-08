export function encodeFrame(payload: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
}

export function createFrameReader(
  onMessage: (msg: Record<string, unknown>) => void,
): { push(chunk: Buffer): void } {
  let buffer = Buffer.alloc(0);

  const push = (chunk: Buffer): void => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const index = buffer.indexOf(0x0a);
      if (index === -1) {
        return;
      }
      const line = buffer.subarray(0, index).toString("utf8").replace(/\r$/, "");
      buffer = buffer.subarray(index + 1);
      if (line.length === 0) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as unknown;
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          onMessage(parsed as Record<string, unknown>);
        }
      } catch {
        // skip non-JSON lines (logs accidentally on stdout, stray headers)
      }
    }
  };

  return { push };
}
