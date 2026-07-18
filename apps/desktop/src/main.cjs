const { app, BrowserWindow, globalShortcut, dialog } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createUpdater } = require("./updater.cjs");

const PORT = Number(process.env.ART_PORT || 3001);
const CTRL_PORT = Number(process.env.ART_DESKTOP_CTRL_PORT || 3921);
const KIOSK = process.env.ART_KIOSK !== "0";
/** node:sqlite есть с Node 22.5+ */
const MIN_NODE_MAJOR = 22;

/** @type {import('node:child_process').ChildProcess | null} */
let apiProc = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {import('node:http').Server | null} */
let ctrlServer = null;
let lastApiError = "";
let ctrlToken = "";
/** @type {string | null} */
let nodeBinCached = null;
let updating = false;

function resourcesRoot() {
  if (app.isPackaged) return process.resourcesPath;
  return path.join(__dirname, "..", "resources");
}

function versionPath() {
  return path.join(resourcesRoot(), "version.json");
}

function candidateNodeBins() {
  const list = [];
  if (process.env.ART_NODE) list.push(process.env.ART_NODE);

  const bundled = path.join(
    resourcesRoot(),
    "node",
    process.platform === "win32" ? "node.exe" : "node"
  );
  list.push(bundled);

  if (process.platform === "win32") {
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const local = process.env.LOCALAPPDATA || "";
    list.push(
      path.join(pf, "nodejs", "node.exe"),
      path.join(pf86, "nodejs", "node.exe"),
      path.join(local, "Programs", "nodejs", "node.exe")
    );
  }

  list.push(process.platform === "win32" ? "node.exe" : "node");
  return list;
}

function nodeVersion(bin) {
  try {
    const r = spawnSync(bin, ["-v"], { encoding: "utf8", windowsHide: true });
    if (r.status !== 0) return null;
    const m = String(r.stdout || r.stderr || "").trim().match(/v?(\d+)\./);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function resolveNodeBinary() {
  for (const bin of candidateNodeBins()) {
    if (!bin) continue;
    if (bin.includes(path.sep) || bin.includes("/")) {
      if (!fs.existsSync(bin)) continue;
    }
    const major = nodeVersion(bin);
    if (major != null && major >= MIN_NODE_MAJOR) return { bin, major };
    if (major != null && major < MIN_NODE_MAJOR) {
      lastApiError = `Найден Node.js v${major}, нужен Node.js ${MIN_NODE_MAJOR}+ (из‑за SQLite). Сейчас: ${bin}`;
    }
  }
  return null;
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
  return path.join(__dirname, "..", "..", "..", "services", "local-api", "src", "index.ts");
}

function resolveWebDist() {
  const packed = path.join(resourcesRoot(), "web");
  if (fs.existsSync(path.join(packed, "index.html"))) return packed;
  const mono = path.join(__dirname, "..", "..", "web", "dist");
  if (fs.existsSync(path.join(mono, "index.html"))) return mono;
  return "";
}

function waitForHealth(timeoutMs = 45000) {
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
        if (Date.now() - started > timeoutMs) {
          const detail = lastApiError || "процесс API не поднялся";
          reject(
            new Error(
              `API не отвечает.\n${detail}\n\nУстановите Node.js ${MIN_NODE_MAJOR}+ x64 с https://nodejs.org\nи перезагрузите ПК (чтобы PATH подхватился).`
            )
          );
        } else setTimeout(tick, 250);
      });
    };
    tick();
  });
}

function stopApi() {
  return new Promise((resolve) => {
    if (!apiProc || apiProc.killed) {
      apiProc = null;
      resolve();
      return;
    }
    const child = apiProc;
    apiProc = null;
    child.once("exit", () => resolve());
    child.kill();
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve();
    }, 3000);
  });
}

