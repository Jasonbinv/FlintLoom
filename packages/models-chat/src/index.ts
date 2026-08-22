import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ModelRegistry } from "@flintloom/models";
import { createOpenAiCompatChat } from "./openai-compat.ts";

export { createOpenAiCompatChat };

const plugin: FlintPlugin = {
  name: "@flintloom/models-chat",
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
    const omniModel =
      typeof config.omniModel === "string" ? config.omniModel : model;
    const models = ctx.require<ModelRegistry>("models");
    const chat = createOpenAiCompatChat({ baseUrl, apiKey, model });
    ctx.effect(models.registerChat("default", chat));
    models.setDefault("chat", "default");
    ctx.effect(models.registerOmni("default", createOpenAiCompatChat({ baseUrl, apiKey, model: omniModel })));
    models.setDefault("omni", "default");
  },
};

export default plugin;
