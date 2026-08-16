import mammoth from "mammoth";

type MammothMarkdown = {
  convertToMarkdown: (input: {
    path: string;
  }) => Promise<{ value: string }>;
};

export async function parseDocx(absPath: string): Promise<string> {
  const { value } = await (mammoth as unknown as MammothMarkdown).convertToMarkdown({
    path: absPath,
  });
  return value;
}

