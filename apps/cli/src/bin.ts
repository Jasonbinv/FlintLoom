import { homedir } from "node:os";
import { createRuntime } from "@flintloom/host";
import { runTurn } from "@flintloom/loop";
import { Session } from "@flintloom/session";
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
const { models, tools } = createRuntime(workspace, homedir());
const session = new Session("cli");
const { status } = await runTurn({
  session,
  text,
  models,
  tools,
  workspaceRoot: workspace,
  channel: "cli",
  signal: new AbortController().signal,
});

const output = formatCliOutput(session.events(), status);
if (output.stdout !== "") {
  process.stdout.write(output.stdout);
}
if (output.stderr !== "") {
  process.stderr.write(output.stderr);
}

process.exit(status === "ok" ? 0 : 1);
