import type { ReactNode } from "react";

export type FileTreeNode = {
  path: string;
  name: string;
  type: "file" | "dir";
  isRoot?: boolean;
};

export const WORKSPACE_ROOT_NODE: FileTreeNode = {
  path: ".",
  name: "工作空间",
  type: "dir",
  isRoot: true,
};

export type FileTreeNodeMenuActions = {
  onOpenFile?: (node: FileTreeNode) => void;
  onToggleFolder?: (node: FileTreeNode) => void;
  onCreateFile?: (node: FileTreeNode) => void;
  onCreateFolder?: (node: FileTreeNode) => void;
  onRename?: (node: FileTreeNode) => void;
  onMove?: (node: FileTreeNode) => void;
  onDelete?: (node: FileTreeNode) => void;
  onExpandAllFolders?: () => void;
  onCollapseAllFolders?: () => void;
};

type Props = {
  node: FileTreeNode;
  folderExpanded?: boolean;
  actions: FileTreeNodeMenuActions;
  onClose?: () => void;
};

function MenuButton({
  className,
  onClick,
  children,
}: {
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" role="menuitem" className={className} onClick={onClick}>
      {children}
    </button>
  );
}

export function FileTreeNodeActionMenu({
  node,
  folderExpanded = false,
  actions,
  onClose,
}: Props) {
  const closeAnd = (fn?: (node: FileTreeNode) => void) => () => {
    onClose?.();
    fn?.(node);
  };

  if (node.type === "dir") {
    return (
      <>
        {node.isRoot && actions.onExpandAllFolders ? (
          <MenuButton
            onClick={() => {
              onClose?.();
              actions.onExpandAllFolders?.();
            }}
          >
            全部展开
          </MenuButton>
        ) : null}
        {node.isRoot && actions.onCollapseAllFolders ? (
          <MenuButton
            onClick={() => {
              onClose?.();
              actions.onCollapseAllFolders?.();
            }}
          >
            全部收起
          </MenuButton>
        ) : null}
        {!node.isRoot ? (
          <MenuButton onClick={closeAnd(actions.onToggleFolder)}>
            {folderExpanded ? "收起" : "展开"}
          </MenuButton>
        ) : null}
        {actions.onCreateFile ? (
          <MenuButton onClick={closeAnd(actions.onCreateFile)}>新建文件</MenuButton>
        ) : null}
        {actions.onCreateFolder ? (
          <MenuButton onClick={closeAnd(actions.onCreateFolder)}>
            {node.isRoot ? "新建文件夹" : "新建子文件夹"}
          </MenuButton>
        ) : null}
        {!node.isRoot && actions.onRename ? (
          <MenuButton onClick={closeAnd(actions.onRename)}>重命名</MenuButton>
        ) : null}
        {!node.isRoot && actions.onMove ? (
          <MenuButton onClick={closeAnd(actions.onMove)}>移动到文件夹</MenuButton>
        ) : null}
        {!node.isRoot && actions.onDelete ? (
          <MenuButton className="danger" onClick={closeAnd(actions.onDelete)}>
            删除
          </MenuButton>
        ) : null}
      </>
    );
  }

  return (
    <>
      {actions.onOpenFile ? (
        <MenuButton onClick={closeAnd(actions.onOpenFile)}>打开预览</MenuButton>
      ) : null}
      {actions.onRename ? (
        <MenuButton onClick={closeAnd(actions.onRename)}>重命名</MenuButton>
      ) : null}
      {actions.onMove ? (
        <MenuButton onClick={closeAnd(actions.onMove)}>移动到文件夹</MenuButton>
      ) : null}
      {actions.onDelete ? (
        <MenuButton className="danger" onClick={closeAnd(actions.onDelete)}>
          删除
        </MenuButton>
      ) : null}
    </>
  );
}
