import { Buffer } from "node:buffer";
import type {
  AsrInput,
  AsrProvider,
  MediaBytes,
  T2iInput,
  T2iProvider,
  T2vInput,
  T2vProvider,
  TtsInput,
  TtsProvider,
} from "@flintloom/models";

export type DashscopeMediaOptions = {
  origin: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
};

const MULTIMODAL_PATH =
  "/api/v1/services/aigc/multimodal-generation/generation";
const ASR_PATH = "/api/v1/services/audio/asr/transcription";

function mediaFetch(opts: DashscopeMediaOptions): typeof fetch {
  return opts.fetchImpl ?? globalThis.fetch;
}

export function dashscopeOrigin(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "https://dashscope.aliyuncs.com";
  }
}

async function dashscopeJson(
  opts: DashscopeMediaOptions,
  path: string,
  body: unknown,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const res = await mediaFetch(opts)(`${opts.origin}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("bad json");
  }
  return parsed as Record<string, unknown>;
}

async function downloadUrl(
  opts: DashscopeMediaOptions,
  url: string,
  signal: AbortSignal,
): Promise<MediaBytes> {
  const res = await mediaFetch(opts)(url, { signal });
  if (!res.ok) {
    throw new Error(`download HTTP ${res.status}`);
  }
  const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
  const buf = await res.arrayBuffer();
  return { bytes: new Uint8Array(buf), mimeType };
}

function firstMediaUrl(output: Record<string, unknown>): string | undefined {
  const choices = output.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    const audio = output.audio;
    if (audio !== null && typeof audio === "object") {
      const url = (audio as { url?: unknown }).url;
      if (typeof url === "string" && url.length > 0) {
        return url;
      }
    }
    return undefined;
  }
  const message = (choices[0] as { message?: unknown })?.message;
  if (message === null || typeof message !== "object") {
    return undefined;
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  for (const block of content) {
    if (block === null || typeof block !== "object") {
      continue;
    }
    const rec = block as Record<string, unknown>;
    if (typeof rec.image === "string" && rec.image.length > 0) {
      return rec.image;
    }
    if (typeof rec.audio === "string" && rec.audio.length > 0) {
      return rec.audio;
    }
    const nested = rec.audio;
    if (nested !== null && typeof nested === "object") {
      const url = (nested as { url?: unknown }).url;
      if (typeof url === "string" && url.length > 0) {
        return url;
      }
    }
  }
  return undefined;
}

export function createDashscopeT2i(
  opts: DashscopeMediaOptions & { model: string },
): T2iProvider {
  return {
    async generate(input: T2iInput, signal: AbortSignal): Promise<MediaBytes> {
      const json = await dashscopeJson(
        opts,
        MULTIMODAL_PATH,
        {
          model: opts.model,
          input: {
            messages: [
              {
                role: "user",
                content: [{ text: input.prompt }],
              },
            ],
          },
          parameters: {
            size: input.size ?? "1024*1024",
          },
        },
        signal,
      );
      const output = json.output;
      if (output === null || typeof output !== "object") {
        throw new Error("no output");
      }
      const url = firstMediaUrl(output as Record<string, unknown>);
      if (url === undefined) {
        throw new Error("no image url");
      }
      return await downloadUrl(opts, url, signal);
    },
  };
}

export function createDashscopeTts(
  opts: DashscopeMediaOptions & { model: string; voice?: string },
): TtsProvider {
  return {
    async synthesize(input: TtsInput, signal: AbortSignal): Promise<MediaBytes> {
      const json = await dashscopeJson(
        opts,
        MULTIMODAL_PATH,
        {
          model: opts.model,
          input: {
            text: input.text,
            voice: opts.voice ?? "Cherry",
            language_type: "Auto",
          },
        },
        signal,
      );
      const output = json.output;
      if (output === null || typeof output !== "object") {
        throw new Error("no output");
      }
      const url = firstMediaUrl(output as Record<string, unknown>);
      if (url === undefined) {
        throw new Error("no audio url");
      }
      const media = await downloadUrl(opts, url, signal);
      return {
        bytes: media.bytes,
        mimeType: media.mimeType.includes("audio") ? media.mimeType : "audio/wav",
      };
    },
  };
}

export function createDashscopeAsr(
  opts: DashscopeMediaOptions & { model: string },
): AsrProvider {
  return {
    async transcribe(input: AsrInput, signal: AbortSignal): Promise<string> {
      const json = await dashscopeJson(
        opts,
        ASR_PATH,
        {
          model: opts.model,
          input: {
            audio: Buffer.from(input.audio).toString("base64"),
            ...(input.mimeType !== undefined ? { mime_type: input.mimeType } : {}),
          },
        },
        signal,
      );
      const output = json.output;
      if (output === null || typeof output !== "object") {
        throw new Error("no output");
      }
      const text = (output as { text?: unknown }).text;
      if (typeof text !== "string") {
        throw new Error("no text");
      }
      return text;
    },
  };
}

export function createDashscopeT2v(
  opts: DashscopeMediaOptions & { model: string },
): T2vProvider {
  return {
    async generate(input: T2vInput, signal: AbortSignal): Promise<MediaBytes> {
      const json = await dashscopeJson(
        opts,
        "/api/v1/services/aigc/video-generation/generation",
        {
          model: opts.model,
          input: {
            prompt: input.prompt,
          },
        },
        signal,
      );
      const output = json.output;
      if (output === null || typeof output !== "object") {
        throw new Error("no output");
      }
      const taskId = (output as { task_id?: unknown }).task_id;
      if (typeof taskId === "string" && taskId.length > 0) {
        throw new Error("t2v async task not supported yet");
      }
      const url = firstMediaUrl(output as Record<string, unknown>);
      if (url === undefined) {
        throw new Error("no video url");
      }
      return await downloadUrl(opts, url, signal);
    },
  };
}
