import type { FlintloomConfig } from "./config.ts";
import type { Context, Disposer, FlintPlugin } from "./context.ts";
import { defaultImport } from "./plugin-entry.ts";
import { needsWorkspaceRootOverlay } from "./plugin-overlay.ts";

export type ImportFn = (name: string) => Promise<unknown>;

function isApplyFn(value: unknown): value is FlintPlugin["apply"] {
  return typeof value === "function";
}

export function unwrapPlugin(mod: unknown, name: string): FlintPlugin {
  if (mod !== null && typeof mod === "object") {
    const rec = mod as Record<string, unknown>;
    const def = rec.default;
    if (def !== null && typeof def === "object") {
      const apply = (def as { apply?: unknown }).apply;
      const pluginName = (def as { name?: unknown }).name;
      if (isApplyFn(apply)) {
        return {
          name: typeof pluginName === "string" ? pluginName : name,
          apply,
        };
      }
    }
    if (isApplyFn((mod as { apply?: unknown }).apply)) {
      return mod as FlintPlugin;
    }
  }
  throw new Error(name);
}

export async function applyConfig(
  ctx: Context,
  config: FlintloomConfig,
  opts?: {
    importFn?: ImportFn;
    runtimeConfigById?: Record<string, Record<string, unknown>>;
    workspaceRoot?: string;
  },
): Promise<Disposer> {
  const importFn = opts?.importFn ?? defaultImport;
  const runtime = opts?.runtimeConfigById ?? {};
  const seen = new Set<string>();
  const stops: Disposer[] = [];

  const rollback = (): void => {
    for (const stop of stops.reverse()) stop();
  };

  try {
    for (const row of config.plugins) {
      if (seen.has(row.id)) {
        throw new Error("id");
      }
      seen.add(row.id);
      if (row.enabled === false) {
        continue;
      }
      const mod = await importFn(row.name);
      const plugin = unwrapPlugin(mod, row.name);
      const overlayRuntime = { ...(runtime[row.id] ?? {}) };
      if (
        opts?.workspaceRoot !== undefined &&
        needsWorkspaceRootOverlay(row.name)
      ) {
        overlayRuntime.workspaceRoot = opts.workspaceRoot;
      }
      const merged = {
        ...(row.config ?? {}),
        ...overlayRuntime,
        id: row.id,
      };
      stops.push(await ctx.plugin(plugin, merged));
    }
  } catch (err) {
    rollback();
    throw err;
  }

  return () => {
    rollback();
  };
}
