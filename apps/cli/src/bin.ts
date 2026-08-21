import { homedir } from "node:os";
import { createRuntime } from "@flintloom/host";
import { installPluginFromPath } from "@flintloom/kernel";
import { runCli } from "./run.ts";

const code = await runCli(process.argv.slice(2), {
  cwd: () => process.cwd(),
  homedir,
  createRuntime,
  installPluginFromPath,
  stdout: process.stdout,
  stderr: process.stderr,
});
process.exit(code);
