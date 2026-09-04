import { parseConfigArgv } from "./config.ts";

export type CliTurnCommand = {
  kind: "turn";
  workspace: string;
  text: string;
};

export type CliPluginAddCommand = {
  kind: "plugin-add";
  workspace: string;
  sourcePath: string;
  id?: string;
};

export type CliAcpCommand = {
  kind: "acp";
  workspace: string;
};

export type CliConfigCommand = import("./config.ts").CliConfigCommand;

export type CliCommand =
  | CliTurnCommand
  | CliPluginAddCommand
  | CliAcpCommand
  | CliConfigCommand;

export function parseCliArgv(argv: string[], cwd: string): CliCommand {
  let workspace = cwd;
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

  if (rest[0] === "acp") {
    return { kind: "acp", workspace };
  }

  if (rest[0] === "config") {
    return parseConfigArgv(rest, workspace);
  }

  if (rest[0] === "plugin") {
    if (rest[1] !== "add") {
      throw new Error("plugin add");
    }
    let id: string | undefined;
    let sourcePath: string | undefined;
    for (let i = 2; i < rest.length; i++) {
      const arg = rest[i]!;
      if (arg === "--id") {
        const next = rest[i + 1];
        if (next === undefined) {
          throw new Error("id");
        }
        if (id !== undefined) {
          throw new Error("id");
        }
        id = next;
        i += 1;
        continue;
      }
      if (sourcePath !== undefined) {
        throw new Error("path");
      }
      sourcePath = arg;
    }
    if (sourcePath === undefined) {
      throw new Error("path");
    }
    const command: CliPluginAddCommand = {
      kind: "plugin-add",
      workspace,
      sourcePath,
    };
    if (id !== undefined) {
      command.id = id;
    }
    return command;
  }

  return { kind: "turn", workspace, text: rest.join(" ") };
}
