const { app, BrowserWindow, globalShortcut, dialog } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const PORT = Number(process.env.ART_PORT || 3001);
const KIOSK = process.env.ART_KIOSK !== "0";

/** @type {import('node:child_process').ChildProcess | null} */
let apiProc = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;

function resourcesRoot() {
  if (app.isPackaged) return process.resourcesPath;
  return path.join(__dirname, "..", "resources");
}

function resolveNodeBinary() {
  if (process.env.ART_NODE) return process.env.ART_NODE;
  const bundled = path.join(resourcesRoot(), "node", process.platform === "win32" ? "node.exe" : "node");
  if (fs.existsSync(bundled)) return bundled;
  return process.platform === "win32" ? "node.exe" : "node";
}

function resolveApiEntry() {
  const root = resourcesRoot();
  const candidates = [
    path.join(root, "api", "dist", "index.js"),
    path.join(root, "api", "src", "index.ts"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Dev: monorepo local-api
  return path.join(__dirname, "..", "..", "..", "services", "local-api", "src", "index.ts");
}

function resolveWebDist() {
  const packed = path.join(resourcesRoot(), "web");
  if (fs.existsSync(path.join(packed, "index.html"))) return packed;
  const mono = path.join(__dirname, "..", "..", "web", "dist");
  if (fs.existsSync(path.join(mono, "index.html"))) return mono;
  return "";
}

function waitForHealth(timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`http://127.0.0.1:${PORT}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else if (Date.now() - started > timeoutMs) reject(new Error("API health timeout"));
        else setTimeout(tick, 250);
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) reject(new Error("API не отвечает (нужен Node.js >= 20)"));
        else setTimeout(tick, 250);
      });
    };
    tick();
  });
}

function startApi() {
  const entry = resolveApiEntry();
  const webDist = resolveWebDist();
  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const env = {
    ...process.env,
    PORT: String(PORT),
    ART_DATA_DIR: dataDir,
    ART_WEB_DIST: webDist || "",
  };

  const nodeBin = resolveNodeBinary();
  const isTs = entry.endsWith(".ts");
  const args = isTs ? ["--import", "tsx", entry] : [entry];

  apiProc = spawn(nodeBin, args, {
    env,
    cwd: path.dirname(path.dirname(entry)),
    stdio: "inherit",
    windowsHide: true,
  });

  apiProc.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[desktop] local-api exited with code ${code}`);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: KIOSK,
    kiosk: KIOSK,
    autoHideMenuBar: true,
    backgroundColor: "#f4f5f7",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);

  if (!KIOSK) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  globalShortcut.register("CommandOrControl+Shift+Q", () => {
    app.quit();
  });
  globalShortcut.register("F11", () => {
    if (!mainWindow) return;
    mainWindow.setKiosk(!mainWindow.isKiosk());
  });
}

async function boot() {
  try {
    startApi();
    await waitForHealth();
    createWindow();
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Не удалось запустить кассу. Установите Node.js 20+ и повторите.";
    dialog.showErrorBox("Автомойка АРТ", message);
    app.quit();
  }
}

app.whenReady().then(boot);

app.on("window-all-closed", () => {
  app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (apiProc && !apiProc.killed) {
    apiProc.kill();
  }
});
