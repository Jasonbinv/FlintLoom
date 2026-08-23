import { useRef, type ChangeEvent } from "react";
import type { UserImage } from "./types.ts";

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const MAX_BYTES = 4 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("read"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read"));
    reader.readAsDataURL(file);
  });
}

export function ImageInput(props: {
  disabled: boolean;
  onImages: (images: UserImage[]) => void;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);

  async function onChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = event.target.files;
    if (files === null || files.length === 0) {
      return;
    }
    const images: UserImage[] = [];
    for (const file of files) {
      if (!ALLOWED_MIME.has(file.type) || file.size > MAX_BYTES) {
        continue;
      }
      const data = await fileToBase64(file);
      images.push({ mime: file.type, data });
    }
    event.target.value = "";
    if (images.length > 0) {
      props.onImages(images);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        hidden
        onChange={(event) => void onChange(event)}
      />
      <button
        type="button"
        className="composer-tool-btn"
        disabled={props.disabled}
        onClick={() => inputRef.current?.click()}
      >
        图片
      </button>
    </>
  );
}
