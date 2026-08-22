import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ModelRegistry } from "@flintloom/models";
import { createOpenAiCompatGuard } from "./classify.ts";

export { createOpenAiCompatGuard };

const plugin: FlintPlugin = {
  name: "@flintloom/models-guard",
  apply(ctx: Context, config: Record<string, unknown>) {
    const apiKey = config.apiKey;
    if (typeof apiKey !== "string" || apiKey === "") {
      return;
    }
    const baseUrl =
      typeof config.baseUrl === "string"
        ? config.baseUrl
        : "https://api.deepseek.com/v1";
    const model =
      typeof config.model === "string" ? config.model : "deepseek-chat";
    const models = ctx.require<ModelRegistry>("models");
    const guard = createOpenAiCompatGuard({ baseUrl, apiKey, model });
    ctx.effect(models.registerGuard("default", guard));
    models.setDefault("guard", "default");
  },
};

export default plugin;
