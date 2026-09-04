import { renderMarkdownHtml } from "./markdownPreview.ts";

type Props = {
  text: string;
};

export function AssistantMarkdown({ text }: Props) {
  const html = renderMarkdownHtml(text);
  return (
    <div
      className="assistant-md"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
