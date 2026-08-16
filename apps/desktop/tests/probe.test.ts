import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureHost, PortInUseError, probeHost } from "../src/probe.ts";
import { forwardV1 } from "../src/proxy.ts";

function listenEphemeral(
  handler: (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ) => void,
): Promise<{ server: Server; origin: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("expected ephemeral TCP port"));
        return;
      }
      resolve({ server, origin: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function modelsHandler(token: string) {
  return (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ) => {
    if (req.url !== "/v1/models" || req.method !== "GET") {
      res.writeHead(404);
      res.end();
      return;
    }
    const auth = req.headers.authorization;
    if (!auth) {
      res.writeHead(401);
      res.end();
      return;
    }
    if (auth === `Bearer ${token}`) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("[]");
      return;
    }
    res.writeHead(403);
    res.end();
  };
}

describe("probeHost", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = undefined;
    }
  });

  it("returns ours with correct token, foreign with wrong token, missing when down", async () => {
    const token = "secret";
    const bound = await listenEphemeral(modelsHandler(token));
    server = bound.server;

    expect(await probeHost({ origin: bound.origin, token })).toBe("ours");
    expect(await probeHost({ origin: bound.origin, token: "wrong" })).toBe(
      "foreign",
    );

    await closeServer(server);
    server = undefined;
    expect(await probeHost({ origin: bound.origin, token })).toBe("missing");
  });
});

describe("ensureHost", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = undefined;
    }
  });

  it("calls start once when host is missing", async () => {
    const start = vi.fn(async () => {});
    await ensureHost({
      origin: "http://127.0.0.1:1",
      token: "secret",
      start,
    });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("returns when host is ours", async () => {
    const token = "secret";
    const bound = await listenEphemeral(modelsHandler(token));
    server = bound.server;

    const start = vi.fn(async () => {});
    await ensureHost({ origin: bound.origin, token, start });
    expect(start).not.toHaveBeenCalled();
  });

  it("throws PortInUseError when host is foreign", async () => {
    const token = "secret";
    const bound = await listenEphemeral((req, res) => {
      if (req.url !== "/v1/models" || req.method !== "GET") {
        res.writeHead(404);
        res.end();
        return;
      }
      if (!req.headers.authorization) {
        res.writeHead(401);
        res.end();
        return;
      }
      res.writeHead(403);
      res.end();
    });
    server = bound.server;

    const start = vi.fn(async () => {});
    await expect(
      ensureHost({ origin: bound.origin, token, start }),
    ).rejects.toBeInstanceOf(PortInUseError);
    expect(start).not.toHaveBeenCalled();
  });
});

describe("forwardV1", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = undefined;
    }
  });

  it("forwards GET /v1/models with Authorization bearer", async () => {
    let seenAuth: string | undefined;
    const bound = await listenEphemeral((req, res) => {
      seenAuth = req.headers.authorization;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("[]");
    });
    server = bound.server;

    const result = await forwardV1({
      upstreamOrigin: bound.origin,
      token: "secret",
      method: "GET",
      path: "/v1/models",
    });

    expect(seenAuth).toBe("Bearer secret");
    expect(result.status).toBe(200);
    expect(result.contentType).toMatch(/application\/json/);
    expect(result.stream).not.toBeNull();
    const text = await new Response(result.stream).text();
    expect(text).toBe("[]");
  });

  it("rejects paths that do not start with /v1/", async () => {
    await expect(
      forwardV1({
        upstreamOrigin: "http://127.0.0.1:1",
        token: "secret",
        method: "GET",
        path: "/api/models",
      }),
    ).rejects.toThrow(/\/v1\//);
  });
});
