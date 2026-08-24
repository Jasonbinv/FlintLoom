import { useEffect, useRef, useState } from "react";
import {
  browseWorkspaceFolder,
  normalizeWorkspaceInput,
} from "./workspacePicker.ts";

type Props = {
  initialPath?: string;
  recentPaths?: string[];
  onConfirm: (path: string) => void;
  onCancel: () => void;
};

export function WorkspacePathDialog({
  initialPath = "",
  recentPaths = [],
  onConfirm,
  onCancel,
}: Props) {
  const [value, setValue] = useState(initialPath);
  const [browsing, setBrowsing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function submit() {
    const normalized = normalizeWorkspaceInput(value);
    if (normalized === undefined) return;
    onConfirm(normalized);
  }

  async function browse() {
    setBrowsing(true);
    try {
      const picked = await browseWorkspaceFolder(value || initialPath);
      if (picked === undefined) return;
      setValue(picked);
      inputRef.current?.focus();
    } finally {
      setBrowsing(false);
    }
  }

  return (
    <div className="workspace-dialog-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="workspace-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="workspace-dialog-title" className="workspace-dialog-title">
          选择工作区目录
        </h2>
        <p className="workspace-dialog-hint">
          点击「浏览…」选择文件夹，或手动输入绝对路径。目录内需包含{" "}
          <code>flintloom.yml</code>。
        </p>
        <label className="workspace-dialog-label">
          目录路径
          <div className="workspace-dialog-input-row">
            <input
              ref={inputRef}
              type="text"
              className="workspace-dialog-input"
              value={value}
              placeholder="G:\AgentCode\PerAgent\FlintLoom"
              list="workspace-recent-paths"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onCancel();
                }
              }}
            />
            <button
              type="button"
              className="btn-ghost workspace-dialog-browse"
              disabled={browsing}
              onClick={() => void browse()}
            >
              {browsing ? "打开中…" : "浏览…"}
            </button>
          </div>
        </label>
        {recentPaths.length > 0 ? (
          <datalist id="workspace-recent-paths">
            {recentPaths.map((path) => (
              <option key={path} value={path} />
            ))}
          </datalist>
        ) : null}
        <div className="workspace-dialog-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={normalizeWorkspaceInput(value) === undefined}
            onClick={submit}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
