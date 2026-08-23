import { fileIconForName } from "./fileIcons.ts";

export function FileIcon({
  name,
  isDir = false,
}: {
  name: string;
  isDir?: boolean;
}): JSX.Element {
  const info = fileIconForName(name, isDir);
  return (
    <span
      className="file-icon"
      style={{ color: info.color, background: info.bg }}
      aria-hidden
    >
      {info.glyph}
    </span>
  );
}
