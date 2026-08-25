import { useEffect, useState } from "react";

type Props = {
  arrayBuffer: ArrayBuffer;
};

export function PdfPreview({ arrayBuffer }: Props) {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    const blob = new Blob([arrayBuffer], { type: "application/pdf" });
    const blobUrl = URL.createObjectURL(blob);
    setUrl(blobUrl);
    return () => URL.revokeObjectURL(blobUrl);
  }, [arrayBuffer]);

  if (!url) {
    return (
      <div className="file-office-loading" role="status">正在加载 PDF…</div>
    );
  }

  return (
    <iframe
      title="PDF 预览"
      className="file-pdf-iframe"
      src={url}
    />
  );
}
