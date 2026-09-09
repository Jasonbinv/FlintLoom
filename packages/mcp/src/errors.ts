export function publicMcpError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("missing env:")) {
    return message.replace(/missing env:\s*/, "missing env: ").trim();
  }
  if (message.includes("timeout")) return "timeout";
  if (
    message === "id" ||
    message === "command" ||
    message === "args" ||
    message === "env" ||
    message === "workspaceRoot"
  ) {
    return message;
  }
  return "mcp";
}
