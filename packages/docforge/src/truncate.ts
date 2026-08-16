export const OUTPUT_LIMIT = 200_000;

export function truncateOutput(text: string): string {
  if (text.length <= OUTPUT_LIMIT) {
    return text;
  }
  return (
    text.slice(0, OUTPUT_LIMIT) +
    `\n\n[truncated: output exceeded ${OUTPUT_LIMIT} characters]`
  );
}
