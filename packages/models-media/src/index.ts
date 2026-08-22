import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ModelRegistry } from "@flintloom/models";
import {
  createDashscopeAsr,
  createDashscopeT2i,
  createDashscopeT2v,
  createDashscopeTts,
  dashscopeOrigin,
} from "./dashscope.ts";
import { createOpenAiCompatEmbedding } from "./embeddings.ts";
import { createDashscopeRerank } from "./rerank.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/models-media",
  apply(ctx: Context, config: Record<string, unknown>) {
    const apiKey = config.apiKey;
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      return;
    }
    const baseUrl =
      typeof config.baseUrl === "string"
        ? config.baseUrl
        : "https://dashscope.aliyuncs.com/compatible-mode/v1";
    const origin = dashscopeOrigin(baseUrl);
    const models = ctx.require<ModelRegistry>("models");
    const mediaOpts = { origin, apiKey };

    const t2iModel =
      typeof config.t2iModel === "string" ? config.t2iModel : "qwen-image-2.0-pro";
    const ttsModel =
      typeof config.ttsModel === "string" ? config.ttsModel : "qwen3-tts-flash";
    const asrModel =
      typeof config.asrModel === "string" ? config.asrModel : "paraformer-v2";
    const t2vModel =
      typeof config.t2vModel === "string" ? config.t2vModel : "wan2.1-t2v-turbo";
    const embeddingModel =
      typeof config.embeddingModel === "string"
        ? config.embeddingModel
        : "text-embedding-v3";
    const rerankModel =
      typeof config.rerankModel === "string" ? config.rerankModel : "gte-rerank-v2";

    ctx.effect(
      models.registerT2i("default", createDashscopeT2i({ ...mediaOpts, model: t2iModel })),
    );
    models.setDefault("t2i", "default");

    ctx.effect(
      models.registerTts(
        "default",
        createDashscopeTts({
          ...mediaOpts,
          model: ttsModel,
          voice: typeof config.ttsVoice === "string" ? config.ttsVoice : undefined,
        }),
      ),
    );
    models.setDefault("tts", "default");

    ctx.effect(
      models.registerAsr("default", createDashscopeAsr({ ...mediaOpts, model: asrModel })),
    );
    models.setDefault("asr", "default");

    ctx.effect(
      models.registerT2v("default", createDashscopeT2v({ ...mediaOpts, model: t2vModel })),
    );
    models.setDefault("t2v", "default");

    ctx.effect(
      models.registerEmbedding(
        "default",
        createOpenAiCompatEmbedding({
          baseUrl,
          apiKey,
          model: embeddingModel,
        }),
      ),
    );
    models.setDefault("embedding", "default");

    ctx.effect(
      models.registerRerank(
        "default",
        createDashscopeRerank({ ...mediaOpts, model: rerankModel }),
      ),
    );
    models.setDefault("rerank", "default");
  },
};

export {
  createDashscopeAsr,
  createDashscopeT2i,
  createDashscopeT2v,
  createDashscopeTts,
  dashscopeOrigin,
  dashscopeJson,
} from "./dashscope.ts";
export { createOpenAiCompatEmbedding } from "./embeddings.ts";
export { createDashscopeRerank } from "./rerank.ts";
export default plugin;
