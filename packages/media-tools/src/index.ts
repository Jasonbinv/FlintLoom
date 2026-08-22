import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Context, FlintPlugin } from "@flintloom/kernel";
import { ModelKindMissingError, type ModelRegistry } from "@flintloom/models";
import {
  resolveInside,
  type ToolDefinition,
  type ToolRegistry,
} from "@flintloom/tools";

function extForMime(mimeType: string, fallback: string): string {
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return ".jpg";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("mp4")) return ".mp4";
  if (mimeType.includes("webm")) return ".webm";
  return fallback;
}

export function createImageGenerateTool(models: ModelRegistry): ToolDefinition {
  return {
    name: "image_generate",
    description: "Generate an image from a text prompt into the workspace.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        path: { type: "string" },
        size: { type: "string" },
      },
      required: ["prompt"],
    },
    async execute(args, exec) {
      const prompt = String(args.prompt ?? "").trim();
      if (prompt.length === 0) {
        throw new Error("prompt required");
      }
      try {
        const t2i = models.resolveT2i();
        const result = await t2i.generate(
          {
            prompt,
            size: typeof args.size === "string" ? args.size : undefined,
          },
          exec.signal,
        );
        const rel =
          typeof args.path === "string" && args.path.length > 0
            ? args.path
            : `generated-images/${crypto.randomUUID()}${extForMime(result.mimeType, ".png")}`;
        const abs = resolveInside(exec.workspaceRoot, rel);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, result.bytes);
        return JSON.stringify({ ok: true, path: rel, mimeType: result.mimeType });
      } catch (err) {
        if (err instanceof ModelKindMissingError) {
          return JSON.stringify({ ok: false, error: `unconfigured ${err.kind}` });
        }
        const message = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ ok: false, error: message });
      }
    },
  };
}

export function createVideoGenerateTool(models: ModelRegistry): ToolDefinition {
  return {
    name: "video_generate",
    description: "Generate a video from a text prompt into the workspace.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        path: { type: "string" },
      },
      required: ["prompt"],
    },
    async execute(args, exec) {
      const prompt = String(args.prompt ?? "").trim();
      if (prompt.length === 0) {
        throw new Error("prompt required");
      }
      try {
        const t2v = models.resolveT2v();
        const result = await t2v.generate({ prompt }, exec.signal);
        const rel =
          typeof args.path === "string" && args.path.length > 0
            ? args.path
            : `generated-videos/${crypto.randomUUID()}${extForMime(result.mimeType, ".mp4")}`;
        const abs = resolveInside(exec.workspaceRoot, rel);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, result.bytes);
        return JSON.stringify({ ok: true, path: rel, mimeType: result.mimeType });
      } catch (err) {
        if (err instanceof ModelKindMissingError) {
          return JSON.stringify({ ok: false, error: `unconfigured ${err.kind}` });
        }
        const message = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ ok: false, error: message });
      }
    },
  };
}

const plugin: FlintPlugin = {
  name: "@flintloom/media-tools",
  apply(ctx: Context) {
    const tools = ctx.require<ToolRegistry>("tools");
    const models = ctx.require<ModelRegistry>("models");
    ctx.effect(tools.register(createImageGenerateTool(models)));
    ctx.effect(tools.register(createVideoGenerateTool(models)));
  },
};

export default plugin;
