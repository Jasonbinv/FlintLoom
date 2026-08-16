export const MODEL_KINDS = [
  "chat",
  "omni",
  "asr",
  "tts",
  "t2i",
  "t2v",
  "embedding",
  "rerank",
  "guard",
] as const;

export type ModelKind = (typeof MODEL_KINDS)[number];
