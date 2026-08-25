import { useEffect, useRef, useState } from "react";
import {
  childPath,
  fetchFiles,
  fetchPreview,
  type FileEntry,
} from "./files.ts";
import { FileIcon } from "./FileIcon.tsx";
import { FilePaneResizeHandle } from "./FilePaneResizeHandle.tsx";
import { FilePreviewContent } from "./FilePreviewContent.tsx";
import { KnowledgePane } from "./KnowledgePane.tsx";
import { useFilePaneTreeResize } from "./useFilePaneTreeResize.ts";

const TREE_INDENT_PX = 16;
const TREE_BASE_INDENT_PX = 12;
const ROOT_TREE_PATH = ".";

function sortFileEntries(entries: FileEntry[]): FileEntry[] {
  const dirs = entries
    .filter((entry) => entry.type === "dir")
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = entries
    .filter((entry) => entry.type === "file")
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...dirs, ...files];
}

function treeIndent(depth: number): number {
  return TREE_BASE_INDENT_PX + depth * TREE_INDENT_PX;
}

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
    "markdown" | "text" | "failed" | "svg" | "spreadsheet" | "pdf" | "docx" | "pptx"
  >("text");
  const [previewError, setPreviewError] = useState(false);
  const previewAc = useRef<AbortController | undefined>(undefined);
  const filePaneBodyRef = useRef<HTMLDivElement>(null);
  const {
    width: treeWidth,
    dragging: treeDragging,
    onHandlePointerDown: onTreeHandlePointerDown,
    onHandlePointerMove: onTreeHandlePointerMove,
    onHandlePointerUp: onTreeHandlePointerUp,
    onHandlePointerCancel: onTreeHandlePointerCancel,
  } = useFilePaneTreeResize({
    bodyRef: filePaneBodyRef,
    enabled: tab === "files",
  });

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

  async function loadDirChildren(dirPath: string, signal?: AbortSignal) {
    const list = await fetchFiles(dirPath, signal);
    setChildren((prev) => ({ ...prev, [dirPath]: list.entries }));
    setDirErrors((prev) => {
      if (!prev.has(dirPath)) return prev;
      const cleared = new Set(prev);
      cleared.delete(dirPath);
      return cleared;
    });
    return list.entries;
  }

  useEffect(() => {
    const ac = new AbortController();
    void fetchFiles(ROOT_TREE_PATH, ac.signal)
      .then(async (list) => {
        if (ac.signal.aborted) return;
        setRootEntries(list.entries);
        setTreeError(false);
        setExpanded(new Set([ROOT_TREE_PATH]));

        const firstFile = list.entries.find((e) => e.type === "file");
        if (firstFile) {
          const firstPath = childPath(ROOT_TREE_PATH, firstFile.name);
          setSelectedFile(firstPath);
          await startPreview(firstPath);
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
      await loadDirChildren(dirPath);
    } catch {
      setDirErrors((prev) => new Set(prev).add(dirPath));
    }
  }

  async function ensureDirExpanded(dirPath: string) {
    setExpanded((prev) => {
      if (prev.has(dirPath)) return prev;
      const next = new Set(prev);
      next.add(dirPath);
      return next;
    });
    if (children[dirPath]) return;
    await loadDirChildren(dirPath);
  }

  async function revealPath(filePath: string) {
    const normalized = filePath.replaceAll("\\", "/");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length === 0) return;
    let parent = ".";
    for (let i = 0; i < parts.length - 1; i++) {
      parent = childPath(parent, parts[i]!);
      await ensureDirExpanded(parent);
    }
    setSelectedFile(normalized);
  }

  async function previewFile(filePath: string, insertIntoInput: boolean) {
    setTab("files");
    await revealPath(filePath);
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
    return sortFileEntries(entries).map((entry) => {
      const path = childPath(parent, entry.name);
      const indent = treeIndent(depth);

      if (entry.type === "dir") {
        const isOpen = expanded.has(path);
        return (
          <div key={path} className="file-tree__node" role="none">
            <button
              type="button"
              role="treeitem"
              aria-expanded={isOpen}
              className="file-tree__row file-tree__row--folder"
              style={{ ["--file-tree-indent" as string]: `${indent}px` }}
              onClick={() => void toggleDir(path)}
            >
              <span className="file-tree__lead">
                <span className="file-tree__chevron" aria-hidden>
                  {isOpen ? "▾" : "▸"}
                </span>
                <FileIcon name={entry.name} isDir />
                <span className="file-tree__name file-label">{entry.name}</span>
              </span>
            </button>
            {isOpen && dirErrors.has(path) ? (
              <div
                className="file-tree__state file-tree__state--error"
                style={{ paddingLeft: `${treeIndent(depth + 1)}px` }}
              >
                host unreachable
              </div>
            ) : null}
            {isOpen && children[path] ? (
              <div
                className="file-tree__children"
                role="group"
                style={{ ["--file-tree-indent" as string]: `${indent}px` }}
              >
                {renderEntries(children[path], path, depth + 1)}
              </div>
            ) : null}
          </div>
        );
      }

      const isActive = selectedFile === path;
      return (
        <div key={path} className="file-tree__node" role="none">
          <button
            type="button"
            role="treeitem"
            aria-selected={isActive}
            className={`file-tree__row${isActive ? " file-tree__row--active" : ""}`}
            style={{ ["--file-tree-indent" as string]: `${indent}px` }}
            onClick={() => void openFile(path)}
          >
            <span className="file-tree__lead">
              <span
                className="file-tree__chevron file-tree__chevron--spacer"
                aria-hidden
              />
              <FileIcon name={entry.name} />
              <span className="file-tree__name file-label">{entry.name}</span>
            </span>
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
        <div
          className={`file-pane-body${treeDragging ? " file-pane-body--dragging" : ""}`}
          ref={filePaneBodyRef}
        >
          {treeDragging ? <div className="file-pane-inner-drag-overlay" /> : null}
          <div className="file-tree-surface" style={{ width: `${treeWidth}px` }}>
            <div className="file-tree" role="tree" aria-label="工作空间文件">
              {treeError ? (
                <div className="file-tree__state file-tree__state--error">
                  host unreachable
                </div>
              ) : (
                <>
                  <div className="file-tree__node" role="none">
                    <button
                      type="button"
                      role="treeitem"
                      aria-expanded={expanded.has(ROOT_TREE_PATH)}
                      className="file-tree__row file-tree__row--root"
                      style={{
                        ["--file-tree-indent" as string]: `${treeIndent(0)}px`,
                      }}
                      onClick={() => {
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(ROOT_TREE_PATH)) {
                            next.delete(ROOT_TREE_PATH);
                          } else {
                            next.add(ROOT_TREE_PATH);
                          }
                          return next;
                        });
                      }}
                    >
                      <span className="file-tree__lead">
                        <span className="file-tree__chevron" aria-hidden>
                          {expanded.has(ROOT_TREE_PATH) ? "▾" : "▸"}
                        </span>
                        <FileIcon name="workspace" isDir />
                        <span className="file-tree__name file-label">工作空间</span>
                      </span>
                    </button>
                    {expanded.has(ROOT_TREE_PATH) ? (
                      <div
                        className="file-tree__children"
                        role="group"
                        style={{
                          ["--file-tree-indent" as string]: `${treeIndent(0)}px`,
                        }}
                      >
                        {rootEntries.length === 0 ? (
                          <div
                            className="file-tree__state"
                            style={{ paddingLeft: `${treeIndent(1)}px` }}
                          >
                            暂无文件
                          </div>
                        ) : (
                          renderEntries(rootEntries, ROOT_TREE_PATH, 1)
                        )}
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="file-pane-inner-split-rail">
            <FilePaneResizeHandle
              className="file-pane-inner-split-handle"
              ariaLabel="调整目录树宽度"
              onPointerDown={onTreeHandlePointerDown}
              onPointerMove={onTreeHandlePointerMove}
              onPointerUp={onTreeHandlePointerUp}
              onPointerCancel={onTreeHandlePointerCancel}
            />
          </div>
          <div className="file-preview-surface">
            {previewKind === "svg" && !previewError ? (
              <div className="file-preview file-preview-svg">
                <header className="file-preview-header">
                  <span className="file-preview-header__name">
                    {selectedFile ? selectedFile.split("/").pop() : "预览"}
                  </span>
                  <span className="file-preview-header__badge">SVG</span>
                </header>
                <div className="file-preview-svg__frame">
                  <img
                    alt={selectedFile ?? ""}
                    src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(previewText)}`}
                  />
                </div>
              </div>
            ) : (
              <FilePreviewContent
                filePath={selectedFile}
                kind={previewError ? "error" : previewKind}
                text={previewError ? "host unreachable" : previewText}
              />
            )}
          </div>
        </div>
      ) : (
        <KnowledgePane selectedPath={selectedFile} />
      )}
    </aside>
  );
}
