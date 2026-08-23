import { app, BrowserWindow, Menu, dialog, ipcMain } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));
const desktopUrl = process.env.FLINT_DESKTOP_URL ?? "http://127.0.0.1:5173";

ipcMain.handle("pick-workspace-folder", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win ?? undefined, {
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return undefined;
  }
  return result.filePaths[0];
});

async function loadWithRetry(win, url, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    try {
      await win.loadURL(url);
      return;
    } catch (err) {
      const waitMs = 500;
      console.error(`loadURL attempt ${i + 1}/${attempts} failed:`, err);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw new Error(`failed to load ${url}`);
}

async function createWindow() {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    backgroundColor: "#161310",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(rootDir, "preload.mjs"),
    },
  });
  win.once("ready-to-show", () => {
    win.show();
  });
  win.webContents.on("did-fail-load", (_event, code, desc, url) => {
    console.error(`did-fail-load ${code} ${desc} ${url}`);
  });
  await loadWithRetry(win, desktopUrl);
  if (process.env.FLINT_ELECTRON_DEVTOOLS === "1") {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

app.whenReady().then(() => {
  void createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
