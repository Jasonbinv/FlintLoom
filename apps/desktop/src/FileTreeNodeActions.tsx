import type { ReactNode } from "react";
import { MenuIcons } from "./FileTreeMenuIcons.tsx";

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
  onQuoteFile?: (node: FileTreeNode) => void;
  onToggleFolder?: (node: FileTreeNode) => void;
  onCreateFile?: (node: FileTreeNode) => void;
  onCreateFolder?: (node: FileTreeNode) => void;
  onRename?: (node: FileTreeNode) => void;
  onMove?: (node: FileTreeNode) => void;
  onDelete?: (node: FileTreeNode) => void;
  onRefresh?: (node: FileTreeNode) => void;
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
  icon,
  className,
  onClick,
  children,
}: {
  icon: ReactNode;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" role="menuitem" className={className} onClick={onClick}>
      <span className="file-tree-context-menu__item">
        <span className="file-tree-context-menu__icon" aria-hidden>
          {icon}
        </span>
        <span className="file-tree-context-menu__label">{children}</span>
      </span>
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
            icon={MenuIcons.expandAll}
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
            icon={MenuIcons.collapseAll}
            onClick={() => {
              onClose?.();
              actions.onCollapseAllFolders?.();
            }}
          >
            全部收起
          </MenuButton>
        ) : null}
        {!node.isRoot ? (
          <MenuButton
            icon={folderExpanded ? MenuIcons.collapse : MenuIcons.expand}
            onClick={closeAnd(actions.onToggleFolder)}
          >
            {folderExpanded ? "收起" : "展开"}
          </MenuButton>
        ) : null}
        {actions.onRefresh ? (
          <MenuButton icon={MenuIcons.refresh} onClick={closeAnd(actions.onRefresh)}>
            刷新
          </MenuButton>
        ) : null}
        {actions.onCreateFile ? (
          <MenuButton icon={MenuIcons.filePlus} onClick={closeAnd(actions.onCreateFile)}>
            新建文件
          </MenuButton>
        ) : null}
        {actions.onCreateFolder ? (
          <MenuButton
            icon={MenuIcons.folderPlus}
            onClick={closeAnd(actions.onCreateFolder)}
          >
            {node.isRoot ? "新建文件夹" : "新建子文件夹"}
          </MenuButton>
        ) : null}
        {!node.isRoot && actions.onRename ? (
          <MenuButton icon={MenuIcons.pencil} onClick={closeAnd(actions.onRename)}>
            重命名
          </MenuButton>
        ) : null}
        {!node.isRoot && actions.onMove ? (
          <MenuButton icon={MenuIcons.folderMove} onClick={closeAnd(actions.onMove)}>
            移动到文件夹
          </MenuButton>
        ) : null}
        {!node.isRoot && actions.onDelete ? (
          <MenuButton
            icon={MenuIcons.trash}
            className="danger"
            onClick={closeAnd(actions.onDelete)}
          >
            删除
          </MenuButton>
        ) : null}
      </>
    );
  }

  return (
    <>
      {actions.onOpenFile ? (
        <MenuButton icon={MenuIcons.eye} onClick={closeAnd(actions.onOpenFile)}>
          打开预览
        </MenuButton>
      ) : null}
      {actions.onQuoteFile ? (
        <MenuButton icon={MenuIcons.quote} onClick={closeAnd(actions.onQuoteFile)}>
          引用到对话
        </MenuButton>
      ) : null}
      {actions.onRename ? (
        <MenuButton icon={MenuIcons.pencil} onClick={closeAnd(actions.onRename)}>
          重命名
        </MenuButton>
      ) : null}
      {actions.onMove ? (
        <MenuButton icon={MenuIcons.folderMove} onClick={closeAnd(actions.onMove)}>
          移动到文件夹
        </MenuButton>
      ) : null}
      {actions.onDelete ? (
        <MenuButton
          icon={MenuIcons.trash}
          className="danger"
          onClick={closeAnd(actions.onDelete)}
        >
          删除
        </MenuButton>
      ) : null}
    </>
  );
}
