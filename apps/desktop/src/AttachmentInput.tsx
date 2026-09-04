import { useRef, type ChangeEvent } from "react";
import { MAX_ATTACHMENT_BYTES } from "./attachments.ts";

export function AttachmentInput(props: {
  disabled: boolean;
  remaining: number;
  onFiles: (files: File[]) => void;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);

  function onChange(event: ChangeEvent<HTMLInputElement>): void {
    const input = event.target;
    const list = input.files;
    if (list === null || list.length === 0 || props.remaining <= 0) {
      input.value = "";
      return;
    }
    const files: File[] = [];
    for (const file of list) {
      if (file.size > MAX_ATTACHMENT_BYTES) continue;
      files.push(file);
      if (files.length >= props.remaining) break;
    }
    input.value = "";
    if (files.length > 0) {
      props.onFiles(files);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={onChange}
      />
      <button
        type="button"
        className="composer-tool-btn"
        disabled={props.disabled || props.remaining <= 0}
        onClick={() => inputRef.current?.click()}
      >
        附件
      </button>
    </>
  );
}
