export type FileXlsxPreviewHandle = {
  exportXlsx: () => Promise<Blob>;
};

export const FILE_MAX_XLSX_PREVIEW_BYTES = 30 * 1024 * 1024;