function startApi(nodeBin) {
  const entry = resolveApiEntry();
  if (!fs.existsSync(entry)) {
    throw new Error(`Не найден API: ${entry}`);
  }

  const webDist = resolveWebDist();
  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const env = {
    ...process.env,
    PORT: String(PORT),
    ART_DATA_DIR: dataDir,
    ART_WEB_DIST: webDist || "",
    ART_DESKTOP_CTRL_URL: `http://127.0.0.1:${CTRL_PORT}`,
    ART_DESKTOP_CTRL_TOKEN: ctrlToken,
  };

  const isTs = entry.endsWith(".ts");
  const args = isTs ? ["--import", "tsx", entry] : [entry];
  const cwd = path.dirname(path.dirname(entry));
  const logFile = path.join(app.getPath("userData"), "local-api.log");

  lastApiError = `Запуск: ${nodeBin} ${args.join(" ")}\nКаталог: ${cwd}`;

  apiProc = spawn(nodeBin, args, {
    env,
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const append = (buf) => {
    const text = buf.toString();
    lastApiError = (lastApiError + "\n" + text).slice(-4000);
    try {
      fs.appendFileSync(logFile, text);
    } catch {
      /* ignore */
    }
  };
  apiProc.stdout?.on("data", append);
  apiProc.stderr?.on("data", append);

  apiProc.on("error", (err) => {
    lastApiError = `Не удалось запустить Node: ${err.message}\nБинарник: ${nodeBin}`;
  });

  apiProc.on("exit", (code) => {
    if (code && code !== 0) {
      lastApiError = `local-api завершился с кодом ${code}\nЛог: ${logFile}\n${lastApiError}`;
    }
  });
}

function getUpdater() {
  return createUpdater({
    resourcesDir: resourcesRoot(),
    currentVersionPath: versionPath(),
    tempDir: path.join(app.getPath("userData"), "updates"),
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function startControlServer() {
  ctrlToken = crypto.randomBytes(24).toString("hex");
  const updater = getUpdater();

  ctrlServer = http.createServer(async (req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization, content-type",
        "access-control-allow-methods": "GET,POST,OPTIONS",
      });
      res.end(JSON.stringify(obj));
    };

    if (req.method === "OPTIONS") {
      send(204, {});
      return;
    }

    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${ctrlToken}`) {
      send(401, { error: "Unauthorized" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://127.0.0.1:${CTRL_PORT}`);
      if (req.method === "GET" && url.pathname === "/status") {
        send(200, {
          ok: true,
          desktop: true,
          updating,
          currentVersion: updater.currentVersion(),
          repo: process.env.ART_UPDATE_REPO || "AlekseyKu/Art_carwash",
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/check") {
        const info = await updater.checkLatest();
        send(200, info);
        return;
      }
      if (req.method === "POST" && url.pathname === "/apply") {
        if (updating) {
          send(409, { error: "Обновление уже выполняется" });
          return;
        }
        updating = true;
        try {
          await stopApi();
          const result = await updater.applyUpdate();
          send(200, result);
          if (result.restart) {
            setTimeout(() => {
              app.relaunch();
              app.exit(0);
            }, 500);
          } else if (nodeBinCached) {
            startApi(nodeBinCached);
          }
        } catch (e) {
          if (nodeBinCached) {
            try {
              startApi(nodeBinCached);
            } catch {
              /* ignore */
            }
          }
          send(500, { error: e instanceof Error ? e.message : String(e) });
        } finally {
          updating = false;
        }
        return;
      }
      await readBody(req);
      send(404, { error: "Not found" });
    } catch (e) {
      send(500, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  return new Promise((resolve, reject) => {
    ctrlServer.listen(CTRL_PORT, "127.0.0.1", () => resolve());
    ctrlServer.on("error", reject);
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
    await startControlServer();
    const resolved = resolveNodeBinary();
    if (!resolved) {
      throw new Error(
        lastApiError ||
          `Node.js ${MIN_NODE_MAJOR}+ не найден.\nУстановите с https://nodejs.org (Windows Installer x64)\nи перезагрузите ПК.`
      );
    }
    nodeBinCached = resolved.bin;
    startApi(resolved.bin);
    await waitForHealth();
    createWindow();
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : `Не удалось запустить кассу. Нужен Node.js ${MIN_NODE_MAJOR}+.`;
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
  if (ctrlServer) {
    ctrlServer.close();
  }
});
