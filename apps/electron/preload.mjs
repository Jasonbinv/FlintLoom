import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("flintloom", {
  pickWorkspaceFolder: () =>
    ipcRenderer.invoke("pick-workspace-folder") as Promise<string | undefined>,
  openExternalUrl: (url: string) =>
    ipcRenderer.invoke("open-external-url", url) as Promise<void>,
});
