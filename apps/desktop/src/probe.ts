export class PortInUseError extends Error {
  constructor() {
    super("port 7331 in use");
    this.name = "PortInUseError";
  }
}

export async function probeHost(opts: {
  origin: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<"missing" | "ours" | "foreign"> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const url = `${opts.origin}/v1/models`;

  let res: Response;
  try {
    res = await fetchFn(url);
  } catch {
    return "missing";
  }

  if (res.status !== 401) {
    return "foreign";
  }

  try {
    res = await fetchFn(url, {
      headers: { Authorization: `Bearer ${opts.token}` },
    });
  } catch {
    return "missing";
  }

  if (res.status === 200) {
    return "ours";
  }

  return "foreign";
}

export async function ensureHost(opts: {
  origin?: string;
  token: string;
  start: () => Promise<void>;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const origin = opts.origin ?? "http://127.0.0.1:7331";
  const state = await probeHost({
    origin,
    token: opts.token,
    fetchImpl: opts.fetchImpl,
  });

  if (state === "missing") {
    await opts.start();
    return;
  }

  if (state === "ours") {
    return;
  }

  throw new PortInUseError();
}
