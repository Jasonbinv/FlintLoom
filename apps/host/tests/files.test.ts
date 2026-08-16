import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isHiddenRelPath } from "../src/files.ts";
import { loadOrCreateToken, startHost } from "../src/index.ts";

describe("isHiddenRelPath", () => {
  it("hides .env but not .env.example", () => {
    expect(isHiddenRelPath(".env")).toBe(true);
    expect(isHiddenRelPath(".env.example")).toBe(false);
  });
});

describe("GET /v1/files and /v1/files/preview", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) {
      await close();
      close = undefined;
    }
  });

  async function startWithFixture(): Promise<{
    url: string;
    token: string;
  }> {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-files-ws-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-files-home-"));

    writeFileSync(join(workspaceRoot, "README.md"), "# Hello\n");
    writeFileSync(join(workspaceRoot, ".env"), "sk-secret\n");
    writeFileSync(join(workspaceRoot, ".env.example"), "example\n");
    writeFileSync(join(workspaceRoot, ".env.production"), "prod\n");
    writeFileSync(join(workspaceRoot, "secret.env"), "sk\n");
    writeFileSync(join(workspaceRoot, "Makefile"), "hello-make\n");
    mkdirSync(join(workspaceRoot, "src"));
    writeFileSync(join(workspaceRoot, "src", "a.ts"), "export const n = 1\n");
    mkdirSync(join(workspaceRoot, "node_modules", "pkg"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, "node_modules", "pkg", "x.js"),
      "hide-me\n",
    );

    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    return { url: host.url, token: loadOrCreateToken(homeDir) };
  }

  function authHeaders(token: string): HeadersInit {
    return { Authorization: `Bearer ${token}` };
  }

  it("lists workspace root without hidden entries", async () => {
    const { url, token } = await startWithFixture();

    for (const path of ["/v1/files", "/v1/files?path=."]) {
      const res = await fetch(`${url}${path}`, {
        headers: authHeaders(token),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        path: string;
        entries: { name: string; type: string }[];
      };
      expect(body.path).toBe(".");
      const names = body.entries.map((e) => e.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "README.md",
          "src",
          ".env.example",
          "Makefile",
        ]),
      );
      expect(names).not.toContain("node_modules");
      expect(names).not.toContain(".env");
      expect(names).not.toContain(".env.production");
      expect(names).not.toContain("secret.env");
    }
  });

  it("previews markdown via docforge", async () => {
    const { url, token } = await startWithFixture();
    const res = await fetch(`${url}/v1/files/preview?path=README.md`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string; text: string };
    expect(body.kind).toBe("markdown");
    expect(body.text).toContain("Hello");
  });

  it("previews source and extensionless text files", async () => {
    const { url, token } = await startWithFixture();

    const ts = await fetch(`${url}/v1/files/preview?path=src/a.ts`, {
      headers: authHeaders(token),
    });
    expect(ts.status).toBe(200);
    const tsBody = (await ts.json()) as { kind: string; text: string };
    expect(tsBody.kind).toBe("text");
    expect(tsBody.text).toContain("export");

    const make = await fetch(`${url}/v1/files/preview?path=Makefile`, {
      headers: authHeaders(token),
    });
    expect(make.status).toBe(200);
    const makeBody = (await make.json()) as { kind: string; text: string };
    expect(makeBody.kind).toBe("text");
    expect(makeBody.text).toContain("hello-make");
  });

  it("returns failed: hidden for secret env files without leaking content", async () => {
    const { url, token } = await startWithFixture();

    for (const path of [".env", ".env.production", "secret.env"]) {
      const res = await fetch(
        `${url}/v1/files/preview?path=${encodeURIComponent(path)}`,
        { headers: authHeaders(token) },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { kind: string; text: string };
      expect(body.text).toBe("failed: hidden");
    }
  });

  it("allows preview of .env.example", async () => {
    const { url, token } = await startWithFixture();
    const res = await fetch(`${url}/v1/files/preview?path=.env.example`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string; text: string };
    expect(body.kind !== "failed" || body.text !== "failed: hidden").toBe(true);
    expect(body.text).toContain("example");
  });

  it("returns 404 for listing a hidden directory", async () => {
    const { url, token } = await startWithFixture();
    const res = await fetch(`${url}/v1/files?path=node_modules`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when listing a file path", async () => {
    const { url, token } = await startWithFixture();
    const res = await fetch(`${url}/v1/files?path=README.md`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("failed: not a directory");
  });

  it("returns 400 when preview path is missing", async () => {
    const { url, token } = await startWithFixture();
    const res = await fetch(`${url}/v1/files/preview`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when path escapes the workspace", async () => {
    const { url, token } = await startWithFixture();
    const res = await fetch(`${url}/v1/files?path=../x`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Path escapes workspace");
  });

  it("rejects /v1/files without a bearer token", async () => {
    const { url } = await startWithFixture();
    const res = await fetch(`${url}/v1/files`);
    expect(res.status).toBe(401);
  });
});
