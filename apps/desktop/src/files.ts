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
    | "audio"
    | "video"
    | "image"
    | "failed";
  text: string;
};

export function childPath(parent: string, name: string): string {
  if (parent === "." || parent === "") return name;
  return `${parent}/${name}`;
}

export function parentPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (normalized === "." || normalized === "") return ".";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return ".";
  return parts.slice(0, -1).join("/");
}

export function fileNameOf(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

const IMAGE_FILE_EXT_RE =
  /\.(png|jpe?g|gif|webp|bmp|avif|ico|svg)$/i;

export function isImageFilePath(path: string): boolean {
  return IMAGE_FILE_EXT_RE.test(fileNameOf(path));
}

export function isValidEntryName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed === "." || trimmed === "..") {
    return false;
  }
  return !/[\\/:*?"<>|]/.test(trimmed);
}

export type FileMoveTarget = { path: string; label: string };

export function buildFileMoveTargets(
  movingPath: string,
  movingIsDir: boolean,
  directories: FileMoveTarget[],
): FileMoveTarget[] {
  const currentParent = parentPath(movingPath);
  return directories.filter((dir) => {
    if (dir.path === currentParent) return false;
    if (
      movingIsDir &&
      (dir.path === movingPath || dir.path.startsWith(`${movingPath}/`))
    ) {
      return false;
    }
    return true;
  });
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

export type FileSync = {
  generation: number;
  dirs: string[];
  files: string[];
};

export async function fetchFilesSync(
  generation: number,
  signal?: AbortSignal,
): Promise<FileSync> {
  const res = await fetch(`/v1/files/sync?generation=${generation}`, {
    signal,
  });
  if (!res.ok) throw new Error("host unreachable");
  return (await res.json()) as FileSync;
}

export async function fetchPreview(
  path: string,
  signal?: AbortSignal,
): Promise<FilePreview> {
  const res = await fetch(
    `/v1/files/preview?path=${encodeURIComponent(path)}`,
    { signal, cache: "no-store" },
  );
  if (res.status === 404) throw new Error("文件不存在或尚未写完");
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

export async function convertWorkspaceFile(
  source: string,
  out: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/v1/files/convert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, out }),
    signal,
  });
  if (!res.ok) throw new Error("convert failed");
  const body = (await res.json()) as { out?: unknown };
  if (typeof body.out !== "string" || body.out.length === 0) {
    throw new Error("convert failed");
  }
  return body.out;
}

async function postFilePath(
  url: string,
  body: Record<string, string>,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 409) throw new Error("exists");
  if (!res.ok) throw new Error("file action failed");
}

export async function createWorkspaceFile(path: string): Promise<void> {
  await postFilePath("/v1/files/create", { path });
}

export async function createWorkspaceDirectory(path: string): Promise<void> {
  await postFilePath("/v1/files/mkdir", { path });
}

export async function writeNewWorkspaceFile(
  path: string,
  blob: Blob,
): Promise<string> {
  const dir = parentPath(path);
  if (dir !== ".") {
    try {
      await createWorkspaceDirectory(dir);
    } catch (err) {
      if (!(err instanceof Error && err.message === "exists")) throw err;
    }
  }
  const name = fileNameOf(path);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const dirPrefix = dir === "." ? "" : `${dir}/`;
  let candidate = path;
  let n = 1;
  for (;;) {
    try {
      await createWorkspaceFile(candidate);
      break;
    } catch (err) {
      if (!(err instanceof Error && err.message === "exists")) throw err;
      n += 1;
      if (n > 100) throw new Error("file write failed");
      candidate = `${dirPrefix}${stem}-${n}${ext}`;
    }
  }
  await writeFileBytes(candidate, blob);
  return candidate;
}

export async function renameWorkspaceEntry(
  path: string,
  to: string,
): Promise<void> {
  await postFilePath("/v1/files/rename", { path, to });
}

export async function deleteWorkspaceEntry(path: string): Promise<void> {
  const res = await fetch(`/v1/files?path=${encodeURIComponent(path)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("file action failed");
}
