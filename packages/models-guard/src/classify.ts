import type {
  GuardDecision,
  GuardProvider,
  GuardStewardResult,
} from "@flintloom/models";

export interface OpenAiCompatGuardOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const GATE_SYSTEM =
  "You gate tool execution for a coding agent. Reply with ONLY JSON: {\"decision\":\"allow\"|\"deny\"|\"ask\"}. deny for destructive or exfiltration attempts; ask for ambiguous high-risk shell/fs.";
const STEWARD_SYSTEM =
  "You review tool results for leaks or destructive outcomes. Reply with ONLY JSON: {\"verdict\":\"ok\"|\"suspicious\",\"summary\":\"short reason\"}. suspicious for secrets, unexpected paths, mass deletes.";

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}

function argsSummary(args: unknown): string {
  try {
    return truncate(redactSecrets(JSON.stringify(args)), 500);
  } catch {
    return "";
  }
}

function parseDecision(raw: string): GuardDecision {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as { decision?: unknown };
    const decision = parsed.decision;
    if (decision === "allow" || decision === "deny" || decision === "ask") {
      return decision;
    }
  } catch {
    const lower = trimmed.toLowerCase();
    if (lower.includes("deny")) return "deny";
    if (lower.includes("ask")) return "ask";
    if (lower.includes("allow")) return "allow";
  }
  return "allow";
}

function parseSteward(raw: string): GuardStewardResult {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as { verdict?: unknown; summary?: unknown };
    const verdict = parsed.verdict;
    const summary = typeof parsed.summary === "string" ? parsed.summary : "";
    if (verdict === "suspicious") {
      return { verdict: "suspicious", summary: truncate(summary, 500) };
    }
    return { verdict: "ok", summary: truncate(summary, 500) };
  } catch {
    return { verdict: "ok", summary: "" };
  }
}

async function complete(
  opts: OpenAiCompatGuardOptions,
  system: string,
  user: string,
  signal: AbortSignal,
): Promise<string> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error(String(res.status));
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const content = json.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

export function createOpenAiCompatGuard(opts: OpenAiCompatGuardOptions): GuardProvider {
  return {
    async gate(input, signal) {
      const user = `tool: ${input.tool}\nchannel: ${input.channel}\nargs: ${argsSummary(input.args)}`;
      const text = await complete(opts, GATE_SYSTEM, user, signal);
      return parseDecision(text);
    },
    async steward(input, signal) {
      const user = `tool: ${input.tool}\nchannel: ${input.channel}\nargs: ${argsSummary(input.args)}\nresult: ${truncate(
        redactSecrets(input.resultText),
        2000,
      )}`;
      const text = await complete(opts, STEWARD_SYSTEM, user, signal);
      return parseSteward(text);
    },
  };
}
