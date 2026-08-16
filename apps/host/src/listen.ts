import { homedir } from "node:os";
import { startHost } from "./index.ts";

const { url } = await startHost({
  workspaceRoot: process.cwd(),
  homeDir: homedir(),
});

console.log(`FlintLoom listening ${url}`);
