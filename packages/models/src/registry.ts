import type { Disposer } from "@flintloom/kernel";
import type { ChatMessage } from "@flintloom/session";
import { ModelKindMissingError } from "./errors.ts";
import { MODEL_KINDS, type ModelKind } from "./kinds.ts";

export interface ChatChunkText {
  type: "text";
  text: string;
}
export interface ChatChunkToolCall {
  type: "tool_call";
  id: string;
  name: string;
  args: unknown;
}
export interface ChatChunkError {
  type: "error";
  message: string;
}
export type ChatChunk = ChatChunkText | ChatChunkToolCall | ChatChunkError;

export interface ChatRequest {
  messages: ChatMessage[];
  tools: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }[];
}

export interface ChatProvider {
  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk>;
}

export type GuardDecision = "allow" | "deny" | "ask";
export interface GuardGateInput {
  tool: string;
  args: unknown;
  workspaceRoot: string;
  channel: string;
}
export interface GuardProvider {
  gate(input: GuardGateInput, signal: AbortSignal): Promise<GuardDecision>;
}

export class ModelRegistry {
  readonly #providers = new Map<ModelKind, Map<string, unknown>>();
  readonly #defaults = new Map<ModelKind, string>();

  registerChat(id: string, provider: ChatProvider): Disposer {
    return this.#register("chat", id, provider);
  }

  registerGuard(id: string, provider: GuardProvider): Disposer {
    return this.#register("guard", id, provider);
  }

  setDefault(kind: ModelKind, id: string): void {
    this.#defaults.set(kind, id);
  }

  resolveChat(): ChatProvider {
    const defaultId = this.#defaults.get("chat");
    if (defaultId === undefined) {
      throw new ModelKindMissingError("chat");
    }
    const provider = this.#providers.get("chat")?.get(defaultId);
    if (provider === undefined) {
      throw new ModelKindMissingError("chat");
    }
    return provider as ChatProvider;
  }

  resolveGuard(): GuardProvider | undefined {
    const defaultId = this.#defaults.get("guard");
    if (defaultId === undefined) {
      return undefined;
    }
    return this.#providers.get("guard")?.get(defaultId) as
      | GuardProvider
      | undefined;
  }

  snapshot(): {
    kind: ModelKind;
    defaultId: string | null;
    configured: boolean;
  }[] {
    return MODEL_KINDS.map((kind) => {
      const defaultId = this.#defaults.get(kind) ?? null;
      return {
        kind,
        defaultId,
        configured: defaultId !== null,
      };
    });
  }

  #register(kind: ModelKind, id: string, provider: unknown): Disposer {
    let bucket = this.#providers.get(kind);
    if (bucket === undefined) {
      bucket = new Map();
      this.#providers.set(kind, bucket);
    }
    bucket.set(id, provider);
    return () => {
      bucket!.delete(id);
    };
  }
}
