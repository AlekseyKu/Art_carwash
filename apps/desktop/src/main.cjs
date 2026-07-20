const { app, BrowserWindow, globalShortcut, dialog } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

/** Упакованный updater; после in-app update может подмениться runtime/desktop/updater.cjs */
let updaterMod = require("./updater.cjs");
let createUpdater = updaterMod.createUpdater;
let resolveAppPaths = updaterMod.resolveAppPaths;
let setUserDataDir = updaterMod.setUserDataDir;

function loadRuntimeUpdaterIfPresent() {
  try {
    const runtimeUpdater = path.join(app.getPath("userData"), "runtime", "desktop", "updater.cjs");
    if (!fs.existsSync(runtimeUpdater)) return false;
    try {
      delete require.cache[require.resolve(runtimeUpdater)];
    } catch {
      delete require.cache[runtimeUpdater];
    }
    const mod = require(runtimeUpdater);
    if (typeof mod.createUpdater !== "function") {
      throw new Error("runtime updater без createUpdater");
    }
    updaterMod = mod;
    createUpdater = mod.createUpdater;
    resolveAppPaths = mod.resolveAppPaths || resolveAppPaths;
    setUserDataDir = mod.setUserDataDir || setUserDataDir;
    return true;
  } catch (e) {
    try {
      fs.appendFileSync(
        path.join(app.getPath("userData"), "update.log"),
        `${new Date().toISOString()} runtime updater load failed: ${e instanceof Error ? e.message : String(e)}\n`
      );
    } catch {
      /* ignore */
    }
    return false;
  }
}

const PORT = Number(process.env.ART_PORT || 3001);
const CTRL_PORT = Number(process.env.ART_DESKTOP_CTRL_PORT || 3921);
const KIOSK = process.env.ART_KIOSK !== "0";
/** node:sqlite есть с Node 22.5+ */
const MIN_NODE_MAJOR = 22;

/**
 * Стабильный ASCII userData (кириллический productName ломает пути на части ПК).
 * Вызывать до app.ready.
 */
function configureUserDataPath() {
  const appData =
    process.env.APPDATA ||
    (process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, "AppData", "Roaming")
      : "");
  if (!appData) return;

  const preferred = path.join(appData, "ArtCarwash-POS");
  const legacyDirs = [
    path.join(appData, "автомойка-арт"),
    path.join(appData, "Автомойка АРТ"),
    path.join(appData, "avtomoyka-art"),
  ];

  const hasDb = (dir) =>
    fs.existsSync(path.join(dir, "data", "local.db")) ||
    fs.existsSync(path.join(dir, "runtime", "version.json"));

  try {
    if (!hasDb(preferred)) {
      for (const legacy of legacyDirs) {
        if (!hasDb(legacy)) continue;
        // Переезд: используем старый каталог, чтобы не потерять БД
        app.setPath("userData", legacy);
        return;
      }
    }
    app.setPath("userData", preferred);
  } catch {
    try {
      app.setPath("userData", preferred);
    } catch {
      /* ignore — останется default Electron */
    }
  }
}

configureUserDataPath();

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
  return resolveAppPaths(resourcesRoot()).versionPath;
}

