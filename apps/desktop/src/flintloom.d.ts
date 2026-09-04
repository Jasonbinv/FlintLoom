export {};

export type ShellCloseAction = "ask" | "tray" | "quit";

declare global {
  interface Window {
    flintloom?: {
      pickWorkspaceFolder: () => Promise<string | undefined>;
      openExternalUrl: (url: string) => Promise<void>;
      getShellPrefs: () => Promise<{ closeAction: ShellCloseAction }>;
      setShellPrefs: (prefs: { closeAction: ShellCloseAction }) => Promise<void>;
    };
  }
}
