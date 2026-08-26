import { useEffect, useRef, useState, type MouseEvent } from "react";
import { FileActionDialog } from "./FileActionDialog.tsx";
import { FileIcon } from "./FileIcon.tsx";
import { FileMoveDialog } from "./FileMoveDialog.tsx";
import { FilePaneResizeHandle } from "./FilePaneResizeHandle.tsx";
import { FilePreviewContent } from "./FilePreviewContent.tsx";
import { FileTreeContextMenu } from "./FileTreeContextMenu.tsx";
import {
  FileTreeNodeActionMenu,
  WORKSPACE_ROOT_NODE,
  type FileTreeNode,
  type FileTreeNodeMenuActions,
} from "./FileTreeNodeActions.tsx";
import { KnowledgePane } from "./KnowledgePane.tsx";
import { useFilePaneTreeResize } from "./useFilePaneTreeResize.ts";
import {
  childPath,
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspaceEntry,
  fetchFiles,
  fetchPreview,
  buildFileMoveTargets,
  isValidEntryName,
  parentPath,
  renameWorkspaceEntry,
  type FileEntry,
  type FileMoveTarget,
  type FilePreview,
} from "./files.ts";

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
  const [previewKind, setPreviewKind] = useState<FilePreview["kind"]>("text");
  const [previewError, setPreviewError] = useState(false);
  const previewAc = useRef<AbortController | undefined>(undefined);
  const filePaneBodyRef = useRef<HTMLDivElement>(null);
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

  async function reloadDir(dirPath: string) {
    const list = await fetchFiles(dirPath);
    if (dirPath === ROOT_TREE_PATH) {
      setRootEntries(list.entries);
      return;
    }
    setChildren((prev) => ({ ...prev, [dirPath]: list.entries }));
  }

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
    onToggleFolder: (node) => {
      void toggleDir(node.path);
    },
    onCreateFile: startCreateFile,
    onCreateFolder: startCreateFolder,
    onRename: startRename,
    onMove: startMove,
    onDelete: startDelete,
    onExpandAllFolders: () => {
      void expandAllFolders();
    },
    onCollapseAllFolders: collapseAllFolders,
  };

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
          <div
            className="file-tree-surface"
            style={{ width: `${treeWidth}px` }}
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
  );
}
