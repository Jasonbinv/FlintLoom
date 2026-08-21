import { homedir } from "node:os";
import { createRuntime } from "@flintloom/host";
import type { LoopService } from "@flintloom/loop";
import type { SessionStore } from "@flintloom/session";
import { formatCliOutput } from "./output.ts";

function parseArgv(argv: string[]): { workspace: string; text: string } {
  let workspace = process.cwd();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--workspace") {
      const next = argv[i + 1];
      if (next !== undefined) {
        workspace = next;
        i += 1;
      }
      continue;
    }
    rest.push(arg);
  }
  return { workspace, text: rest.join(" ") };
}

const { workspace, text } = parseArgv(process.argv.slice(2));
const { ctx, stop } = await createRuntime(workspace, homedir());
const session = ctx.require<SessionStore>("sessions").getOrCreate("cli");
const { status } = await ctx.require<LoopService>("loop").runTurn({
  ctx,
  session,
  text,
  workspaceRoot: workspace,
  channel: "cli",
  signal: new AbortController().signal,
});

const output = formatCliOutput(session.events(), status);
stop();
if (output.stdout !== "") {
  process.stdout.write(output.stdout);
}
if (output.stderr !== "") {
  process.stderr.write(output.stderr);
}

process.exit(status === "ok" ? 0 : 1);