function appPaths() {
  return resolveAppPaths(resourcesRoot());
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
  const { apiDir } = appPaths();
  const candidates = [
    path.join(apiDir, "dist", "index.js"),
    path.join(apiDir, "index.js"),
    path.join(apiDir, "src", "index.ts"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.join(__dirname, "..", "..", "..", "services", "local-api", "src", "index.ts");
}

function resolveWebDist() {
  const { webDir } = appPaths();
  if (fs.existsSync(path.join(webDir, "index.html"))) return webDir;
  const mono = path.join(__dirname, "..", "..", "web", "dist");
  if (fs.existsSync(path.join(mono, "index.html"))) return mono;
  return "";
}

function logUpdate(line) {
  try {
    fs.appendFileSync(
      path.join(app.getPath("userData"), "update.log"),
      `${new Date().toISOString()} ${line}\n`,
      "utf8"
    );
  } catch {
    /* ignore */
  }
}

function portInUse(port) {
  return new Promise((resolve) => {
    const srv = http.createServer();
    srv.once("error", () => resolve(true));
    srv.once("listening", () => {
      srv.close(() => resolve(false));
    });
    srv.listen(port, "127.0.0.1");
  });
}

async function waitForPortFree(port, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const busy = await portInUse(port);
    if (!busy) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Порт ${port} занят — закройте старую кассу и попробуйте снова`);
}

function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } else {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Portable: нельзя spawn(process.execPath) — это TEMP-распаковка.
 * Сначала выходим, через 2с стартуем исходный portable.exe.
 */
function scheduleRelaunch() {
  const exe = resolveLaunchExecutable();
  logUpdate(`relaunch schedule exe=${exe} execPath=${process.execPath}`);

  try {
    if (process.platform === "win32") {
      const bat = path.join(
        app.getPath("temp"),
        `art-relaunch-${Date.now()}.cmd`
      );
      // Ждём освобождение портов, затем стартуем portable stub
      const content = [
        "@echo off",
        "timeout /t 2 /nobreak >nul",
        `start "" ${JSON.stringify(exe)}`,
        'del "%~f0"',
        "",
      ].join("\r\n");
      fs.writeFileSync(bat, content, "utf8");
      spawn("cmd.exe", ["/c", bat], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
      logUpdate(`relaunch bat=${bat}`);
    } else {
      spawn(exe, [], {
        detached: true,
        stdio: "ignore",
        cwd: path.dirname(exe),
        env: process.env,
      }).unref();
    }
  } catch (e) {
    logUpdate(`relaunch FAILED: ${e instanceof Error ? e.message : String(e)}`);
    try {
      app.relaunch({ execPath: exe });
    } catch {
      /* ignore */
    }
  }

  try {
    if (ctrlServer) {
      ctrlServer.close();
      ctrlServer = null;
    }
  } catch {
    /* ignore */
  }
  if (apiProc && !apiProc.killed) {
    killProcessTree(apiProc.pid);
    apiProc = null;
  }

  setTimeout(() => {
    app.exit(0);
  }, 300);
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

/** Убедиться, что раздаётся UI (не только /api/health). */
function waitForUi(timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`http://127.0.0.1:${PORT}/`, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (
            res.statusCode === 200 &&
            (/<!doctype html/i.test(body) || /id=["']root["']/i.test(body))
          ) {
            resolve();
            return;
          }
          if (Date.now() - started > timeoutMs) {
            reject(
              new Error(
                "UI не отдаётся (белый экран). Проверьте ART_WEB_DIST / runtime/web."
              )
            );
          } else setTimeout(tick, 300);
        });
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error("UI не отвечает после старта API"));
        } else setTimeout(tick, 300);
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
    const pid = child.pid;
    apiProc = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    child.once("exit", finish);
    killProcessTree(pid);
    setTimeout(finish, 1500);
  });
}

function startApi(nodeBin) {
  const entry = resolveApiEntry();
  if (!fs.existsSync(entry)) {
    throw new Error(`Не найден API: ${entry}`);
  }

  const webDist = resolveWebDist();
  if (!webDist) {
    throw new Error(
      "Не найден UI (web/index.html). Проверьте resources/web или %APPDATA%/…/runtime/web"
    );
  }

  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const env = {
    ...process.env,
    PORT: String(PORT),
    ART_DATA_DIR: dataDir,
    ART_WEB_DIST: webDist,
    ART_DESKTOP_CTRL_URL: `http://127.0.0.1:${CTRL_PORT}`,
    ART_DESKTOP_CTRL_TOKEN: ctrlToken,
  };

  const isTs = entry.endsWith(".ts");
  const args = isTs ? ["--import", "tsx", entry] : [entry];
  const cwd = path.dirname(path.dirname(entry));
  const logFile = path.join(app.getPath("userData"), "local-api.log");

  lastApiError = `Запуск: ${nodeBin} ${args.join(" ")}\nКаталог: ${cwd}\nWEB: ${webDist}`;
  logUpdate(`startApi entry=${entry} web=${webDist}`);

  // Обнуляем лог API при старте, чтобы видеть свежие ошибки
  try {
    fs.writeFileSync(logFile, `${new Date().toISOString()} start\n`, "utf8");
  } catch {
    /* ignore */
  }

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

function resolveLaunchExecutable() {
  const fromEnv = process.env.PORTABLE_EXECUTABLE_FILE;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const dir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (dir && fs.existsSync(dir)) {
    try {
      const exes = fs.readdirSync(dir).filter((f) => /\.exe$/i.test(f));
      const preferred =
        exes.find((f) => /ArtCarwash|POS/i.test(f)) ||
        exes.find((f) => !/^unins/i.test(f));
      if (preferred) {
        const full = path.join(dir, preferred);
        if (fs.existsSync(full)) return full;
      }
    } catch {
      /* ignore */
    }
  }
  return process.execPath;
}

/** Ярлык ArtCarwash.lnk на рабочий стол (Windows). */
function ensureDesktopShortcut() {
  if (process.platform !== "win32") return;
  if (!app.isPackaged) return;
  try {
    const target = resolveLaunchExecutable();
    if (!target || !fs.existsSync(target)) return;
    const desktop = app.getPath("desktop");
    const lnk = path.join(desktop, "ArtCarwash.lnk");
    const workDir = path.dirname(target);
    const ps = `
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut(${JSON.stringify(lnk)})
$sc.TargetPath = ${JSON.stringify(target)}
$sc.WorkingDirectory = ${JSON.stringify(workDir)}
$sc.Description = 'Автомойка АРТ — касса'
$sc.Save()
`;
    const r = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      { encoding: "utf8", windowsHide: true, timeout: 15000 }
    );
    if (r.status !== 0) {
      fs.appendFileSync(
        path.join(app.getPath("userData"), "update.log"),
        `${new Date().toISOString()} shortcut FAILED: ${r.stderr || r.stdout || r.status}\n`,
        "utf8"
      );
      return;
    }
    fs.appendFileSync(
      path.join(app.getPath("userData"), "update.log"),
      `${new Date().toISOString()} shortcut OK → ${lnk} → ${target}\n`,
      "utf8"
    );
  } catch (e) {
    try {
      fs.appendFileSync(
        path.join(app.getPath("userData"), "update.log"),
        `${new Date().toISOString()} shortcut ERR: ${e instanceof Error ? e.message : String(e)}\n`,
        "utf8"
      );
    } catch {
      /* ignore */
    }
  }
}

