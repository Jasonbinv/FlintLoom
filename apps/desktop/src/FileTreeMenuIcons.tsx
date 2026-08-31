import type { ReactNode } from "react";

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const MenuIcons = {
  expandAll: (
    <Glyph>
      <path d="m7 15 5 5 5-5" />
      <path d="m7 9 5-5 5 5" />
    </Glyph>
  ),
  collapseAll: (
    <Glyph>
      <path d="m7 20 5-5 5 5" />
      <path d="m7 4 5 5 5-5" />
    </Glyph>
  ),
  expand: (
    <Glyph>
      <path d="m9 18 6-6-6-6" />
    </Glyph>
  ),
  collapse: (
    <Glyph>
      <path d="m6 9 6 6 6-6" />
    </Glyph>
  ),
  refresh: (
    <Glyph>
      <path d="M21 12a9 9 0 1 1-3.2-6.8" />
      <path d="M21 3v6h-6" />
    </Glyph>
  ),
  filePlus: (
    <Glyph>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M12 18v-6" />
      <path d="M9 15h6" />
    </Glyph>
  ),
  folderPlus: (
    <Glyph>
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9l-.81-1.2A2 2 0 0 0 7.6 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" />
      <path d="M12 11v6" />
      <path d="M9 14h6" />
    </Glyph>
  ),
  eye: (
    <Glyph>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </Glyph>
  ),
  quote: (
    <Glyph>
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
    </Glyph>
  ),
  pencil: (
    <Glyph>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </Glyph>
  ),
  folderMove: (
    <Glyph>
      <path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1" />
      <path d="M2 13h10" />
      <path d="m9 16 3-3-3-3" />
    </Glyph>
  ),
  trash: (
    <Glyph>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </Glyph>
  ),
};
