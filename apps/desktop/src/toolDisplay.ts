export function toolDisplayTitle(name: string): string {
  if (name.startsWith("mcp__")) {
    const parts = name.split("__");
    return parts[parts.length - 1] ?? name;
  }
  const titles: Record<string, string> = {
    fs: "File",
    grep: "Search",
    shell: "Shell",
    skill: "Skill",
    knowledge_search: "Knowledge",
    a2ui_emit: "UI",
    doc_probe: "Doc probe",
    doc_parse: "Doc parse",
    doc_convert: "Doc convert",
    doc_generate: "Doc generate",
    doc_edit: "Doc edit",
    doc_compare: "Doc compare",
    doc_summarize: "Doc summarize",
    doc_ingest: "Doc ingest",
    infographic_get: "Infographic",
    infographic_patch: "Infographic",
    infographic_render: "Infographic",
    image_generate: "Image",
    video_generate: "Video",
    web_search: "Web",
  };
  return titles[name] ?? name;
}

export function toolDisplaySummary(name: string, args: unknown): string {
  if (typeof args === "object" && args !== null && !Array.isArray(args)) {
    const rec = args as Record<string, unknown>;
    if (typeof rec.path === "string") {
      const action = typeof rec.action === "string" ? `${rec.action} ` : "";
      return `${action}${rec.path}`.trim();
    }
    if (typeof rec.action === "string") {
      if (typeof rec.id === "string") {
        return `${rec.action} ${rec.id}`;
      }
      return rec.action;
    }
    if (typeof rec.query === "string") {
      return rec.query;
    }
    if (typeof rec.pattern === "string") {
      return rec.pattern;
    }
    if (typeof rec.command === "string") {
      return rec.command;
    }
    if (typeof rec.text === "string") {
      return rec.text.slice(0, 80);
    }
  }
  const raw = JSON.stringify(args);
  return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
}

export function toolResultState(text: string): "done" | "error" {
  if (
    text.startsWith("failed:") ||
    text.startsWith("guard denied:") ||
    text === "aborted"
  ) {
    return "error";
  }
  return "done";
}

export const TOOL_RESULT_MAX = 2000;

export function truncateToolResult(text: string): string {
  return text.length > TOOL_RESULT_MAX ? `${text.slice(0, TOOL_RESULT_MAX)}…` : text;
}

export function formatToolArgs(args: unknown): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}
