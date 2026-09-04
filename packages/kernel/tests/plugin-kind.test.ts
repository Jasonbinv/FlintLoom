import { describe, expect, it } from "vitest";
import { isPluginToggleable, pluginKind } from "../src/index.ts";

describe("pluginKind", () => {
  it("classifies core channel search mcp optional", () => {
    expect(pluginKind({ id: "loop", name: "@flintloom/loop" })).toBe("core");
    expect(pluginKind({ id: "fs", name: "@flintloom/fs" })).toBe("core");
    expect(pluginKind({ id: "channel-telegram", name: "@flintloom/channel-telegram" })).toBe("channel");
    expect(pluginKind({ id: "web-search", name: "@flintloom/web-search" })).toBe("search");
    expect(pluginKind({ id: "fake", name: "@flintloom/mcp" })).toBe("mcp");
    expect(pluginKind({ id: "weather", name: "@flintloom/weather" })).toBe("optional");
    expect(pluginKind({ id: "my-plugin", name: "C:/plugins/x" })).toBe("optional");
    expect(isPluginToggleable({ id: "weather", name: "@flintloom/weather" })).toBe(true);
    expect(isPluginToggleable({ id: "loop", name: "@flintloom/loop" })).toBe(false);
    expect(isPluginToggleable({ id: "web-search", name: "@flintloom/web-search" })).toBe(false);
  });
});
