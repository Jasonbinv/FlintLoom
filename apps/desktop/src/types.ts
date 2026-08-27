export type UserImage = {
  mime: string;
  data: string;
};

export type TurnEnd = {
  type: "end";
  status: "ok" | "failed" | "cancelled" | "awaiting_action";
};
export type WorkbenchEvent =
  | { type: "turn/start"; turnId: string; startedAt: number }
  | { type: "step/start"; turnId: string; step: number }
  | {
      type: "turn/stats";
      turnId: string;
      steps: number;
      toolCalls: number;
      durationMs: number;
      guard: { allow: number; deny: number; ask: number; suspicious: number };
    }
  | { type: "turn/end"; turnId: string; status: "ok" | "failed" | "cancelled" }
  | { type: "user/message"; text: string; images?: UserImage[] }
  | { type: "assistant/chunk"; text: string }
  | { type: "assistant/reasoning-chunk"; text: string }
  | { type: "assistant/message"; text: string }
  | { type: "tool/call"; callId: string; name: string; args: unknown }
  | { type: "tool/result"; callId: string; name: string; text: string }
  | { type: "model/error"; kind: string; message: string }
  | { type: "guard/decision"; tool: string; decision: "allow" | "deny" | "ask" }
  | {
      type: "guard/steward";
      callId: string;
      tool: string;
      verdict: "ok" | "suspicious";
      summary: string;
    }
  | {
      type: "guard/ask";
      turnId: string;
      callId: string;
      tool: string;
      remainingCalls: { id: string; name: string; args: unknown }[];
    }
  | {
      type: "guard/response";
      turnId: string;
      callId: string;
      decision: "allow" | "deny";
    }
  | {
      type: "a2ui/surface";
      turnId: string;
      surfaceId: string;
      messages: unknown[];
      wait: boolean;
    }
  | {
      type: "a2ui/action";
      turnId: string;
      surfaceId: string;
      name: string;
      context?: unknown;
      data?: unknown;
    }
  | TurnEnd;
