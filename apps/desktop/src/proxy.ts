export async function forwardV1(opts: {
  upstreamOrigin: string;
  token: string;
  method: string;
  path: string;
  body?: Buffer;
  contentType?: string;
  range?: string;
}): Promise<{
  status: number;
  contentType: string | null;
  contentLength: string | null;
  acceptRanges: string | null;
  contentRange: string | null;
  stream: ReadableStream<Uint8Array> | null;
}> {
  if (!opts.path.startsWith("/v1/")) {
    throw new Error("path must start with /v1/");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.token}`,
  };
  if (opts.body !== undefined) {
    headers["Content-Type"] = opts.contentType ?? "application/json";
  }
  if (opts.range) {
    headers.Range = opts.range;
  }

  const res = await fetch(`${opts.upstreamOrigin}${opts.path}`, {
    method: opts.method,
    headers,
    body: opts.body ? new Uint8Array(opts.body) : undefined,
  });

  return {
    status: res.status,
    contentType: res.headers.get("Content-Type"),
    contentLength: res.headers.get("Content-Length"),
    acceptRanges: res.headers.get("Accept-Ranges"),
    contentRange: res.headers.get("Content-Range"),
    stream: res.body,
  };
}
