import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("flintloom", {
  pickWorkspaceFolder: () =>
    ipcRenderer.invoke("pick-workspace-folder") as Promise<string | undefined>,
});
