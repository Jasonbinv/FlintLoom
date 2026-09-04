export type FlintHookResult = {
  turnId: string;
  status: "ok" | "failed" | "cancelled" | "awaiting_action";
  text: string;
};

export type FlintHookClient = {
  call(sessionId: string, text: string, signal?: AbortSignal): Promise<FlintHookResult>;
};

export function createFlintHookClient(opts: {
  hookUrl: string;
  hostToken: string;
  fetchImpl?: typeof fetch;
}): FlintHookClient {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  return {
    async call(sessionId, text, signal) {
      const res = await fetchImpl(opts.hookUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.hostToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId, text }),
        signal,
      });
      if (res.status === 401) {
        throw new Error("unauthorized");
      }
      if (res.status === 404) {
        throw new Error("webhook disabled");
      }
      if (res.status === 409) {
        throw new Error("busy");
      }
      if (res.status === 400) {
        throw new Error("bad request");
      }
      if (!res.ok) {
        throw new Error(`hook ${res.status}`);
      }
      return (await res.json()) as FlintHookResult;
    },
  };
}

export function flintHookErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) {
    return "处理失败，请稍后再试。";
  }
  if (err.message === "busy") {
    return "上一条还在处理中，请稍后再发。";
  }
  if (err.message === "unauthorized") {
    return "桥接鉴权失败，请检查 FLINTLOOM_HOST_TOKEN。";
  }
  if (err.message === "webhook disabled") {
    return "FlintLoom 未启用 webhook 通道，请确认 flintloom.yml 含 channel-webhook。";
  }
  return "处理失败，请稍后再试。";
}
