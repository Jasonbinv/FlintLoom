import { describe, expect, it } from "vitest";
import { parseTurnBody } from "../src/turn-body.ts";

describe("parseTurnBody", () => {
  it("accepts text-only turns", () => {
    expect(
      parseTurnBody(JSON.stringify({ sessionId: "s1", text: "hi" })),
    ).toEqual({ sessionId: "s1", text: "hi" });
  });

  it("accepts images without text", () => {
    expect(
      parseTurnBody(
        JSON.stringify({
          sessionId: "s1",
          text: "",
          images: [{ mime: "image/png", data: "YWJj" }],
        }),
      ),
    ).toEqual({
      sessionId: "s1",
      text: "",
      images: [{ mime: "image/png", data: "YWJj" }],
    });
  });

  it("rejects invalid images", () => {
    expect(
      parseTurnBody(
        JSON.stringify({
          sessionId: "s1",
          text: "hi",
          images: [{ mime: "text/plain", data: "abc" }],
        }),
      ),
    ).toBeUndefined();
  });

  it("rejects empty body", () => {
    expect(parseTurnBody(JSON.stringify({ sessionId: "s1", text: "  " }))).toBeUndefined();
  });

  it("accepts webSearch true", () => {
    expect(
      parseTurnBody(JSON.stringify({ sessionId: "s1", text: "hi", webSearch: true })),
    ).toEqual({ sessionId: "s1", text: "hi", webSearch: true });
  });

  it("rejects non-boolean webSearch", () => {
    expect(
      parseTurnBody(JSON.stringify({ sessionId: "s1", text: "hi", webSearch: "yes" })),
    ).toBeUndefined();
  });
});
