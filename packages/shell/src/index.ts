import { spawn } from "node:child_process";
import type { Context, FlintPlugin } from "@flintloom/kernel";
import { type ToolDefinition, type ToolRegistry } from "@flintloom/tools";

const OUTPUT_LIMIT = 50_000;
const TIMEOUT_MS = 15_000;

function truncateOutput(output: string): string {
  if (output.length <= OUTPUT_LIMIT) {
    return output;
  }
  return (
    output.slice(0, OUTPUT_LIMIT) +
    `\n\n[truncated: output exceeded ${OUTPUT_LIMIT} characters]`
  );
}

/** Decode shell bytes: prefer UTF-8; on Windows fall back to GBK/GB18030. */
export function decodeShellOutput(bytes: Buffer): string {
  if (bytes.length === 0) {
    return "";
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    if (process.platform === "win32") {
      try {
        return new TextDecoder("gbk").decode(bytes);
      } catch {
        try {
          return new TextDecoder("gb18030").decode(bytes);
        } catch {
          return bytes.toString("utf8");
        }
      }
    }
    return bytes.toString("utf8");
  }
}

function runCommand(
  command: string,
  cwd: string,
  signal: AbortSignal,
): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ code: null, output: "aborted", timedOut: false });
      return;
    }

    const isWindows = process.platform === "win32";
    const child = isWindows
      ? spawn("cmd.exe", ["/c", command], { cwd, windowsHide: true })
      : spawn("/bin/sh", ["-c", command], { cwd });

    const chunks: Buffer[] = [];
    let timedOut = false;
    let settled = false;

    const finish = (code: number | null, extraOutput = "") => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const output = decodeShellOutput(Buffer.concat(chunks)) + extraOutput;
      resolve({ code, output, timedOut });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      finish(null, "\n[timed out after 15000ms]");
    }, TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    child.on("error", (err) => {
      finish(null, err.message);
    });

    child.on("close", (code) => {
      finish(code);
    });

    signal.addEventListener(
      "abort",
      () => {
        child.kill();
        finish(null, "\n[aborted]");
      },
      { once: true },
    );
  });
}

function blockedAiGenerationShell(command: string): string | undefined {
  const normalized = command.replaceAll("\\", "/");
  if (!/ai_generation/i.test(normalized)) return undefined;
  const lower = normalized.toLowerCase();
  if (/(?:^|[;&|]\s*)(?:mkdir|md)(?:\s|$)/.test(lower) || /\bnew-item\b/.test(lower)) {
    return (
      "Do not create ai_generation folders with shell. Use fs write with a simple filename like ket.md; the session folder is created automatically. Then call doc_generate for docx/pptx."
    );
  }
  if (/[>]/.test(normalized) || /\b(set-content|out-file|add-content)\b/.test(lower)) {
    return (
      "Do not write into ai_generation with shell. Use fs write with a simple filename, then call doc_generate."
    );
  }
  return undefined;
}

export function createShellTool(): ToolDefinition {
  return {
    name: "shell",
    description:
      "Run a shell command in the workspace directory. Do not use mkdir to create ai_generation folders; use fs write, which creates directories.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
      },
      required: ["command"],
    },
    async execute(args, exec) {
      const command = String(args.command);
      const blocked = blockedAiGenerationShell(command);
      if (blocked !== undefined) {
        return blocked;
      }
      const { code, output, timedOut } = await runCommand(
        command,
        exec.workspaceRoot,
        exec.signal,
      );

      const truncated = truncateOutput(output);

      if (timedOut) {
        return truncated;
      }

      if (code !== null && code !== 0) {
        return `exit ${code}\n${truncated}`;
      }

      return truncated;
    },
  };
}

const plugin: FlintPlugin = {
  name: "@flintloom/shell",
  apply(ctx: Context) {
    const tools = ctx.require<ToolRegistry>("tools");
    ctx.effect(tools.register(createShellTool()));
  },
};

export default plugin;
