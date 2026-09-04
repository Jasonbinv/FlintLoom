import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  shell,
} from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLOSE_DIALOG,
  decideAfterAsk,
  decideClose,
  isCloseAction,
  parseShellPrefs,
  serializeShellPrefs,
  shellPrefsPath,
} from "./closeAction.mjs";

const rootDir = dirname(fileURLToPath(import.meta.url));
const desktopUrl = process.env.FLINT_DESKTOP_URL ?? "http://127.0.0.1:5173";

let cachedPrefs = { closeAction: "ask" };
let isQuitting = false;
let dialogOpen = false;
let tray;

async function loadPrefs() {
  try {
    const text = await readFile(shellPrefsPath(homedir()), "utf8");
    cachedPrefs = parseShellPrefs(JSON.parse(text));
  } catch {
    cachedPrefs = { closeAction: "ask" };
  }
}

async function savePrefs(prefs) {
  const target = shellPrefsPath(homedir());
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, serializeShellPrefs(prefs), "utf8");
  cachedPrefs = prefs;
}

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

ipcMain.handle("get-shell-prefs", async () => cachedPrefs);

ipcMain.handle("set-shell-prefs", async (_event, prefs) => {
  if (!isCloseAction(prefs?.closeAction)) {
    throw new Error("invalid closeAction");
  }
  await savePrefs({ closeAction: prefs.closeAction });
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

function showMainWindow() {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function ensureTray() {
  if (tray) return;
  try {
    const image = nativeImage.createFromPath(join(rootDir, "tray.png"));
    if (image.isEmpty()) {
      console.error("tray icon failed to load", join(rootDir, "tray.png"));
      return;
    }
    tray = new Tray(image);
    tray.setToolTip("FlintLoom");
    tray.on("click", () => showMainWindow());
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "显示窗口", click: () => showMainWindow() },
        { type: "separator" },
        { label: "退出", click: () => app.quit() },
      ]),
    );
  } catch (err) {
    console.error("tray create failed", err);
  }
}

async function handleClose(win) {
  const decision = decideClose(cachedPrefs.closeAction);
  if (decision === "hide") {
    ensureTray();
    win.hide();
    return;
  }
  if (decision === "quit") {
    isQuitting = true;
    app.quit();
    return;
  }
  dialogOpen = true;
  try {
    const { response, checkboxChecked } = await dialog.showMessageBox(win, {
      type: "question",
      title: CLOSE_DIALOG.title,
      message: CLOSE_DIALOG.message,
      buttons: CLOSE_DIALOG.buttons,
      defaultId: CLOSE_DIALOG.defaultId,
      cancelId: CLOSE_DIALOG.cancelId,
      checkboxLabel: CLOSE_DIALOG.checkboxLabel,
      checkboxChecked: true,
      noLink: true,
    });
    const after = decideAfterAsk(response, checkboxChecked);
    if (after.persist) {
      try {
        await savePrefs({ closeAction: after.persist });
      } catch (err) {
        console.error("save shell prefs failed", err);
      }
    }
    if (after.kind === "hide") {
      ensureTray();
      win.hide();
    } else if (after.kind === "quit") {
      isQuitting = true;
      app.quit();
    }
  } finally {
    dialogOpen = false;
  }
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
      preload: join(rootDir, "preload.cjs"),
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

  win.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    if (dialogOpen) return;
    void handleClose(win);
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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(async () => {
    await loadPrefs();
    void createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow();
        return;
      }
      showMainWindow();
    });
  });
}

app.on("before-quit", () => {
  isQuitting = true;
  tray?.destroy();
  tray = undefined;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
