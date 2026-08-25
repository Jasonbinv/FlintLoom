import { fetchSafeHtmlOpenUrl } from "./files.ts";

export function isHtmlFilePath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".html") || lower.endsWith(".htm");
}

export function safeHtmlContentPathFromOpenUrl(openUrl: string): string {
  const url = new URL(openUrl);
  url.pathname = "/v1/files/safe-html/content";
  return `${url.pathname}${url.search}`;
}

export async function fetchSafeHtmlContentUrl(
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  const openUrl = await fetchSafeHtmlOpenUrl(path, signal);
  return safeHtmlContentPathFromOpenUrl(openUrl);
}

export async function openSafeHtmlInBrowser(path: string): Promise<void> {
  const openUrl = await fetchSafeHtmlOpenUrl(path);
  if (window.flintloom?.openExternalUrl) {
    await window.flintloom.openExternalUrl(openUrl);
    return;
  }
  window.open(openUrl, "_blank", "noopener,noreferrer");
}
