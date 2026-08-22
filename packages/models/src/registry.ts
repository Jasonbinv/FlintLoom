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

export interface AsrInput {
  audio: Uint8Array;
  mimeType?: string;
}

export interface AsrProvider {
  transcribe(input: AsrInput, signal: AbortSignal): Promise<string>;
}

export interface TtsInput {
  text: string;
}

export interface MediaBytes {
  bytes: Uint8Array;
  mimeType: string;
}

export interface TtsProvider {
  synthesize(input: TtsInput, signal: AbortSignal): Promise<MediaBytes>;
}

export interface T2iInput {
  prompt: string;
  size?: string;
}

export interface T2iProvider {
  generate(input: T2iInput, signal: AbortSignal): Promise<MediaBytes>;
}

export interface T2vInput {
  prompt: string;
}

export interface T2vProvider {
  generate(input: T2vInput, signal: AbortSignal): Promise<MediaBytes>;
}

export type OmniProvider = ChatProvider;

export class ModelRegistry {
  readonly #providers = new Map<ModelKind, Map<string, unknown>>();
  readonly #defaults = new Map<ModelKind, string>();

  registerChat(id: string, provider: ChatProvider): Disposer {
    return this.#register("chat", id, provider);
  }

  registerGuard(id: string, provider: GuardProvider): Disposer {
    return this.#register("guard", id, provider);
  }

  registerAsr(id: string, provider: AsrProvider): Disposer {
    return this.#register("asr", id, provider);
  }

  registerTts(id: string, provider: TtsProvider): Disposer {
    return this.#register("tts", id, provider);
  }

  registerT2i(id: string, provider: T2iProvider): Disposer {
    return this.#register("t2i", id, provider);
  }

  registerT2v(id: string, provider: T2vProvider): Disposer {
    return this.#register("t2v", id, provider);
  }

  registerOmni(id: string, provider: OmniProvider): Disposer {
    return this.#register("omni", id, provider);
  }

  setDefault(kind: ModelKind, id: string): void {
    this.#defaults.set(kind, id);
  }

  resolveChat(): ChatProvider {
    return this.#resolve("chat");
  }

  resolveGuard(): GuardProvider | undefined {
    const defaultId = this.#defaults.get("guard");
    if (defaultId === undefined) {
      return undefined;
    }
    return this.#providers.get("guard")?.get(defaultId) as GuardProvider | undefined;
  }

  resolveAsr(): AsrProvider {
    return this.#resolve("asr");
  }

  resolveTts(): TtsProvider {
    return this.#resolve("tts");
  }

  resolveT2i(): T2iProvider {
    return this.#resolve("t2i");
  }

  resolveT2v(): T2vProvider {
    return this.#resolve("t2v");
  }

  resolveOmni(): OmniProvider {
    return this.#resolve("omni");
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

  #resolve<T>(kind: ModelKind): T {
    const defaultId = this.#defaults.get(kind);
    if (defaultId === undefined) {
      throw new ModelKindMissingError(kind);
    }
    const provider = this.#providers.get(kind)?.get(defaultId);
    if (provider === undefined) {
      throw new ModelKindMissingError(kind);
    }
    return provider as T;
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
