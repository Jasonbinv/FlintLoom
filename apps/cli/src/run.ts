import type { createRuntime } from "@flintloom/host";
import {
  installPluginFromPath,
  type InstallPluginFromPathInput,
} from "@flintloom/kernel";
import type { LoopService } from "@flintloom/loop";
import type { SessionStore } from "@flintloom/session";
import { parseCliArgv } from "./argv.ts";
import { formatCliOutput } from "./output.ts";
import { runAcpStdio } from "@flintloom/channel-acp";

export type CliDeps = {
  cwd: () => string;
  homedir: () => string;
  createRuntime: typeof createRuntime;
  installPluginFromPath: (
    input: InstallPluginFromPathInput,
  ) => ReturnType<typeof installPluginFromPath>;
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
};

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  let command;
  try {
    command = parseCliArgv(argv, deps.cwd());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.stderr.write(message + "\n");
    return 1;
  }

  if (command.kind === "plugin-add") {
    try {
      const input: InstallPluginFromPathInput = {
        workspaceRoot: command.workspace,
        homeDir: deps.homedir(),
        sourcePath: command.sourcePath,
      };
      if (command.id !== undefined) {
        input.id = command.id;
      }
      const { id } = await deps.installPluginFromPath(input);
      deps.stdout.write("added " + id + "\n");
      return 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.stderr.write(message + "\n");
      return 1;
    }
  }

  if (command.kind === "acp") {
    const { ctx, stop } = await deps.createRuntime(command.workspace, deps.homedir());
    try {
      await runAcpStdio(ctx, command.workspace);
      return 0;
    } finally {
      stop();
    }
  }

  const { ctx, stop } = await deps.createRuntime(
    command.workspace,
    deps.homedir(),
  );
  const session = ctx.require<SessionStore>("sessions").getOrCreate("cli");
  const { status } = await ctx.require<LoopService>("loop").runTurn({
    ctx,
    session,
    text: command.text,
    workspaceRoot: command.workspace,
    channel: "cli",
    signal: new AbortController().signal,
  });
  const output = formatCliOutput(session.events(), status);
  stop();
  if (output.stdout !== "") {
    deps.stdout.write(output.stdout);
  }
  if (output.stderr !== "") {
    deps.stderr.write(output.stderr);
  }
  return status === "ok" ? 0 : 1;
}
