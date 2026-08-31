import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { FileActionDialog } from "./FileActionDialog.tsx";
import { FileIcon } from "./FileIcon.tsx";
import { FileMoveDialog } from "./FileMoveDialog.tsx";
import { FilePaneResizeHandle } from "./FilePaneResizeHandle.tsx";
import {
  FilePreviewCloseButton,
  FilePreviewContent,
  FilePreviewFullscreenButton,
} from "./FilePreviewContent.tsx";
import { FileTreeContextMenu } from "./FileTreeContextMenu.tsx";
import {
  FileTreeNodeActionMenu,
  WORKSPACE_ROOT_NODE,
  type FileTreeNode,
  type FileTreeNodeMenuActions,
} from "./FileTreeNodeActions.tsx";
import { KnowledgePane } from "./KnowledgePane.tsx";
import { filePreviewExtraWidth } from "./filePanePreviewWidth.ts";
import { useFilePanePreviewResize } from "./useFilePanePreviewResize.ts";
import {
  childPath,
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspaceEntry,
  fetchFiles,
  fetchFilesSync,
  fetchPreview,
  buildFileMoveTargets,
  isImageFilePath,
  isValidEntryName,
  parentPath,
  renameWorkspaceEntry,
  type FileEntry,
  type FileMoveTarget,
  type FilePreview,
} from "./files.ts";

const ROOT_TREE_PATH = ".";

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function sortFileEntries(entries: FileEntry[]): FileEntry[] {
  const dirs = entries
    .filter((entry) => entry.type === "dir")
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = entries
    .filter((entry) => entry.type === "file")
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...dirs, ...files];
}

