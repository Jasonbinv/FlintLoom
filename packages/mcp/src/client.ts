import { spawn, type ChildProcess } from "node:child_process";
import { encodeFrame, createFrameReader } from "./frame.ts";

export const MCP_INIT_TIMEOUT_MS = 8_000;
export const MCP_CALL_TIMEOUT_MS = 30_000;
export const MCP_RESULT_MAX_CHARS = 200_000;

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(label));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

function formatToolResult(result: unknown): string {
  if (result === null || typeof result !== "object") {
    return "";
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return "";
  }
  let text = "";
  for (const item of content) {
    if (
      item !== null &&
      typeof item === "object" &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string"
    ) {
      text += (item as { text: string }).text;
    }
  }
  if (text.length > MCP_RESULT_MAX_CHARS) {
    return text.slice(0, MCP_RESULT_MAX_CHARS) + "\n\n[truncated]";
  }
  return text;
}

export class McpStdioClient {
  readonly #child: ChildProcess;
  readonly #pending = new Map<number, PendingRequest>();
  #nextId = 1;
  #tools: McpTool[] = [];
  #killed = false;

  constructor(opts: {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
  }) {
    this.#child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const reader = createFrameReader((msg) => {
      const id = msg.id;
      if (typeof id !== "number") {
        return;
      }
      const pending = this.#pending.get(id);
      if (pending === undefined) {
        return;
      }
      this.#pending.delete(id);
      if (msg.error !== undefined && msg.error !== null) {
        pending.reject(new Error("mcp rpc error"));
        return;
      }
      pending.resolve(msg.result);
    });

    this.#child.stdout?.on("data", (chunk: Buffer) => {
      reader.push(chunk);
    });

    this.#child.stderr?.on("data", () => {
      // discard stderr
    });

    this.#child.on("error", (err) => {
      for (const [, pending] of this.#pending) {
        pending.reject(err instanceof Error ? err : new Error(String(err)));
      }
      this.#pending.clear();
    });

    this.#child.on("close", () => {
      for (const [, pending] of this.#pending) {
        pending.reject(new Error("mcp process exited"));
      }
      this.#pending.clear();
    });
  }

  listTools(): McpTool[] {
    return [...this.#tools];
  }

  async initialize(): Promise<void> {
    await withTimeout(
      this.#request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "flintloom", version: "0" },
      }),
      MCP_INIT_TIMEOUT_MS,
      "mcp initialize timeout",
    );
    this.#notify("notifications/initialized", {});
    const listResult = await withTimeout(
      this.#request("tools/list", {}),
      MCP_INIT_TIMEOUT_MS,
      "mcp tools/list timeout",
    );
    const tools = (listResult as { tools?: McpTool[] } | null)?.tools;
    this.#tools = Array.isArray(tools) ? tools : [];
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<string> {
    if (signal.aborted) {
      throw new Error("aborted");
    }

    const abortError = new Error("aborted");
    const onAbort = (): void => {
      // kill in-flight; caller maps to aborted
    };
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      const result = await withTimeout(
        new Promise<unknown>((resolve, reject) => {
          if (signal.aborted) {
            reject(abortError);
            return;
          }
          const onAbortInner = (): void => {
            reject(abortError);
          };
          signal.addEventListener("abort", onAbortInner, { once: true });
          this.#request("tools/call", { name, arguments: args })
            .then(resolve, reject)
            .finally(() => {
              signal.removeEventListener("abort", onAbortInner);
            });
        }),
        MCP_CALL_TIMEOUT_MS,
        "mcp call timeout",
      );
      return formatToolResult(result);
    } catch (err) {
      if (signal.aborted || (err instanceof Error && err.message === "aborted")) {
        throw abortError;
      }
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  kill(): void {
    if (this.#killed) {
      return;
    }
    this.#killed = true;
    for (const [, pending] of this.#pending) {
      pending.reject(new Error("mcp killed"));
    }
    this.#pending.clear();
    this.#child.kill();
  }

  #notify(method: string, params: Record<string, unknown>): void {
    if (this.#child.stdin === null || this.#killed) {
      return;
    }
    const frame = encodeFrame({
      jsonrpc: "2.0",
      method,
      params,
    });
    this.#child.stdin.write(frame);
  }

  #request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.#killed) {
      return Promise.reject(new Error("mcp killed"));
    }
    if (this.#child.stdin === null) {
      return Promise.reject(new Error("mcp stdin missing"));
    }
    const id = this.#nextId;
    this.#nextId += 1;
    const frame = encodeFrame({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });
    return new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#child.stdin!.write(frame, (err) => {
        if (err !== null && err !== undefined) {
          this.#pending.delete(id);
          reject(err);
        }
      });
    });
  }
}
