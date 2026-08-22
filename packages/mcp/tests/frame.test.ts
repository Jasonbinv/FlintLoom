import { describe, expect, it } from "vitest";
import { createFrameReader, encodeFrame } from "../src/frame.ts";

describe("frame", () => {
  it("encodeFrame uses Content-Length header", () => {
    const buf = encodeFrame({ jsonrpc: "2.0", id: 1, result: {} });
    const text = buf.toString("utf8");
    expect(text.startsWith("Content-Length:")).toBe(true);
    expect(text).toContain("\r\n\r\n");
    expect(text.endsWith('{"jsonrpc":"2.0","id":1,"result":{}}')).toBe(true);
  });

  it("createFrameReader handles multiple frames and partial chunks", () => {
    const seen: Record<string, unknown>[] = [];
    const reader = createFrameReader((msg) => seen.push(msg));
    const a = encodeFrame({ jsonrpc: "2.0", id: 1, result: { a: 1 } });
    const b = encodeFrame({ jsonrpc: "2.0", id: 2, result: { b: 2 } });
    const combined = Buffer.concat([a, b]);
    reader.push(combined.subarray(0, 10));
    reader.push(combined.subarray(10));
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ id: 1 });
    expect(seen[1]).toMatchObject({ id: 2 });
  });
});
