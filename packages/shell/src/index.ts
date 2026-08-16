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

    let output = "";
    let timedOut = false;
    let settled = false;

    const finish = (code: number | null, extraOutput = "") => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ code, output: output + extraOutput, timedOut });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      finish(null, "\n[timed out after 15000ms]");
    }, TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
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

export function createShellTool(): ToolDefinition {
  return {
    name: "shell",
    description: "Run a shell command in the workspace directory.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
      },
      required: ["command"],
    },
    async execute(args, exec) {
      const command = String(args.command);
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
