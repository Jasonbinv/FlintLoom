import type { ChatChunk, ChatProvider, ChatRequest } from "@flintloom/models";

export interface OpenAiCompatChatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface ToolCallAccumulator {
  id?: string;
  name?: string;
  arguments: string;
}

function mapMessages(req: ChatRequest): Record<string, unknown>[] {
  return req.messages.map((msg) => {
    const out: Record<string, unknown> = {
      role: msg.role,
      content: msg.content,
    };
    if (msg.toolCallId !== undefined) {
      out.tool_call_id = msg.toolCallId;
    }
    return out;
  });
}

function mapTools(req: ChatRequest) {
  return req.tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function redactApiKey(text: string, apiKey: string): string {
  if (apiKey === "") {
    return text;
  }
  return text.split(apiKey).join("[REDACTED]");
}

function parseToolArgs(raw: string): unknown {
  if (raw === "") {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function assembledToolCalls(
  toolCalls: Map<number, ToolCallAccumulator>,
): ChatChunk[] {
  const chunks: ChatChunk[] = [];
  for (const call of toolCalls.values()) {
    if (call.id !== undefined && call.name !== undefined) {
      chunks.push({
        type: "tool_call",
        id: call.id,
        name: call.name,
        args: parseToolArgs(call.arguments),
      });
    }
  }
  return chunks;
}

function accumulateToolCalls(
  toolCalls: Map<number, ToolCallAccumulator>,
  deltaToolCalls: unknown[],
): void {
  for (const tc of deltaToolCalls) {
    if (typeof tc !== "object" || tc === null) {
      continue;
    }
    const chunk = tc as {
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    };
    const index = chunk.index ?? 0;
    let acc = toolCalls.get(index);
    if (acc === undefined) {
      acc = { arguments: "" };
      toolCalls.set(index, acc);
    }
    if (chunk.id !== undefined) {
      acc.id = chunk.id;
    }
    if (chunk.function?.name !== undefined) {
      acc.name = chunk.function.name;
    }
    if (chunk.function?.arguments !== undefined) {
      acc.arguments += chunk.function.arguments;
    }
  }
}

function handleSseLine(
  line: string,
  toolCalls: Map<number, ToolCallAccumulator>,
): { done: boolean; chunks: ChatChunk[] } {
  if (!line.startsWith("data: ")) {
    return { done: false, chunks: [] };
  }

  const payload = line.slice(6).trim();
  if (payload === "[DONE]") {
    return { done: true, chunks: assembledToolCalls(toolCalls) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { done: false, chunks: [] };
  }

  const delta = (parsed as { choices?: { delta?: unknown }[] })?.choices?.[0]
    ?.delta;
  if (typeof delta !== "object" || delta === null) {
    return { done: false, chunks: [] };
  }

  const chunks: ChatChunk[] = [];
  const content = (delta as { content?: unknown }).content;
  if (typeof content === "string" && content !== "") {
    chunks.push({ type: "text", text: content });
  }

  const deltaToolCalls = (delta as { tool_calls?: unknown[] }).tool_calls;
  if (Array.isArray(deltaToolCalls)) {
    accumulateToolCalls(toolCalls, deltaToolCalls);
  }

  return { done: false, chunks };
}

export function createOpenAiCompatChat(
  opts: OpenAiCompatChatOptions,
): ChatProvider {
  const { baseUrl, apiKey, model } = opts;
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  return {
    async *stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
      const body: Record<string, unknown> = {
        model,
        stream: true,
        messages: mapMessages(req),
      };
      const tools = mapTools(req);
      if (tools.length > 0) {
        body.tools = tools;
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        let bodyText = "";
        try {
          bodyText = await response.text();
        } catch {
          bodyText = "";
        }
        const excerpt = bodyText.slice(0, 500);
        yield {
          type: "error",
          message: redactApiKey(`HTTP ${response.status}: ${excerpt}`, apiKey),
        };
        return;
      }

      if (response.body === null) {
        yield { type: "error", message: "HTTP 200: empty response body" };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const toolCalls = new Map<number, ToolCallAccumulator>();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trimEnd();
          buffer = buffer.slice(newlineIndex + 1);

          const result = handleSseLine(line, toolCalls);
          for (const chunk of result.chunks) {
            yield chunk;
          }
          if (result.done) {
            return;
          }

          newlineIndex = buffer.indexOf("\n");
        }
      }

      yield* assembledToolCalls(toolCalls);
    },
  };
}
