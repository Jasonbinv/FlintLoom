export async function forwardV1(opts: {
  upstreamOrigin: string;
  token: string;
  method: string;
  path: string;
  body?: Buffer;
}): Promise<{
  status: number;
  contentType: string | null;
  stream: ReadableStream<Uint8Array> | null;
}> {
  if (!opts.path.startsWith("/v1/")) {
    throw new Error("path must start with /v1/");
  }

  const res = await fetch(`${opts.upstreamOrigin}${opts.path}`, {
    method: opts.method,
    headers: {
      Authorization: `Bearer ${opts.token}`,
      "Content-Type": "application/json",
    },
    body: opts.body,
  });

  return {
    status: res.status,
    contentType: res.headers.get("Content-Type"),
    stream: res.body,
  };
}
