export {};

declare global {
  interface Window {
    flintloom?: {
      pickWorkspaceFolder: () => Promise<string | undefined>;
      openExternalUrl: (url: string) => Promise<void>;
    };
  }
}
