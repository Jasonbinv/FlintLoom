import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isHiddenRelPath } from "@flintloom/tools";
import { relFromWorkspace } from "../src/files.ts";
import { loadOrCreateToken, startHost } from "../src/index.ts";
import { writeAssembly } from "./assembly.ts";

describe("relFromWorkspace", () => {
  it("treats a resolved .env absPath as hidden even if the request name is visible", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-files-rel-"));
    writeFileSync(join(workspaceRoot, ".env"), "sk-secret\n");
    writeFileSync(join(workspaceRoot, "visible.txt"), "ok\n");
    const envAbs = realpathSync.native(join(workspaceRoot, ".env"));
    expect(isHiddenRelPath(relFromWorkspace(workspaceRoot, envAbs))).toBe(true);
    expect(
      isHiddenRelPath(
        relFromWorkspace(workspaceRoot, join(workspaceRoot, "visible.txt")),
      ),
    ).toBe(false);
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
    writeAssembly(workspaceRoot);

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

  it("hides preview when a visible name resolves to a hidden file", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-files-link-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-files-link-home-"));
    writeFileSync(join(workspaceRoot, ".env"), "sk-secret\n");
    writeFileSync(join(workspaceRoot, "README.md"), "# Hello\n");
    mkdirSync(join(workspaceRoot, "node_modules"), { recursive: true });
    writeAssembly(workspaceRoot);

    try {
      symlinkSync(join(workspaceRoot, ".env"), join(workspaceRoot, "config.ts"));
    } catch {
      // Windows file symlinks may require Administrator or Developer Mode.
      return;
    }

    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);
    const res = await fetch(`${host.url}/v1/files/preview?path=config.ts`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string; text: string };
    expect(body.text).toBe("failed: hidden");
    expect(body.text).not.toContain("sk-secret");
  });

  it("returns 404 when listing a visible name that resolves to a hidden directory", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-files-junc-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-files-junc-home-"));
    mkdirSync(join(workspaceRoot, "node_modules"), { recursive: true });
    writeFileSync(join(workspaceRoot, "README.md"), "# Hello\n");
    writeAssembly(workspaceRoot);

    try {
      symlinkSync(
        join(workspaceRoot, "node_modules"),
        join(workspaceRoot, "vendor"),
        "junction",
      );
    } catch {
      try {
        symlinkSync(
          join(workspaceRoot, "node_modules"),
          join(workspaceRoot, "vendor"),
        );
      } catch {
        // Neither junction nor symlink could be created on this host.
        return;
      }
    }

    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);
    const res = await fetch(`${host.url}/v1/files?path=vendor`, {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(404);
  });

  it("opens html in a tokenized sandbox wrapper without bearer auth", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-files-html-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-files-html-home-"));
    writeFileSync(
      join(workspaceRoot, "page.html"),
      "<html><body><h1>Safe HTML</h1><script>window.__x=1</script></body></html>",
    );
    writeAssembly(workspaceRoot);

    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);

    const openRes = await fetch(`${host.url}/v1/files/safe-html/open`, {
      method: "POST",
      headers: {
        ...authHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: "page.html" }),
    });
    const openText = await openRes.text();
    expect(openRes.status, openText).toBe(200);
    const openBody = JSON.parse(openText) as { openUrl: string };
    expect(openBody.openUrl).toContain("/v1/files/safe-html?t=");

    const wrapperRes = await fetch(openBody.openUrl);
    expect(wrapperRes.status).toBe(200);
    const wrapperHtml = await wrapperRes.text();
    expect(wrapperHtml).toContain("sandbox=\"allow-scripts\"");
    expect(wrapperHtml).toContain("page.html");

    const contentUrl = new URL(openBody.openUrl);
    contentUrl.pathname = "/v1/files/safe-html/content";
    const contentRes = await fetch(contentUrl.toString());
    expect(contentRes.status).toBe(200);
    const contentHtml = await contentRes.text();
    expect(contentHtml).toContain("<h1>Safe HTML</h1>");
  });

  it("previews spreadsheets without docforge markdown conversion", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-files-xlsx-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-files-xlsx-home-"));
    writeFileSync(join(workspaceRoot, "sheet.xlsx"), "fake-xlsx-bytes");
    writeAssembly(workspaceRoot);

    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);

    const previewRes = await fetch(
      `${host.url}/v1/files/preview?path=${encodeURIComponent("sheet.xlsx")}`,
      { headers: authHeaders(token) },
    );
    expect(previewRes.status).toBe(200);
    const preview = (await previewRes.json()) as { kind: string; text: string };
    expect(preview.kind).toBe("spreadsheet");
    expect(preview.text).toBe("");

    const rawRes = await fetch(
      `${host.url}/v1/files/raw?path=${encodeURIComponent("sheet.xlsx")}`,
      { headers: authHeaders(token) },
    );
    expect(rawRes.status).toBe(200);
    expect(await rawRes.text()).toBe("fake-xlsx-bytes");

    const putRes = await fetch(
      `${host.url}/v1/files/raw?path=${encodeURIComponent("sheet.xlsx")}`,
      {
        method: "PUT",
        headers: authHeaders(token),
        body: "updated-xlsx",
      },
    );
    expect(putRes.status).toBe(200);

    const rawAgain = await fetch(
      `${host.url}/v1/files/raw?path=${encodeURIComponent("sheet.xlsx")}`,
      { headers: authHeaders(token) },
    );
    expect(await rawAgain.text()).toBe("updated-xlsx");
  });

  it("previews pdf without docforge markdown conversion", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-files-pdf-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-files-pdf-home-"));
    writeFileSync(join(workspaceRoot, "report.pdf"), "%PDF-1.4 fake");
    writeAssembly(workspaceRoot);

    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);

    const previewRes = await fetch(
      `${host.url}/v1/files/preview?path=${encodeURIComponent("report.pdf")}`,
      { headers: authHeaders(token) },
    );
    expect(previewRes.status).toBe(200);
    const preview = (await previewRes.json()) as { kind: string };
    expect(preview.kind).toBe("pdf");
  });

  it("previews mp3 as audio without converting to text", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-files-mp3-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-files-mp3-home-"));
    writeFileSync(join(workspaceRoot, "song.mp3"), "ID3-fake-bytes");
    writeAssembly(workspaceRoot);

    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);

    const previewRes = await fetch(
      `${host.url}/v1/files/preview?path=${encodeURIComponent("song.mp3")}`,
      { headers: authHeaders(token) },
    );
    expect(previewRes.status).toBe(200);
    const preview = (await previewRes.json()) as { kind: string; text: string };
    expect(preview.kind).toBe("audio");
    expect(preview.text).toBe("");

    const rawRes = await fetch(
      `${host.url}/v1/files/raw?path=${encodeURIComponent("song.mp3")}`,
      { headers: authHeaders(token) },
    );
    expect(rawRes.status).toBe(200);
    expect(rawRes.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(await rawRes.text()).toBe("ID3-fake-bytes");
  });

  it("previews mp4 as video without converting to text", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-files-mp4-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-files-mp4-home-"));
    writeFileSync(join(workspaceRoot, "clip.mp4"), "ftyp-fake-bytes");
    writeAssembly(workspaceRoot);

    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);

    const previewRes = await fetch(
      `${host.url}/v1/files/preview?path=${encodeURIComponent("clip.mp4")}`,
      { headers: authHeaders(token) },
    );
    expect(previewRes.status).toBe(200);
    const preview = (await previewRes.json()) as { kind: string; text: string };
    expect(preview.kind).toBe("video");
    expect(preview.text).toBe("");

    const rawRes = await fetch(
      `${host.url}/v1/files/raw?path=${encodeURIComponent("clip.mp4")}`,
      { headers: authHeaders(token) },
    );
    expect(rawRes.status).toBe(200);
    expect(rawRes.headers.get("Content-Type")).toBe("video/mp4");
  });

  it("serves raw media byte ranges so players can seek", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-files-range-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-files-range-home-"));
    writeFileSync(join(workspaceRoot, "song.mp3"), "0123456789abcdefghij");
    writeAssembly(workspaceRoot);

    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);
    const url = `${host.url}/v1/files/raw?path=${encodeURIComponent("song.mp3")}`;

    const fullRes = await fetch(url, { headers: authHeaders(token) });
    expect(fullRes.status).toBe(200);
    expect(fullRes.headers.get("Accept-Ranges")).toBe("bytes");
    expect(fullRes.headers.get("Content-Length")).toBe("20");

    const rangedRes = await fetch(url, {
      headers: { ...authHeaders(token), Range: "bytes=4-8" },
    });
    expect(rangedRes.status).toBe(206);
    expect(rangedRes.headers.get("Accept-Ranges")).toBe("bytes");
    expect(rangedRes.headers.get("Content-Range")).toBe("bytes 4-8/20");
    expect(rangedRes.headers.get("Content-Length")).toBe("5");
    expect(rangedRes.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(await rangedRes.text()).toBe("45678");
  });
});

