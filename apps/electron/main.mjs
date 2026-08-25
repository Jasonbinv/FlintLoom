import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from "electron";
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

ipcMain.handle("open-external-url", async (_event, url) => {
  if (typeof url !== "string") {
    throw new Error("invalid url");
  }
  const trimmed = url.trim();
  if (!trimmed.startsWith("http://127.0.0.1:")) {
    throw new Error("refusing external url");
  }
  await shell.openExternal(trimmed);
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

  const isDev = Boolean(process.env.FLINT_DESKTOP_URL);

  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const mod = input.control || input.meta;
    if (!mod) return;

    if (input.key === "r" || input.key === "R") {
      event.preventDefault();
      if (input.shift) {
        win.webContents.reloadIgnoringCache();
      } else {
        win.webContents.reload();
      }
      return;
    }

    if (input.key === "F5") {
      event.preventDefault();
      if (input.shift) {
        win.webContents.reloadIgnoringCache();
      } else {
        win.webContents.reload();
      }
      return;
    }

    if (isDev && input.key === "F12") {
      event.preventDefault();
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools();
      } else {
        win.webContents.openDevTools({ mode: "detach" });
      }
    }
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
