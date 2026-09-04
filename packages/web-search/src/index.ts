import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ToolRegistry } from "@flintloom/tools";
import { createWebSearchTool } from "./tool.ts";
import type { SearchConfig, SearchProviderId } from "./types.ts";

function asConfig(raw: Record<string, unknown>): SearchConfig {
  const provider = raw.provider;
  const ids = new Set(["searxng", "tavily", "brave", "bocha"]);
  return {
    provider: typeof provider === "string" && ids.has(provider) ? (provider as SearchProviderId) : undefined,
    searxngUrl: typeof raw.searxngUrl === "string" ? raw.searxngUrl : undefined,
    tavilyApiKey: typeof raw.tavilyApiKey === "string" ? raw.tavilyApiKey : undefined,
    braveApiKey: typeof raw.braveApiKey === "string" ? raw.braveApiKey : undefined,
    bochaApiKey: typeof raw.bochaApiKey === "string" ? raw.bochaApiKey : undefined,
  };
}

const plugin: FlintPlugin = {
  name: "@flintloom/web-search",
  apply(ctx: Context, config: Record<string, unknown>) {
    const tools = ctx.require<ToolRegistry>("tools");
    ctx.effect(tools.register(createWebSearchTool(asConfig(config))));
  },
};

export { createWebSearchTool } from "./tool.ts";
export { searchWeb, resolveSearchProvider } from "./search.ts";
export { formatSearchHits } from "./format.ts";
export default plugin;
