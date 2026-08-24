import { describe, expect, it } from "vitest";
import { parseWindowsListeningPids } from "../../../scripts/kill-ports.ts";

describe("parseWindowsListeningPids", () => {
  it("extracts LISTENING pid for the requested port", () => {
    const sample = `
  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       17280
  TCP    127.0.0.1:5173         127.0.0.1:49988        ESTABLISHED     17280
  TCP    127.0.0.1:7331         0.0.0.0:0              LISTENING       17280
  TCP    127.0.0.1:7340         0.0.0.0:0              LISTENING       17140
`.trim();

    expect(parseWindowsListeningPids(sample, 5173)).toEqual([17280]);
    expect(parseWindowsListeningPids(sample, 7331)).toEqual([17280]);
    expect(parseWindowsListeningPids(sample, 7340)).toEqual([17140]);
    expect(parseWindowsListeningPids(sample, 3000)).toEqual([]);
  });
});
