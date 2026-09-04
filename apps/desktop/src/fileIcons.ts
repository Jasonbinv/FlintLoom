export type FileIconInfo = {
  glyph: string;
  color: string;
  bg: string;
};

const EXT_MAP: Record<string, FileIconInfo> = {
  md: { glyph: "M", color: "#2563eb", bg: "#dbeafe" },
  markdown: { glyph: "M", color: "#2563eb", bg: "#dbeafe" },
  docx: { glyph: "W", color: "#1d4ed8", bg: "#dbeafe" },
  doc: { glyph: "W", color: "#1d4ed8", bg: "#dbeafe" },
  xlsx: { glyph: "X", color: "#15803d", bg: "#dcfce7" },
  xls: { glyph: "X", color: "#15803d", bg: "#dcfce7" },
  csv: { glyph: "C", color: "#15803d", bg: "#dcfce7" },
  json: { glyph: "{ }", color: "#7c3aed", bg: "#ede9fe" },
  py: { glyph: "Py", color: "#b45309", bg: "#fef3c7" },
  js: { glyph: "JS", color: "#ca8a04", bg: "#fef9c3" },
  ts: { glyph: "TS", color: "#2563eb", bg: "#dbeafe" },
  tsx: { glyph: "TS", color: "#2563eb", bg: "#dbeafe" },
  jsx: { glyph: "JS", color: "#ca8a04", bg: "#fef9c3" },
  png: { glyph: "🖼", color: "#db2777", bg: "#fce7f3" },
  jpg: { glyph: "🖼", color: "#db2777", bg: "#fce7f3" },
  jpeg: { glyph: "🖼", color: "#db2777", bg: "#fce7f3" },
  mp3: { glyph: "♪", color: "#7c3aed", bg: "#ede9fe" },
  wav: { glyph: "♪", color: "#7c3aed", bg: "#ede9fe" },
  ogg: { glyph: "♪", color: "#7c3aed", bg: "#ede9fe" },
  flac: { glyph: "♪", color: "#7c3aed", bg: "#ede9fe" },
  aac: { glyph: "♪", color: "#7c3aed", bg: "#ede9fe" },
  m4a: { glyph: "♪", color: "#7c3aed", bg: "#ede9fe" },
  mp4: { glyph: "▶", color: "#db2777", bg: "#fce7f3" },
  webm: { glyph: "▶", color: "#db2777", bg: "#fce7f3" },
  mov: { glyph: "▶", color: "#db2777", bg: "#fce7f3" },
  avi: { glyph: "▶", color: "#db2777", bg: "#fce7f3" },
  mkv: { glyph: "▶", color: "#db2777", bg: "#fce7f3" },
  svg: { glyph: "◇", color: "#7c3aed", bg: "#ede9fe" },
  ig: { glyph: "IG", color: "#7c3aed", bg: "#ede9fe" },
  yml: { glyph: "Y", color: "#64748b", bg: "#f1f5f9" },
  yaml: { glyph: "Y", color: "#64748b", bg: "#f1f5f9" },
  txt: { glyph: "T", color: "#64748b", bg: "#f1f5f9" },
  pdf: { glyph: "P", color: "#b91c1c", bg: "#fee2e2" },
  pptx: { glyph: "P", color: "#c2410c", bg: "#ffedd5" },
  ppt: { glyph: "P", color: "#c2410c", bg: "#ffedd5" },
};

const DIR_ICON: FileIconInfo = { glyph: "📁", color: "#ca8a04", bg: "#fef9c3" };
const DEFAULT_ICON: FileIconInfo = { glyph: "·", color: "#64748b", bg: "#f1f5f9" };

export function fileIconForName(name: string, isDir = false): FileIconInfo {
  if (isDir) return DIR_ICON;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return DEFAULT_ICON;
  return EXT_MAP[name.slice(dot + 1).toLowerCase()] ?? DEFAULT_ICON;
}
