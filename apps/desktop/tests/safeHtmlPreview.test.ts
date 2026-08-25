import { describe, expect, it } from "vitest";
import { safeHtmlContentPathFromOpenUrl } from "../src/safeHtmlPreview.ts";

describe("safeHtmlContentPathFromOpenUrl", () => {
  it("maps wrapper url to content path", () => {
    const path = safeHtmlContentPathFromOpenUrl(
      "http://127.0.0.1:7331/v1/files/safe-html?t=abc123",
    );
    expect(path).toBe("/v1/files/safe-html/content?t=abc123");
  });
});