type Props = {
  onInsertPath: (path: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  requestedPath?: string;
  previewRequest?: number;
  treeWidth?: number;
  stageRef?: RefObject<HTMLElement | null>;
  onPreviewExtraWidthChange?: (extraWidth: number) => void;
};

export function FilePane({
  onInsertPath,
  collapsed,
  onToggleCollapse,
  requestedPath,
  previewRequest,
  treeWidth = 0,
  stageRef,
  onPreviewExtraWidthChange,
}: Props) {
  const [tab, setTab] = useState<"files" | "knowledge">("files");
  const [selectedFile, setSelectedFile] = useState<string>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({});
  const [treeError, setTreeError] = useState(false);
  const [dirErrors, setDirErrors] = useState<Set<string>>(() => new Set());
  const [previewText, setPreviewText] = useState("");
  const [previewKind, setPreviewKind] = useState<FilePreview["kind"]>("text");
  const [previewError, setPreviewError] = useState(false);
  const [previewErrorText, setPreviewErrorText] = useState("host unreachable");
  const [previewNonce, setPreviewNonce] = useState(0);
  const previewAc = useRef<AbortController | undefined>(undefined);
  const fallbackStageRef = useRef<HTMLDivElement>(null);
  const previewStageRef = stageRef ?? fallbackStageRef;
  const dockedPreview =
    tab === "files" && previewOpen && !collapsed;
  const {
    width: previewWidth,
    dragging: previewDragging,
    onHandlePointerDown: onPreviewHandlePointerDown,
    onHandlePointerMove: onPreviewHandlePointerMove,
    onHandlePointerUp: onPreviewHandlePointerUp,
    onHandlePointerCancel: onPreviewHandlePointerCancel,
  } = useFilePanePreviewResize({
    stageRef: previewStageRef,
    treeWidth,
    enabled: dockedPreview,
  });
  const [treeContextMenu, setTreeContextMenu] = useState<{
    node: FileTreeNode;
    x: number;
    y: number;
  } | null>(null);
  const [fileAction, setFileAction] = useState<
    | { kind: "create-file"; parent: string }
    | { kind: "create-dir"; parent: string }
    | { kind: "rename"; node: FileTreeNode }
    | { kind: "move"; node: FileTreeNode; targets: FileMoveTarget[] }
    | { kind: "delete"; node: FileTreeNode }
    | null
  >(null);
  const [fileActionName, setFileActionName] = useState("");
  const [fileActionError, setFileActionError] = useState<string>();

  const closeFilePreview = useCallback(() => {
    previewAc.current?.abort();
    setPreviewOpen(false);
    setPreviewFullscreen(false);
    setSelectedFile(undefined);
    setPreviewText("");
    setPreviewKind("text");
    setPreviewError(false);
    setPreviewErrorText("host unreachable");
  }, []);

  useLayoutEffect(() => {
    onPreviewExtraWidthChange?.(
      filePreviewExtraWidth(dockedPreview, previewWidth),
    );
  }, [dockedPreview, onPreviewExtraWidthChange, previewWidth]);

  useEffect(() => {
    return () => onPreviewExtraWidthChange?.(0);
  }, [onPreviewExtraWidthChange]);

  useEffect(() => {
    if (!previewOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (previewFullscreen) {
        setPreviewFullscreen(false);
        return;
      }
      closeFilePreview();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeFilePreview, previewFullscreen, previewOpen]);

  async function loadPreview(filePath: string, signal: AbortSignal) {
    const imageFile = isImageFilePath(filePath);
    if (imageFile) {
      setPreviewKind("image");
      setPreviewText("");
      setPreviewError(false);
    }
    try {
      const preview = await fetchPreview(filePath, signal);
      if (signal.aborted) return;
      setPreviewKind(preview.kind);
      setPreviewText(preview.text);
      setPreviewError(false);
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (imageFile) return;
      setPreviewError(true);
      setPreviewErrorText(
        err instanceof Error ? err.message : "host unreachable",
      );
    }
  }

  function startPreview(filePath: string) {
    previewAc.current?.abort();
    const ac = new AbortController();
    previewAc.current = ac;
    setPreviewNonce((n) => n + 1);
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
      .then((list) => {
        if (ac.signal.aborted) return;
        setRootEntries(list.entries);
        setTreeError(false);
        setExpanded(new Set([ROOT_TREE_PATH]));
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
    try {
      await reloadDir(ROOT_TREE_PATH);
    } catch {
      setTreeError(true);
    }
    let parent = ".";
    for (let i = 0; i < parts.length - 1; i++) {
      parent = childPath(parent, parts[i]!);
      await ensureDirExpanded(parent);
      try {
        await reloadDir(parent);
      } catch {
        setDirErrors((prev) => new Set(prev).add(parent));
      }
    }
    setSelectedFile(normalized);
  }

  async function previewFile(filePath: string, insertIntoInput: boolean) {
    setTab("files");
    await revealPath(filePath);
    if (insertIntoInput) onInsertPath(filePath);
    setPreviewOpen(true);
    await startPreview(filePath);
  }

  async function openFile(filePath: string) {
    await previewFile(filePath, false);
  }

  function quoteFile(filePath: string) {
    onInsertPath(filePath);
  }

  async function reloadDir(dirPath: string) {
    const list = await fetchFiles(dirPath);
    if (dirPath === ROOT_TREE_PATH) {
      setRootEntries(list.entries);
    } else {
      setChildren((prev) => ({ ...prev, [dirPath]: list.entries }));
    }
    setDirErrors((prev) => {
      if (!prev.has(dirPath)) return prev;
      const next = new Set(prev);
      next.delete(dirPath);
      return next;
    });
  }

  async function refreshTree() {
    try {
      await reloadDir(ROOT_TREE_PATH);
      setTreeError(false);
      const dirs = [...expanded].filter((path) => path !== ROOT_TREE_PATH);
      await Promise.all(
        dirs.map(async (dirPath) => {
          try {
            await reloadDir(dirPath);
          } catch {
            setDirErrors((prev) => new Set(prev).add(dirPath));
          }
        }),
      );
      if (selectedFile) {
        await startPreview(selectedFile);
      }
    } catch {
      setTreeError(true);
    }
  }

  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const selectedFileRef = useRef(selectedFile);
  selectedFileRef.current = selectedFile;
  const refreshTreeRef = useRef(refreshTree);
  refreshTreeRef.current = refreshTree;
  const reloadDirRef = useRef(reloadDir);
  reloadDirRef.current = reloadDir;
  const startPreviewRef = useRef(startPreview);
  startPreviewRef.current = startPreview;

  useEffect(() => {
    const ac = new AbortController();
    let generation = 0;

    async function loop() {
      while (!ac.signal.aborted) {
        try {
          const sync = await fetchFilesSync(generation, ac.signal);
          if (ac.signal.aborted) return;
          const isCatchUp =
            generation !== sync.generation &&
            sync.files.length === 0 &&
            sync.dirs.length === 1 &&
            sync.dirs[0] === ".";
          generation = sync.generation;
          if (isCatchUp) {
            await refreshTreeRef.current();
            continue;
          }
          if (sync.dirs.length === 0 && sync.files.length === 0) {
            continue;
          }
          const expandedNow = expandedRef.current;
          for (const dir of sync.dirs) {
            if (dir === ROOT_TREE_PATH || expandedNow.has(dir)) {
              try {
                await reloadDirRef.current(dir);
                if (dir === ROOT_TREE_PATH) setTreeError(false);
              } catch {
                if (dir === ROOT_TREE_PATH) setTreeError(true);
                else {
                  setDirErrors((prev) => new Set(prev).add(dir));
                }
              }
            }
          }
          const selected = selectedFileRef.current;
          if (selected && sync.files.includes(selected)) {
            await startPreviewRef.current(selected);
          }
        } catch (err) {
          if (ac.signal.aborted) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (err instanceof Error && err.name === "AbortError") return;
          try {
            await delay(1000, ac.signal);
          } catch {
            return;
          }
        }
      }
    }

    void loop();
    return () => {
      ac.abort();
    };
  }, []);

  function closeTreeMenu() {
    setTreeContextMenu(null);
  }

  function isTreeRowTarget(target: EventTarget | null): boolean {
    return Boolean((target as HTMLElement | null)?.closest(".file-tree__row"));
  }

  function openNodeMenu(node: FileTreeNode, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setTreeContextMenu({ node, x: event.clientX, y: event.clientY });
  }

  async function expandAllFolders() {
    const nextExpanded = new Set(expanded);
    const nextChildren: Record<string, FileEntry[]> = { ...children };
    async function walk(dirPath: string, entries: FileEntry[]) {
      nextExpanded.add(dirPath);
      for (const entry of entries) {
        if (entry.type !== "dir") continue;
        const path = childPath(dirPath, entry.name);
        if (!nextChildren[path]) {
          try {
            const list = await fetchFiles(path);
            nextChildren[path] = list.entries;
          } catch {
            setDirErrors((prev) => new Set(prev).add(path));
            continue;
          }
        }
        await walk(path, nextChildren[path] ?? []);
      }
    }
    await walk(ROOT_TREE_PATH, rootEntries);
    setExpanded(nextExpanded);
    setChildren(nextChildren);
  }

  function collapseAllFolders() {
    setExpanded(new Set([ROOT_TREE_PATH]));
  }

  function startCreateFile(node: FileTreeNode) {
    setFileAction({ kind: "create-file", parent: node.path });
    setFileActionName("");
    setFileActionError(undefined);
  }

  function startCreateFolder(node: FileTreeNode) {
    setFileAction({ kind: "create-dir", parent: node.path });
    setFileActionName("");
    setFileActionError(undefined);
  }

  function startRename(node: FileTreeNode) {
    setFileAction({ kind: "rename", node });
    setFileActionName(node.name);
    setFileActionError(undefined);
  }

  function startDelete(node: FileTreeNode) {
    setFileAction({ kind: "delete", node });
    setFileActionError(undefined);
  }

  async function collectDirectoryTargets(): Promise<FileMoveTarget[]> {
    const dirs: FileMoveTarget[] = [{ path: ROOT_TREE_PATH, label: "工作空间" }];
    const nextChildren: Record<string, FileEntry[]> = { ...children };
    async function walk(dirPath: string, entries: FileEntry[], prefix: string) {
      for (const entry of sortFileEntries(entries)) {
        if (entry.type !== "dir") continue;
        const path = childPath(dirPath, entry.name);
        const label = prefix ? `${prefix}/${entry.name}` : entry.name;
        dirs.push({ path, label });
        if (!nextChildren[path]) {
          try {
            const list = await fetchFiles(path);
            nextChildren[path] = list.entries;
          } catch {
            continue;
          }
        }
        await walk(path, nextChildren[path] ?? [], label);
      }
    }
    await walk(ROOT_TREE_PATH, rootEntries, "");
    setChildren(nextChildren);
    return dirs;
  }

  function startMove(node: FileTreeNode) {
    void collectDirectoryTargets().then((directories) => {
      setFileAction({
        kind: "move",
        node,
        targets: buildFileMoveTargets(node.path, node.type === "dir", directories),
      });
      setFileActionError(undefined);
    });
  }

  function dropSubtree(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const item of next) {
        if (item === path || item.startsWith(`${path}/`)) next.delete(item);
      }
      return next;
    });
    setChildren((prev) => {
      const next = { ...prev };
      for (const item of Object.keys(next)) {
        if (item === path || item.startsWith(`${path}/`)) delete next[item];
      }
      return next;
    });
  }

  async function submitMove(dest: string) {
    if (fileAction?.kind !== "move") return;
    const node = fileAction.node;
    const to = childPath(dest, node.name);
    try {
      await renameWorkspaceEntry(node.path, to);
      if (selectedFile && pathIsInside(node.path, selectedFile)) {
        const suffix = selectedFile.slice(node.path.length);
        setSelectedFile(`${to}${suffix}`);
      }
      if (node.type === "dir") dropSubtree(node.path);
      await reloadDir(parentPath(node.path));
      await reloadDir(dest);
      if (dest !== ROOT_TREE_PATH) {
        await ensureDirExpanded(dest);
      }
      setFileAction(null);
    } catch (err) {
      setFileActionError(
        err instanceof Error && err.message === "exists"
          ? "目标文件夹中已存在同名文件或文件夹"
          : "移动失败",
      );
    }
  }

  function pathIsInside(parent: string, target: string): boolean {
    if (parent === ROOT_TREE_PATH) return true;
    return target === parent || target.startsWith(`${parent}/`);
  }

  async function submitFileAction() {
    if (!fileAction) return;
    try {
      if (fileAction.kind === "delete") {
        await deleteWorkspaceEntry(fileAction.node.path);
        if (selectedFile && pathIsInside(fileAction.node.path, selectedFile)) {
          setSelectedFile(undefined);
          setPreviewOpen(false);
          setPreviewText("");
          setPreviewKind("text");
        }
        await reloadDir(parentPath(fileAction.node.path));
        setFileAction(null);
        return;
      }

      const name = fileActionName.trim();
      if (!isValidEntryName(name)) {
        setFileActionError("名称无效");
        return;
      }

      if (fileAction.kind === "create-file") {
        const path = childPath(fileAction.parent, name);
        await createWorkspaceFile(path);
        await reloadDir(fileAction.parent);
        if (fileAction.parent !== ROOT_TREE_PATH) {
          await ensureDirExpanded(fileAction.parent);
        }
        setFileAction(null);
        return;
      }

      if (fileAction.kind === "create-dir") {
        const path = childPath(fileAction.parent, name);
        await createWorkspaceDirectory(path);
        await reloadDir(fileAction.parent);
        if (fileAction.parent !== ROOT_TREE_PATH) {
          await ensureDirExpanded(fileAction.parent);
        }
        setFileAction(null);
        return;
      }

      const to = childPath(parentPath(fileAction.node.path), name);
      await renameWorkspaceEntry(fileAction.node.path, to);
      if (selectedFile && pathIsInside(fileAction.node.path, selectedFile)) {
        const suffix = selectedFile.slice(fileAction.node.path.length);
        setSelectedFile(`${to}${suffix}`);
      }
      await reloadDir(parentPath(fileAction.node.path));
      setFileAction(null);
    } catch (err) {
      setFileActionError(
        err instanceof Error && err.message === "exists"
          ? "已存在同名文件或文件夹"
          : "操作失败",
      );
    }
  }

  const treeMenuActions: FileTreeNodeMenuActions = {
    onOpenFile: (node) => {
      void previewFile(node.path, false);
    },
    onQuoteFile: (node) => {
      quoteFile(node.path);
    },
    onToggleFolder: (node) => {
      void toggleDir(node.path);
    },
    onCreateFile: startCreateFile,
    onCreateFolder: startCreateFolder,
    onRename: startRename,
    onMove: startMove,
    onDelete: startDelete,
    onRefresh: (node) => {
      if (node.isRoot) {
        void refreshTree();
        return;
      }
      void reloadDir(node.path).catch(() => {
        setDirErrors((prev) => new Set(prev).add(node.path));
      });
    },
    onExpandAllFolders: () => {
      void expandAllFolders();
    },
    onCollapseAllFolders: collapseAllFolders,
  };

  useEffect(() => {
    if (!requestedPath || previewRequest === undefined) return;
    void previewFile(requestedPath, false);
  }, [requestedPath, previewRequest]);

  function renderEntries(entries: FileEntry[], parent: string) {
    return sortFileEntries(entries).map((entry) => {
      const path = childPath(parent, entry.name);

      if (entry.type === "dir") {
        const isOpen = expanded.has(path);
        return (
          <div key={path} className="file-tree__node" role="none">
            <button
              type="button"
              role="treeitem"
              aria-expanded={isOpen}
              className="file-tree__row file-tree__row--folder"
              onClick={() => void toggleDir(path)}
              onContextMenu={(event) =>
                openNodeMenu({ path, name: entry.name, type: "dir" }, event)
              }
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
              <div className="file-tree__state file-tree__state--error">
                host unreachable
              </div>
            ) : null}
            {isOpen && children[path] ? (
              <div className="file-tree__children" role="group">
                {renderEntries(children[path], path)}
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
            onClick={() => void openFile(path)}
            onContextMenu={(event) =>
              openNodeMenu({ path, name: entry.name, type: "file" }, event)
            }
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

  function togglePreviewFullscreen() {
    setPreviewFullscreen((open) => !open);
  }

  function renderFilePreview() {
    if (previewKind === "svg" && !previewError) {
      return (
        <div className="file-preview file-preview-svg">
          <header className="file-preview-header">
            <span className="file-preview-header__name">
              {selectedFile ? selectedFile.split("/").pop() : "预览"}
            </span>
            <div className="file-preview-header__actions">
              {selectedFile ? (
                <button
                  type="button"
                  className="file-preview-header__action"
                  onClick={() => quoteFile(selectedFile)}
                  title="引用到对话"
                >
                  引用
                </button>
              ) : null}
              <span className="file-preview-header__badge">SVG</span>
              <FilePreviewFullscreenButton
                fullscreen={previewFullscreen}
                onToggleFullscreen={togglePreviewFullscreen}
              />
              <FilePreviewCloseButton onClose={closeFilePreview} />
            </div>
          </header>
          <div className="file-preview-svg__frame">
            <img
              alt={selectedFile ?? ""}
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(previewText)}`}
            />
          </div>
        </div>
      );
    }
    return (
      <FilePreviewContent
        filePath={selectedFile}
        kind={previewError ? "error" : previewKind}
        text={previewError ? previewErrorText : previewText}
        cacheKey={previewNonce}
        onClose={closeFilePreview}
        onQuote={selectedFile ? () => quoteFile(selectedFile) : undefined}
        fullscreen={previewFullscreen}
        onToggleFullscreen={togglePreviewFullscreen}
        onExported={(path) => {
          void previewFile(path, false);
        }}
      />
    );
  }

  const previewSurface = (
    <div className="file-preview-surface">{renderFilePreview()}</div>
  );

  const previewColumn = dockedPreview ? (
    <>
      <div className="file-pane-inner-split-rail">
        <FilePaneResizeHandle
          className="file-pane-inner-split-handle"
          ariaLabel="调整预览宽度"
          title="拖动调整预览宽度"
          orientation="vertical"
          onPointerDown={onPreviewHandlePointerDown}
          onPointerMove={onPreviewHandlePointerMove}
          onPointerUp={onPreviewHandlePointerUp}
          onPointerCancel={onPreviewHandlePointerCancel}
        />
      </div>
      {previewFullscreen ? (
        <div
          className="file-preview-surface file-preview-surface--placeholder"
          aria-hidden
        />
      ) : (
        previewSurface
      )}
    </>
  ) : null;

  const fullscreenPortal =
    dockedPreview && previewFullscreen
      ? createPortal(
          <div
            className="file-preview-fs-root"
            role="dialog"
            aria-modal="true"
            aria-label="全屏预览"
          >
            <button
              type="button"
              className="file-preview-fs-backdrop"
              aria-label="退出全屏"
              onClick={() => setPreviewFullscreen(false)}
            />
            <div className="file-preview-fs-shell">{previewSurface}</div>
          </div>,
          document.body,
        )
      : null;

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
    <div
      className={`file-pane-shell${dockedPreview ? " file-pane-shell--previewing" : ""}${previewDragging ? " file-pane-shell--dragging" : ""}`}
      ref={fallbackStageRef}
      style={
        dockedPreview
          ? ({ "--file-preview-col-width": `${previewWidth}px` } as CSSProperties)
          : undefined
      }
    >
      {previewDragging ? <div className="file-pane-inner-drag-overlay" /> : null}
      <aside className="file-pane">
      <header className="file-pane-header">
        <h3 className="file-pane-title">工作空间文件</h3>
        <div className="file-pane-header-actions">
          <button
            type="button"
            className="icon-btn"
            title="刷新文件列表"
            aria-label="刷新文件"
            onClick={() => void refreshTree()}
          >
            ↻
          </button>
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
        </div>
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
        <div className="file-pane-body file-pane-body--preview-closed">
          <div
            className="file-tree-surface"
            onContextMenu={(event) => {
              if (isTreeRowTarget(event.target)) return;
              event.preventDefault();
              setTreeContextMenu({
                node: WORKSPACE_ROOT_NODE,
                x: event.clientX,
                y: event.clientY,
              });
            }}
          >
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
                      onContextMenu={(event) =>
                        openNodeMenu(WORKSPACE_ROOT_NODE, event)
                      }
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
                      <div className="file-tree__children" role="group">
                        {rootEntries.length === 0 ? (
                          <div className="file-tree__state">暂无文件</div>
                        ) : (
                          renderEntries(rootEntries, ROOT_TREE_PATH)
                        )}
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <KnowledgePane selectedPath={selectedFile} />
      )}
      {treeContextMenu ? (
        <FileTreeContextMenu
          open
          x={treeContextMenu.x}
          y={treeContextMenu.y}
          onClose={closeTreeMenu}
        >
          <FileTreeNodeActionMenu
            node={treeContextMenu.node}
            folderExpanded={expanded.has(treeContextMenu.node.path)}
            actions={treeMenuActions}
            onClose={closeTreeMenu}
          />
        </FileTreeContextMenu>
      ) : null}
      {fileAction?.kind === "move" ? (
        <FileMoveDialog
          targets={fileAction.targets}
          error={fileActionError}
          onPick={(dest) => void submitMove(dest)}
          onCancel={() => setFileAction(null)}
        />
      ) : null}
      {fileAction && fileAction.kind !== "move" ? (
        <FileActionDialog
          title={
            fileAction.kind === "create-file"
              ? "新建文件"
              : fileAction.kind === "create-dir"
                ? "新建文件夹"
                : fileAction.kind === "rename"
                  ? "重命名"
                  : "删除"
          }
          hint={
            fileAction.kind === "delete"
              ? `确定删除「${fileAction.node.name}」？此操作不可撤销。`
              : undefined
          }
          inputLabel={
            fileAction.kind === "delete"
              ? undefined
              : fileAction.kind === "create-file"
                ? "文件名称"
                : "名称"
          }
          inputValue={fileAction.kind === "delete" ? undefined : fileActionName}
          onInputChange={
            fileAction.kind === "delete" ? undefined : setFileActionName
          }
          confirmLabel={
            fileAction.kind === "delete"
              ? "删除"
              : fileAction.kind === "rename"
                ? "确定"
                : "创建"
          }
          danger={fileAction.kind === "delete"}
          error={fileActionError}
          confirmDisabled={
            fileAction.kind !== "delete" && !isValidEntryName(fileActionName)
          }
          onConfirm={() => void submitFileAction()}
          onCancel={() => setFileAction(null)}
        />
      ) : null}
      </aside>
      {previewColumn}
      {fullscreenPortal}
    </div>
  );
}
