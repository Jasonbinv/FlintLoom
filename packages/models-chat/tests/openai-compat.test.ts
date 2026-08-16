import http from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import type { ChatChunk } from "@flintloom/models";
import { createOpenAiCompatChat } from "../src/index.ts";

async function collectChunks(
  stream: AsyncIterable<ChatChunk>,
): Promise<ChatChunk[]> {
  const chunks: ChatChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

function listen(
  server: http.Server,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("expected ephemeral TCP address"));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((err) => (err ? closeReject(err) : closeResolve()));
          }),
      });
    });
    server.on("error", reject);
  });
}

describe("createOpenAiCompatChat", () => {
  let sseServer: http.Server | undefined;
  let errorServer: http.Server | undefined;
  let sseClose: (() => Promise<void>) | undefined;
  let errorClose: (() => Promise<void>) | undefined;

  afterAll(async () => {
    await Promise.all([sseClose?.(), errorClose?.()]);
  });

  it("streams text from SSE delta.content", async () => {
    sseServer = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}\n\n`,
      );
      res.write("data: [DONE]\n\n");
      res.end();
    });

    const { baseUrl, close } = await listen(sseServer);
    sseClose = close;

    const provider = createOpenAiCompatChat({
      baseUrl,
      apiKey: "test-key",
      model: "test-model",
    });

    const chunks = await collectChunks(
      provider.stream(
        { messages: [{ role: "user", content: "hello" }], tools: [] },
        new AbortController().signal,
      ),
    );

    expect(chunks).toEqual([{ type: "text", text: "hi" }]);
  });

  it("yields error chunk on 401 without leaking apiKey", async () => {
    const apiKey = "secret-api-key-xyz";

    errorServer = http.createServer((_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Invalid key: ${apiKey}` }));
    });

    const { baseUrl, close } = await listen(errorServer);
    errorClose = close;

    const provider = createOpenAiCompatChat({
      baseUrl,
      apiKey,
      model: "test-model",
    });

    const chunks = await collectChunks(
      provider.stream(
        { messages: [{ role: "user", content: "hello" }], tools: [] },
        new AbortController().signal,
      ),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ type: "error" });
    const message = (chunks[0] as { type: "error"; message: string }).message;
    expect(message).toContain("401");
    expect(message).not.toContain(apiKey);
  });

  it("second-step POST includes assistant tool_calls before role tool", async () => {
    let capturedBody = "";
    const toolServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      req.on("end", () => {
        capturedBody = Buffer.concat(chunks).toString("utf8");
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`,
        );
        res.write("data: [DONE]\n\n");
        res.end();
      });
    });

    const { baseUrl, close } = await listen(toolServer);
    try {
      const provider = createOpenAiCompatChat({
        baseUrl,
        apiKey: "test-key",
        model: "test-model",
      });

      await collectChunks(
        provider.stream(
          {
            messages: [
              { role: "user", content: "read it" },
              {
                role: "assistant",
                content: "",
                toolCalls: [
                  {
                    id: "call-a",
                    name: "fs",
                    args: { action: "read", path: "a.txt" },
                  },
                ],
              },
              {
                role: "tool",
                content: "file-a",
                toolCallId: "call-a",
                name: "fs",
              },
            ],
            tools: [],
          },
          new AbortController().signal,
        ),
      );

      const parsed = JSON.parse(capturedBody) as {
        messages: Record<string, unknown>[];
      };
      expect(parsed.messages).toEqual([
        { role: "user", content: "read it" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              type: "function",
              id: "call-a",
              function: {
                name: "fs",
                arguments: JSON.stringify({ action: "read", path: "a.txt" }),
              },
            },
          ],
        },
        { role: "tool", content: "file-a", tool_call_id: "call-a" },
      ]);
    } finally {
      await close();
    }
  });
});
