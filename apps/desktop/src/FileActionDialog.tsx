import { useEffect, useRef } from "react";

type Props = {
  title: string;
  hint?: string;
  inputLabel?: string;
  inputValue?: string;
  onInputChange?: (value: string) => void;
  confirmLabel: string;
  danger?: boolean;
  error?: string;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function FileActionDialog({
  title,
  hint,
  inputLabel,
  inputValue,
  onInputChange,
  confirmLabel,
  danger,
  error,
  confirmDisabled,
  onConfirm,
  onCancel,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="workspace-dialog-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="workspace-dialog file-action-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-action-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="file-action-dialog-title" className="workspace-dialog-title">
          {title}
        </h2>
        {hint ? <p className="workspace-dialog-hint">{hint}</p> : null}
        {inputLabel !== undefined ? (
          <label className="workspace-dialog-label">
            {inputLabel}
            <input
              ref={inputRef}
              type="text"
              className="workspace-dialog-input"
              value={inputValue ?? ""}
              onChange={(event) => onInputChange?.(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (!confirmDisabled) onConfirm();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  onCancel();
                }
              }}
            />
          </label>
        ) : null}
        {error ? <p className="file-action-dialog__error">{error}</p> : null}
        <div className="workspace-dialog-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={danger ? "btn-danger" : "btn-primary"}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
