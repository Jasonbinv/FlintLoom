import type { ModelKind } from "./kinds.ts";

export class ModelKindMissingError extends Error {
  constructor(readonly kind: ModelKind) {
    super(`未配置 ${kind}`);
    this.name = "ModelKindMissingError";
  }
}
