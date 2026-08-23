import { useEffect, useRef, useState } from "react";
import {
  childPath,
  fetchFiles,
  fetchPreview,
  type FileEntry,
} from "./files.ts";
import { FileIcon } from "./FileIcon.tsx";
import { KnowledgePane } from "./KnowledgePane.tsx";

type Props = {
  onInsertPath: (path: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  requestedPath?: string;
  previewRequest?: number;
};

export function FilePane({
  onInsertPath,
  collapsed,
  onToggleCollapse,
  requestedPath,
  previewRequest,
}: Props) {
  const [tab, setTab] = useState<"files" | "knowledge">("files");
  const [selectedFile, setSelectedFile] = useState<string>();
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({});
  const [treeError, setTreeError] = useState(false);
  const [dirErrors, setDirErrors] = useState<Set<string>>(() => new Set());
  const [previewText, setPreviewText] = useState("");
  const [previewKind, setPreviewKind] = useState<
    "markdown" | "text" | "failed" | "svg"
  >("text");
  const [previewError, setPreviewError] = useState(false);
  const previewAc = useRef<AbortController | undefined>(undefined);

  async function loadPreview(filePath: string, signal: AbortSignal) {
    try {
      const preview = await fetchPreview(filePath, signal);
      if (signal.aborted) return;
      setPreviewKind(preview.kind);
      setPreviewText(preview.text);
      setPreviewError(false);
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      setPreviewError(true);
    }
  }

  function startPreview(filePath: string) {
    previewAc.current?.abort();
    const ac = new AbortController();
    previewAc.current = ac;
    return loadPreview(filePath, ac.signal);
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
          await startPreview(childPath(".", firstFile.name));
        }
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setTreeError(true);
      });
    return () => {
      ac.abort();
      previewAc.current?.abort();
    };
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
      setDirErrors((prev) => {
        if (!prev.has(dirPath)) return prev;
        const cleared = new Set(prev);
        cleared.delete(dirPath);
        return cleared;
      });
    } catch {
      setDirErrors((prev) => new Set(prev).add(dirPath));
    }
  }

  async function previewFile(filePath: string, insertIntoInput: boolean) {
    setSelectedFile(filePath);
    if (insertIntoInput) onInsertPath(filePath);
    await startPreview(filePath);
  }

  async function openFile(filePath: string) {
    await previewFile(filePath, true);
  }

  useEffect(() => {
    if (!requestedPath || previewRequest === undefined) return;
    void previewFile(requestedPath, false);
  }, [requestedPath, previewRequest]);

  function renderEntries(entries: FileEntry[], parent: string, depth: number) {
    return entries.map((entry) => {
      const path = childPath(parent, entry.name);
      if (entry.type === "dir") {
        const isOpen = expanded.has(path);
        return (
          <div key={path} className="file-node" style={{ paddingLeft: depth * 14 }}>
            <button type="button" onClick={() => void toggleDir(path)}>
              <span className="file-chevron">{isOpen ? "▾" : "▸"}</span>
              <FileIcon name={entry.name} isDir />
              <span className="file-label">{entry.name}</span>
            </button>
            {isOpen && dirErrors.has(path) ? (
              <div className="file-tree-error">host unreachable</div>
            ) : null}
            {isOpen && children[path]
              ? renderEntries(children[path], path, depth + 1)
              : null}
          </div>
        );
      }
      return (
        <div key={path} className="file-node" style={{ paddingLeft: depth * 14 }}>
          <button
            type="button"
            className={selectedFile === path ? "selected" : undefined}
            onClick={() => void openFile(path)}
          >
            <FileIcon name={entry.name} />
            <span className="file-label">{entry.name}</span>
          </button>
        </div>
      );
    });
  }

  if (collapsed) {
    return (
      <aside className="file-pane file-pane--collapsed">
        <button
          type="button"
          className="file-pane-expand"
          title="展开工作空间文件"
          onClick={onToggleCollapse}
        >
          ◧
        </button>
      </aside>
    );
  }

  return (
    <aside className="file-pane">
      <header className="file-pane-header">
        <h3 className="file-pane-title">工作空间文件</h3>
        {onToggleCollapse ? (
          <button
            type="button"
            className="icon-btn"
            title="收起面板"
            onClick={onToggleCollapse}
          >
            ◨
          </button>
        ) : null}
      </header>
      <div className="side-tabs">
        <button
          type="button"
          className={tab === "files" ? "active" : undefined}
          onClick={() => setTab("files")}
        >
          文件
        </button>
        <button
          type="button"
          className={tab === "knowledge" ? "active" : undefined}
          onClick={() => setTab("knowledge")}
        >
          知识库
        </button>
      </div>
      {tab === "files" ? (
        <>
          <div className="file-tree">
            {treeError ? (
              <div className="file-tree-error">host unreachable</div>
            ) : (
              renderEntries(rootEntries, ".", 0)
            )}
          </div>
          {previewKind === "svg" && !previewError ? (
            <div className="file-preview file-preview-svg">
              <img
                alt={selectedFile ?? ""}
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(previewText)}`}
              />
            </div>
          ) : (
            <pre className="file-preview">
              {previewError ? "host unreachable" : previewText}
            </pre>
          )}
        </>
      ) : (
        <KnowledgePane selectedPath={selectedFile} />
      )}
    </aside>
  );
}
