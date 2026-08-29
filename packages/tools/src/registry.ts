import type { Context, Disposer } from "@flintloom/kernel";
import type { ToolDefinition, ToolExec } from "./types.ts";
import { TOOLS_PRE_EXECUTE } from "./types.ts";
import { resolveInside } from "./workspace.ts";

export class ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition>();

  constructor(private readonly ctx: Context) {}

  register(def: ToolDefinition): Disposer {
    this.#tools.set(def.name, def);
    return () => {
      this.#tools.delete(def.name);
    };
  }

  schemas(): {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }[] {
    return [...this.#tools.values()].map((def) => ({
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    }));
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    exec: ToolExec,
  ): Promise<string> {
    const def = this.#tools.get(name);
    if (def === undefined) {
      throw new Error(`Tool not registered: ${name}`);
    }

    if (typeof args.path === "string") {
      resolveInside(exec.workspaceRoot, args.path);
    }

    return this.ctx.waterfall(
      TOOLS_PRE_EXECUTE,
      {
        tool: name,
        args,
        workspaceRoot: exec.workspaceRoot,
        channel: exec.channel,
        signal: exec.signal,
        guardBypass: exec.guardBypass,
        webSearch: exec.webSearch,
      },
      () => def.execute(args, exec),
    );
  }
}