describe("workspace file mutations", () => {
  let close: (() => Promise<void>) | undefined;
  let workspaceRoot: string;

  afterEach(async () => {
    if (close) {
      await close();
      close = undefined;
    }
  });

  async function startWorkspace(): Promise<{ url: string; token: string }> {
    workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-files-mut-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-files-mut-home-"));
    writeFileSync(join(workspaceRoot, "README.md"), "# Hello\n");
    mkdirSync(join(workspaceRoot, "src"));
    writeFileSync(join(workspaceRoot, "src", "a.ts"), "export const n = 1\n");
    writeAssembly(workspaceRoot);
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    return { url: host.url, token: loadOrCreateToken(homeDir) };
  }

  function authHeaders(token: string): HeadersInit {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  it("creates a folder then lists it", async () => {
    const { url, token } = await startWorkspace();
    const res = await fetch(`${url}/v1/files/mkdir`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ path: "notes" }),
    });
    expect(res.status).toBe(200);
    expect(existsSync(join(workspaceRoot, "notes"))).toBe(true);

    const list = await fetch(`${url}/v1/files?path=.`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await list.json()) as { entries: { name: string }[] };
    expect(body.entries.map((e) => e.name)).toContain("notes");
  });

  it("creates an empty file in an existing folder", async () => {
    const { url, token } = await startWorkspace();
    const res = await fetch(`${url}/v1/files/create`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ path: "src/new.ts" }),
    });
    expect(res.status).toBe(200);
    expect(readFileSync(join(workspaceRoot, "src", "new.ts"), "utf8")).toBe("");
  });

  it("renames a file within the workspace", async () => {
    const { url, token } = await startWorkspace();
    const res = await fetch(`${url}/v1/files/rename`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ path: "README.md", to: "INTRO.md" }),
    });
    expect(res.status).toBe(200);
    expect(existsSync(join(workspaceRoot, "README.md"))).toBe(false);
    expect(readFileSync(join(workspaceRoot, "INTRO.md"), "utf8")).toBe("# Hello\n");
  });

  it("moves a file into a folder", async () => {
    const { url, token } = await startWorkspace();
    const res = await fetch(`${url}/v1/files/rename`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ path: "README.md", to: "src/README.md" }),
    });
    expect(res.status).toBe(200);
    expect(existsSync(join(workspaceRoot, "README.md"))).toBe(false);
    expect(readFileSync(join(workspaceRoot, "src", "README.md"), "utf8")).toBe(
      "# Hello\n",
    );
  });

  it("moves a folder into another folder", async () => {
    const { url, token } = await startWorkspace();
    mkdirSync(join(workspaceRoot, "notes"));
    const res = await fetch(`${url}/v1/files/rename`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ path: "src", to: "notes/src" }),
    });
    expect(res.status).toBe(200);
    expect(existsSync(join(workspaceRoot, "src"))).toBe(false);
    expect(readFileSync(join(workspaceRoot, "notes", "src", "a.ts"), "utf8")).toBe(
      "export const n = 1\n",
    );
  });

  it("rejects moving a folder into itself", async () => {
    const { url, token } = await startWorkspace();
    const res = await fetch(`${url}/v1/files/rename`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ path: "src", to: "src/nested" }),
    });
    expect(res.status).toBe(400);
    expect(existsSync(join(workspaceRoot, "src", "a.ts"))).toBe(true);
  });

  it("deletes a file", async () => {
    const { url, token } = await startWorkspace();
    const res = await fetch(
      `${url}/v1/files?path=${encodeURIComponent("README.md")}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    expect(res.status).toBe(200);
    expect(existsSync(join(workspaceRoot, "README.md"))).toBe(false);
  });

  it("deletes a directory recursively", async () => {
    const { url, token } = await startWorkspace();
    const res = await fetch(`${url}/v1/files?path=${encodeURIComponent("src")}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(existsSync(join(workspaceRoot, "src"))).toBe(false);
  });

  it("rejects creating a hidden path", async () => {
    const { url, token } = await startWorkspace();
    const res = await fetch(`${url}/v1/files/create`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ path: ".env" }),
    });
    expect(res.status).toBe(404);
    expect(existsSync(join(workspaceRoot, ".env"))).toBe(false);
  });

  it("rejects a rename that escapes the workspace", async () => {
    const { url, token } = await startWorkspace();
    const res = await fetch(`${url}/v1/files/rename`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ path: "README.md", to: "../secret.md" }),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Path escapes workspace");
  });

  it("returns 409 when creating a path that already exists", async () => {
    const { url, token } = await startWorkspace();
    const res = await fetch(`${url}/v1/files/mkdir`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ path: "src" }),
    });
    expect(res.status).toBe(409);
    expect(readdirSync(join(workspaceRoot, "src"))).toContain("a.ts");
  });
});

