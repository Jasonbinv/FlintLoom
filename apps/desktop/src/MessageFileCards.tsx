import { useEffect, useState } from "react";
import { extractFilePaths, keepExistingFilePaths } from "./chatFilePaths.ts";
import { FileCard } from "./FileCard.tsx";
import { fetchFiles } from "./files.ts";

type Props = {
  text: string;
  onOpenFile: (path: string) => void;
};

export function MessageFileCards({ text, onOpenFile }: Props) {
  const [paths, setPaths] = useState<string[]>([]);

  useEffect(() => {
    const candidates = extractFilePaths(text);
    if (candidates.length === 0) {
      setPaths([]);
      return;
    }
    const ac = new AbortController();
    void keepExistingFilePaths(candidates, (dir) => fetchFiles(dir, ac.signal)).then(
      (found) => {
        if (!ac.signal.aborted) setPaths(found);
      },
    );
    return () => {
      ac.abort();
    };
  }, [text]);

  if (paths.length === 0) return null;
  return (
    <div className="message-file-cards" aria-label="工作区文件">
      {paths.map((path) => (
        <FileCard key={path} path={path} onOpen={onOpenFile} />
      ))}
    </div>
  );
}
