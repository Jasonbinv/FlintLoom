export {};

declare global {
  interface Window {
    flintloom?: {
      pickWorkspaceFolder: () => Promise<string | undefined>;
    };
  }
}