describe("GET /v1/files/sync", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    if (close) {
      await close();
      close = undefined;
    }
  });

  async function startSyncHost() {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-sync-ws-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-sync-home-"));
    writeAssembly(workspaceRoot);
    writeFileSync(join(workspaceRoot, "README.md"), "# Hello\n");
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    return {
      url: host.url,
      token: loadOrCreateToken(homeDir),
      workspaceRoot,
    };
  }

  function authHeaders(token: string): HeadersInit {
    return { Authorization: `Bearer ${token}` };
  }

  it("wakes when a visible file is written while waiting", async () => {
    const { url, token, workspaceRoot } = await startSyncHost();
    const pending = fetch(`${url}/v1/files/sync?generation=0`, {
      headers: authHeaders(token),
    });
    writeFileSync(join(workspaceRoot, "notes.md"), "from-disk\n");
    const res = await pending;
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      generation: number;
      dirs: string[];
      files: string[];
    };
    expect(body.generation).toBeGreaterThan(0);
    expect(body.dirs).toContain(".");
    expect(body.files).toContain("notes.md");
  });

  it("returns catch-up immediately when generation is stale", async () => {
    const { url, token, workspaceRoot } = await startSyncHost();
    writeFileSync(join(workspaceRoot, "a.md"), "a\n");
    const first = await fetch(`${url}/v1/files/sync?generation=0`, {
      headers: authHeaders(token),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { generation: number };
    expect(firstBody.generation).toBeGreaterThan(0);
    const t0 = Date.now();
    const second = await fetch(`${url}/v1/files/sync?generation=0`, {
      headers: authHeaders(token),
    });
    expect(second.status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(500);
    const body = (await second.json()) as {
      generation: number;
      dirs: string[];
      files: string[];
    };
    expect(body.generation).toBe(firstBody.generation);
    expect(body.dirs).toEqual(["."]);
    expect(body.files).toEqual([]);
  });

  it("rejects missing bearer with 401", async () => {
    const { url } = await startSyncHost();
    const res = await fetch(`${url}/v1/files/sync?generation=0`);
    expect(res.status).toBe(401);
  });

  it("rejects missing or invalid generation with 400", async () => {
    const { url, token } = await startSyncHost();
    const headers = authHeaders(token);
    const missing = await fetch(`${url}/v1/files/sync`, { headers });
    expect(missing.status).toBe(400);
    const bad = await fetch(`${url}/v1/files/sync?generation=foo`, { headers });
    expect(bad.status).toBe(400);
    const neg = await fetch(`${url}/v1/files/sync?generation=-1`, { headers });
    expect(neg.status).toBe(400);
  });
});
