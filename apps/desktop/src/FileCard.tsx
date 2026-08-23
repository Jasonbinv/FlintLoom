import { fileBaseName } from "./chatFilePaths.ts";
import { FileIcon } from "./FileIcon.tsx";

type Props = {
  path: string;
  onOpen: (path: string) => void;
};

export function FileCard({ path, onOpen }: Props) {
  const name = fileBaseName(path);
  return (
    <button
      type="button"
      className="chat-file-card"
      onClick={() => onOpen(path)}
      title={`打开 ${path}`}
    >
      <FileIcon name={name} />
      <span className="chat-file-card-body">
        <span className="chat-file-card-name">{name}</span>
        {path !== name ? (
          <span className="chat-file-card-path">{path}</span>
        ) : null}
      </span>
      <span className="chat-file-card-action" aria-hidden>
        预览
      </span>
    </button>
  );
}