function minimizeWindow() {
  if (!mainWindow) return { ok: false, error: "Нет окна" };
  try {
    if (mainWindow.isKiosk()) mainWindow.setKiosk(false);
    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
    mainWindow.setMenuBarVisibility(false);
    mainWindow.minimize();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function closeWindow() {
  setTimeout(() => app.quit(), 50);
  return { ok: true };
}

function updateConfigPath() {
  return path.join(app.getPath("userData"), "update-config.json");
}

function getUpdater() {
  return createUpdater({
    resourcesDir: resourcesRoot(),
    currentVersionPath: versionPath(),
    tempDir: path.join(app.getPath("userData"), "updates"),
    configPath: updateConfigPath(),
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
        const paths = updater.resolvePaths();
        send(200, {
          ok: true,
          desktop: true,
          updating,
          currentVersion: updater.currentVersion(),
          repo: process.env.ART_UPDATE_REPO || "AlekseyKu/Art_carwash",
          hasGithubToken: updater.hasToken(),
          runtimeSource: paths.source,
          runtimeDir: paths.runtimeDir,
          updatesDir: path.join(app.getPath("userData"), "updates"),
          logPath: path.join(app.getPath("userData"), "update.log"),
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/window/minimize") {
        send(200, minimizeWindow());
        return;
      }
      if (req.method === "POST" && url.pathname === "/window/close") {
        send(200, closeWindow());
        return;
      }
      if (req.method === "POST" && url.pathname === "/github-token") {
        const raw = await readBody(req);
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          send(400, { error: "Некорректный JSON" });
          return;
        }
        const result = updater.setToken(body.token ?? "");
        send(200, {
          ...result,
          message: result.hasGithubToken
            ? "GitHub token сохранён на этой кассе"
            : "GitHub token удалён",
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
          // 1) Скачиваем при живом API (файлы runtime ещё не трогаем)
          const prepared = await updater.prepareUpdate();
          if (!prepared.prepared) {
            send(200, { ...prepared, applied: false, restart: false });
            return;
          }
          // 2) Останавливаем API, чтобы снять блокировки файлов на Windows
          await stopApi();
          await new Promise((r) => setTimeout(r, 400));
          const result = updater.commitPrepared(prepared);
          send(200, result);
          if (result.restart) {
            // Сначала полностью выходим, через ~2с bat стартует portable.exe
            setTimeout(() => scheduleRelaunch(), 400);
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

  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === "clipboard-read" || permission === "clipboard-sanitized-write") {
      callback(true);
      return;
    }
    callback(false);
  });
  mainWindow.webContents.session.setPermissionCheckHandler((_wc, permission) => {
    return permission === "clipboard-read" || permission === "clipboard-sanitized-write";
  });

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
    const userData = app.getPath("userData");
    setUserDataDir(userData);
    fs.mkdirSync(userData, { recursive: true });
    const usedRuntimeUpdater = loadRuntimeUpdaterIfPresent();
    // setUserDataDir мог обновиться из runtime-модуля
    setUserDataDir(userData);
    logUpdate(
      `userData=${userData} updater=${usedRuntimeUpdater ? "runtime/desktop" : "packaged"}`
    );

    await waitForPortFree(CTRL_PORT);
    await waitForPortFree(PORT);
    await startControlServer();
    const paths = appPaths();
    const webDist = resolveWebDist();
    logUpdate(
      `boot source=${paths.source} web=${webDist || paths.webDir} api=${paths.apiDir} ver=${versionPath()} portable=${resolveLaunchExecutable()}`
    );
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
    await waitForUi();
    ensureDesktopShortcut();
    createWindow();
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : `Не удалось запустить кассу. Нужен Node.js ${MIN_NODE_MAJOR}+.`;
    logUpdate(`boot FAILED: ${message}`);
    dialog.showErrorBox("Автомойка АРТ", message);
    app.quit();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(boot);
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (apiProc && !apiProc.killed) {
    killProcessTree(apiProc.pid);
    apiProc = null;
  }
  if (ctrlServer) {
    ctrlServer.close();
  }
});
