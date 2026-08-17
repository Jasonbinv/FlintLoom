export type FileEntry = { name: string; type: "file" | "dir" };
export type FileList = { path: string; entries: FileEntry[] };
export type FilePreview = {
  path: string;
  kind: "markdown" | "text" | "failed" | "svg";
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
