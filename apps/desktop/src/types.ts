export type TurnEnd = {
  type: "end";
  status: "ok" | "failed" | "cancelled" | "awaiting_action";
};
export type WorkbenchEvent =
  | { type: "turn/start"; turnId: string }
  | { type: "turn/end"; turnId: string; status: "ok" | "failed" | "cancelled" }
  | { type: "user/message"; text: string }
  | { type: "assistant/chunk"; text: string }
  | { type: "assistant/message"; text: string }
  | { type: "tool/call"; callId: string; name: string; args: unknown }
  | { type: "tool/result"; callId: string; name: string; text: string }
  | { type: "model/error"; kind: string; message: string }
  | { type: "guard/decision"; tool: string; decision: "allow" | "deny" | "ask" }
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
