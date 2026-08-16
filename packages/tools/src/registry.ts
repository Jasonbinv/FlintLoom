import type { Disposer } from "@flintloom/kernel";
import type { ModelRegistry } from "@flintloom/models";
import type { ToolDefinition, ToolExec } from "./types.ts";
import { resolveInside } from "./workspace.ts";

export class ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition>();

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
    models: ModelRegistry,
  ): Promise<string> {
    const def = this.#tools.get(name);
    if (def === undefined) {
      throw new Error(`Tool not registered: ${name}`);
    }

    if (typeof args.path === "string") {
      resolveInside(exec.workspaceRoot, args.path);
    }

    const guard = models.resolveGuard();
    if (guard !== undefined) {
      const decision = await guard.gate(
        {
          tool: name,
          args,
          workspaceRoot: exec.workspaceRoot,
          channel: exec.channel,
        },
        exec.signal,
      );

      if (decision === "deny") {
        return `guard denied: ${name}`;
      }

      if (decision === "ask") {
        return `guard denied: ${name} (ask not supported in slice 1)`;
      }
    }

    return def.execute(args, exec);
  }
}
