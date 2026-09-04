const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("flintloom", {
  pickWorkspaceFolder: () =>
    ipcRenderer.invoke("pick-workspace-folder"),
  openExternalUrl: (url) => ipcRenderer.invoke("open-external-url", url),
  getShellPrefs: () => ipcRenderer.invoke("get-shell-prefs"),
  setShellPrefs: (prefs) => ipcRenderer.invoke("set-shell-prefs", prefs),
});
