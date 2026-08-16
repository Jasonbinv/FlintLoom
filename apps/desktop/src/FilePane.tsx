import { useEffect, useRef, useState } from "react";
import {
  childPath,
  fetchFiles,
  fetchPreview,
  type FileEntry,
} from "./files.ts";

type Props = {
  onInsertPath: (path: string) => void;
};

export function FilePane({ onInsertPath }: Props) {
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({});
  const [treeError, setTreeError] = useState(false);
  const [previewText, setPreviewText] = useState("");
  const [previewError, setPreviewError] = useState(false);
  const previewAc = useRef<AbortController | undefined>(undefined);

  async function loadPreview(filePath: string, signal?: AbortSignal) {
    try {
      const preview = await fetchPreview(filePath, signal);
      if (signal?.aborted) return;
      setPreviewText(preview.text);
      setPreviewError(false);
    } catch (err) {
      if (signal?.aborted) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      setPreviewError(true);
    }
  }

  useEffect(() => {
    const ac = new AbortController();
    void fetchFiles(".", ac.signal)
      .then(async (list) => {
        if (ac.signal.aborted) return;
        setRootEntries(list.entries);
        setTreeError(false);
        const firstFile = list.entries.find((e) => e.type === "file");
        if (firstFile) {
          await loadPreview(childPath(".", firstFile.name), ac.signal);
        }
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setTreeError(true);
      });
    return () => ac.abort();
  }, []);

  async function toggleDir(dirPath: string) {
    const next = new Set(expanded);
    if (next.has(dirPath)) {
      next.delete(dirPath);
      setExpanded(next);
      return;
    }
    next.add(dirPath);
    setExpanded(next);
    if (children[dirPath]) return;
    try {
      const list = await fetchFiles(dirPath);
      setChildren((prev) => ({ ...prev, [dirPath]: list.entries }));
      setTreeError(false);
    } catch {
      setTreeError(true);
    }
  }

  async function openFile(filePath: string) {
    onInsertPath(filePath);
    previewAc.current?.abort();
    const ac = new AbortController();
    previewAc.current = ac;
    await loadPreview(filePath, ac.signal);
  }

  function renderEntries(entries: FileEntry[], parent: string, depth: number) {
    return entries.map((entry) => {
      const path = childPath(parent, entry.name);
      if (entry.type === "dir") {
        const isOpen = expanded.has(path);
        return (
          <div key={path} className="file-node" style={{ paddingLeft: depth * 12 }}>
            <button type="button" onClick={() => void toggleDir(path)}>
              {entry.name}
            </button>
            {isOpen && children[path]
              ? renderEntries(children[path], path, depth + 1)
              : null}
          </div>
        );
      }
      return (
        <div key={path} className="file-node" style={{ paddingLeft: depth * 12 }}>
          <button type="button" onClick={() => void openFile(path)}>
            {entry.name}
          </button>
        </div>
      );
    });
  }

  return (
    <aside className="file-pane">
      <div className="file-tree">
        {treeError ? (
          <div>host unreachable</div>
        ) : (
          renderEntries(rootEntries, ".", 0)
        )}
      </div>
      <pre className="file-preview">
        {previewError ? "host unreachable" : previewText}
      </pre>
    </aside>
  );
}
