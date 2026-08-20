export type ChannelInbound = {
  text: string;
  sessionId: string;
  workspaceRoot: string;
  signal: AbortSignal;
};

export type ChannelInboundResult = {
  turnId: string;
  status: "ok" | "failed" | "cancelled" | "awaiting_action";
  text: string;
};

export type ChannelAdapter = {
  inbound(input: ChannelInbound): Promise<ChannelInboundResult>;
};

export type ChannelRegistry = {
  has(id: string): boolean;
  register(id: string, adapter: ChannelAdapter): () => void;
  inbound(id: string, input: ChannelInbound): Promise<ChannelInboundResult>;
};

export function createChannelRegistry(): ChannelRegistry {
  const adapters = new Map<string, ChannelAdapter>();

  return {
    has(id: string): boolean {
      return adapters.has(id);
    },
    register(id: string, adapter: ChannelAdapter): () => void {
      if (adapters.has(id)) {
        throw new Error(id);
      }
      adapters.set(id, adapter);
      return () => {
        adapters.delete(id);
      };
    },
    inbound(id: string, input: ChannelInbound): Promise<ChannelInboundResult> {
      const adapter = adapters.get(id);
      if (adapter === undefined) {
        throw new Error(id);
      }
      return adapter.inbound(input);
    },
  };
}
