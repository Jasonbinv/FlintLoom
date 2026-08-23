import { extractFilePaths } from "./chatFilePaths.ts";
import { FileCard } from "./FileCard.tsx";

type Props = {
  text: string;
  onOpenFile: (path: string) => void;
};

export function MessageFileCards({ text, onOpenFile }: Props) {
  const paths = extractFilePaths(text);
  if (paths.length === 0) return null;
  return (
    <div className="message-file-cards" aria-label="工作区文件">
      {paths.map((path) => (
        <FileCard key={path} path={path} onOpen={onOpenFile} />
      ))}
    </div>
  );
}
