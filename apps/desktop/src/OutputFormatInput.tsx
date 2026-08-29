import { useState } from "react";
import {
  OUTPUT_FORMATS,
  type OutputFormat,
  outputFormatOf,
} from "./outputFormat.ts";

export function OutputFormatInput(props: {
  disabled: boolean;
  value: OutputFormat | undefined;
  onChange: (value: OutputFormat | undefined) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const label = props.value ? outputFormatOf(props.value).label : "输出";

  function pick(next: OutputFormat | undefined): void {
    props.onChange(next);
    setOpen(false);
  }

  return (
    <div className="composer-format">
      <button
        type="button"
        className={
          props.value
            ? "composer-tool-btn composer-tool-btn--active"
            : "composer-tool-btn"
        }
        disabled={props.disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        {label}
      </button>
      {open ? (
        <div className="composer-format-menu" role="listbox">
          <button
            type="button"
            className="composer-format-option"
            onClick={() => pick(undefined)}
          >
            不指定
          </button>
          {OUTPUT_FORMATS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="composer-format-option"
              onClick={() => pick(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
