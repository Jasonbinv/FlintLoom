import type { FileMoveTarget } from "./files.ts";

type Props = {
  targets: FileMoveTarget[];
  error?: string;
  onPick: (path: string) => void;
  onCancel: () => void;
};

export function FileMoveDialog({ targets, error, onPick, onCancel }: Props) {
  return (
    <div className="workspace-dialog-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="workspace-dialog file-action-dialog file-move-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-move-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="file-move-dialog-title" className="workspace-dialog-title">
          移动到文件夹
        </h2>
        <p className="workspace-dialog-hint">选择目标文件夹</p>
        {targets.length === 0 ? (
          <p className="workspace-dialog-hint">没有可移动到的文件夹</p>
        ) : (
          <ul className="file-move-dialog__list">
            {targets.map((target) => (
              <li key={target.path}>
                <button type="button" onClick={() => onPick(target.path)}>
                  📁 {target.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error ? <p className="file-action-dialog__error">{error}</p> : null}
        <div className="workspace-dialog-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
