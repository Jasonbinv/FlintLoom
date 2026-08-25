export type FileEntry = { name: string; type: "file" | "dir" };
export type FileList = { path: string; entries: FileEntry[] };
export type FilePreview = {
  path: string;
  kind:
    | "markdown"
    | "text"
    | "svg"
    | "spreadsheet"
    | "pdf"
    | "docx"
    | "pptx"
    | "failed";
  text: string;
};

export function childPath(parent: string, name: string): string {
  if (parent === "." || parent === "") return name;
  return `${parent}/${name}`;
}

export function insertPath(input: string, filePath: string): string {
  const trimmed = input.trimEnd();
  const lastToken = trimmed.trim().split(/\s+/).filter(Boolean).at(-1);
  if (lastToken === filePath) return input;
  if (trimmed === "") return filePath;
  return `${trimmed} ${filePath}`;
}

export async function fetchFiles(
  path: string,
  signal?: AbortSignal,
): Promise<FileList> {
  const res = await fetch(`/v1/files?path=${encodeURIComponent(path)}`, {
    signal,
  });
  if (!res.ok) throw new Error("host unreachable");
  return (await res.json()) as FileList;
}

export async function fetchPreview(
  path: string,
  signal?: AbortSignal,
): Promise<FilePreview> {
  const res = await fetch(
    `/v1/files/preview?path=${encodeURIComponent(path)}`,
    { signal },
  );
  if (!res.ok) throw new Error("host unreachable");
  return (await res.json()) as FilePreview;
}

export async function fetchSafeHtmlOpenUrl(
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/v1/files/safe-html/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
    signal,
  });
  if (!res.ok) throw new Error("safe html open failed");
  const body = (await res.json()) as { openUrl?: unknown };
  if (typeof body.openUrl !== "string" || body.openUrl.length === 0) {
    throw new Error("safe html open failed");
  }
  return body.openUrl;
}

export async function fetchFileBytes(
  path: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const res = await fetch(
    `/v1/files/raw?path=${encodeURIComponent(path)}`,
    { signal },
  );
  if (!res.ok) throw new Error("file read failed");
  return await res.arrayBuffer();
}

export async function writeFileBytes(
  path: string,
  blob: Blob,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(
    `/v1/files/raw?path=${encodeURIComponent(path)}`,
    {
      method: "PUT",
      body: blob,
      signal,
    },
  );
  if (!res.ok) throw new Error("file write failed");
}

export async function fetchOfficeMarkdown(
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(
    `/v1/files/markdown?path=${encodeURIComponent(path)}`,
    { signal },
  );
  if (!res.ok) throw new Error("markdown read failed");
  const body = (await res.json()) as { markdown?: unknown };
  if (typeof body.markdown !== "string") {
    throw new Error("markdown read failed");
  }
  return body.markdown;
}

export async function saveOfficeFromMarkdown(
  path: string,
  markdown: string,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(
    `/v1/files/from-markdown?path=${encodeURIComponent(path)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown }),
      signal,
    },
  );
  if (!res.ok) throw new Error("markdown save failed");
}
