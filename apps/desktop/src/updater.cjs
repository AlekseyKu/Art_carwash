"use strict";

const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");

const DEFAULT_REPO = process.env.ART_UPDATE_REPO || "AlekseyKu/Art_carwash";
const ASSET_NAME = "art-pos-update.zip";

/** Каталог userData передаётся из main после app.ready — без require('electron'). */
let userDataDir = "";

function setUserDataDir(dir) {
  if (!dir || typeof dir !== "string") {
    throw new Error("update configuration path: userDataDir не задан");
  }
  userDataDir = dir;
  fs.mkdirSync(userDataDir, { recursive: true });
}

function requireUserData() {
  if (!userDataDir) {
    throw new Error(
      "Update configuration path is not defined (userData). Перезапустите кассу / поставьте 0.2.8+"
    );
  }
  return userDataDir;
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function parseSemver(v) {
  const m = String(v || "")
    .trim()
    .replace(/^pos-/i, "")
    .replace(/^v/i, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function versionFromTag(tag) {
  const raw = String(tag || "").trim();
  const parsed = parseSemver(raw);
  if (parsed) return parsed.join(".");
  const stripped = raw.replace(/^pos-/i, "").replace(/^v/i, "");
  const again = parseSemver(stripped);
  return again ? again.join(".") : null;
}

function releaseHasUpdateZip(release) {
  return (release?.assets || []).some(
    (a) => a.name === ASSET_NAME || /^art-pos-update.*\.zip$/i.test(a.name)
  );
}

function pickUpdateAsset(release) {
  return (release?.assets || []).find(
    (a) => a.name === ASSET_NAME || /^art-pos-update.*\.zip$/i.test(a.name)
  );
}

function cmpSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

function httpGetJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { headers: { "user-agent": "ArtCarwash-POS", ...headers } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        httpGetJson(res.headers.location, headers).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if ((res.statusCode || 500) >= 400) {
          const hint =
            res.statusCode === 404
              ? " (если репозиторий приватный — нужен GitHub token в Админ → Обновления)"
              : "";
          reject(new Error(`GitHub HTTP ${res.statusCode}${hint}: ${body.slice(0, 180)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
  });
}

function downloadFile(url, dest, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(dest);
    const req = lib.get(url, { headers: { "user-agent": "ArtCarwash-POS", ...headers } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try {
          fs.unlinkSync(dest);
        } catch {
          /* ignore */
        }
        downloadFile(res.headers.location, dest, headers).then(resolve, reject);
        return;
      }
      if ((res.statusCode || 500) >= 400) {
        file.close();
        try {
          fs.unlinkSync(dest);
        } catch {
          /* ignore */
        }
        reject(new Error(`Download HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve(dest)));
    });
    req.on("error", (err) => {
      file.close();
      reject(err);
    });
  });
}

function rimraf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function extractZip(zipPath, destDir) {
  rimraf(destDir);
  fs.mkdirSync(destDir, { recursive: true });
  if (process.platform === "win32") {
    const ps = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;
    const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (r.status !== 0) {
      throw new Error(r.stderr || r.stdout || "Expand-Archive failed");
    }
    return;
  }
  const r = spawnSync("unzip", ["-o", zipPath, "-d", destDir], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || "unzip failed");
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function runtimeRoot() {
  return path.join(requireUserData(), "runtime");
}

function updateLogPath() {
  return path.join(requireUserData(), "update.log");
}

function appendLog(line) {
  try {
    fs.appendFileSync(updateLogPath(), `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch {
    /* ignore */
  }
}

/**
 * Portable.exe при каждом холодном старте перезаписывает resources.
 * Актуальные web/api храним в userData/runtime и предпочитаем их при запуске.
 */
function resolveAppPaths(packagedResourcesDir) {
  const rt = runtimeRoot();
  const rtWeb = path.join(rt, "web");
  const rtApi = path.join(rt, "api");
  const rtOk =
    fs.existsSync(path.join(rtWeb, "index.html")) &&
    (fs.existsSync(path.join(rtApi, "dist", "index.js")) ||
      fs.existsSync(path.join(rtApi, "index.js")));

  if (rtOk) {
    return {
      webDir: rtWeb,
      apiDir: rtApi,
      versionPath: path.join(rt, "version.json"),
      source: "runtime",
      runtimeDir: rt,
    };
  }

  return {
    webDir: path.join(packagedResourcesDir, "web"),
    apiDir: path.join(packagedResourcesDir, "api"),
    versionPath: path.join(packagedResourcesDir, "version.json"),
    source: "packaged",
    runtimeDir: rt,
  };
}

function createUpdater({ resourcesDir, currentVersionPath, tempDir, configPath }) {
  if (!configPath || typeof configPath !== "string") {
    throw new Error("Update configuration path is not defined (configPath)");
  }
  if (!tempDir || typeof tempDir !== "string") {
    throw new Error("Update tempDir is not defined");
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });
  requireUserData();
  function readConfig() {
    return readJson(configPath, {}) || {};
  }

  function writeConfig(patch) {
    const next = { ...readConfig(), ...patch };
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2));
    return next;
  }

  function getToken() {
    const fromEnv = (process.env.ART_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "").trim();
    if (fromEnv) return fromEnv;
    const fromCfg = String(readConfig().githubToken || "").trim();
    return fromCfg || "";
  }

  function setToken(token) {
    const t = String(token || "").trim();
    if (!t) {
      const cfg = readConfig();
      delete cfg.githubToken;
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
      return { ok: true, hasGithubToken: false };
    }
    writeConfig({ githubToken: t });
    return { ok: true, hasGithubToken: true };
  }

  function githubHeaders(extra = {}) {
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...extra,
    };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  function activeVersionPath() {
    const paths = resolveAppPaths(resourcesDir);
    if (paths.source === "runtime" && fs.existsSync(paths.versionPath)) {
      return paths.versionPath;
    }
    if (fs.existsSync(currentVersionPath)) return currentVersionPath;
    return paths.versionPath;
  }

  function currentVersion() {
    const fromFile = readJson(activeVersionPath(), null);
    if (fromFile?.version) return String(fromFile.version);
    return "0.0.0";
  }

  async function checkLatest() {
    const repo = process.env.ART_UPDATE_REPO || DEFAULT_REPO;
    const token = getToken();
    const hasGithubToken = Boolean(token);
    const paths = resolveAppPaths(resourcesDir);
    const baseMeta = {
      hasGithubToken,
      repo,
      runtimeSource: paths.source,
      runtimeDir: paths.runtimeDir,
      updatesDir: tempDir,
      logPath: updateLogPath(),
    };
    // Список /releases иногда отдаёт [] (баг/особенность API), при этом
    // /releases/latest и /releases/tags/* работают — не выходим раньше времени.
    let releases = [];
    let listError = null;
    try {
      const listed = await httpGetJson(
        `https://api.github.com/repos/${repo}/releases?per_page=40`,
        githubHeaders()
      );
      if (Array.isArray(listed)) releases = listed;
    } catch (e) {
      listError = e instanceof Error ? e.message : String(e);
    }

    let latestRelease = null;
    try {
      latestRelease = await httpGetJson(
        `https://api.github.com/repos/${repo}/releases/latest`,
        githubHeaders()
      );
    } catch (e) {
      if (!releases.length) {
        const msg = e instanceof Error ? e.message : String(e);
        const failMsg = listError || msg;
        const needsToken =
          !hasGithubToken && /\bGitHub HTTP (401|403|404)\b/.test(failMsg);
        return {
          ok: false,
          updateAvailable: false,
          currentVersion: currentVersion(),
          latestVersion: null,
          ...baseMeta,
          message: needsToken
            ? "Не удалось прочитать Releases (HTTP 401/403/404). Если репозиторий приватный — сохраните GitHub token (Contents: Read) ниже."
            : failMsg,
        };
      }
    }

    // /releases/latest + список: GitHub сортирует не по semver (0.2.9 > 0.2.12 как строки).
    const candidates = [];
    if (latestRelease && releaseHasUpdateZip(latestRelease)) candidates.push(latestRelease);
    for (const r of releases) {
      if (releaseHasUpdateZip(r)) candidates.push(r);
    }

    let release = null;
    let bestVer = null;
    for (const r of candidates) {
      const ver = versionFromTag(r.tag_name || "");
      if (!ver) continue;
      if (!bestVer || cmpSemver(bestVer, ver) < 0) {
        bestVer = ver;
        release = r;
      }
    }
    if (!release) {
      return {
        ok: true,
        updateAvailable: false,
        currentVersion: currentVersion(),
        latestVersion: null,
        ...baseMeta,
        message:
          !releases.length && !latestRelease
            ? "На GitHub пока нет Releases"
            : "Нет Release с файлом art-pos-update.zip",
      };
    }
    const tag = release.tag_name || "";
    const ver = bestVer;
    const asset = pickUpdateAsset(release);
    if (!asset?.url && !asset?.browser_download_url) {
      return {
        ok: true,
        updateAvailable: false,
        currentVersion: currentVersion(),
        latestVersion: ver || null,
        ...baseMeta,
        message: "В Release нет art-pos-update.zip",
        releaseUrl: release.html_url || null,
      };
    }
    const current = currentVersion();
    const latest = ver || current;
    const updateAvailable = cmpSemver(current, latest) < 0;
    appendLog(`check current=${current} latest=${latest} available=${updateAvailable} tag=${tag}`);
    // API asset URL требует auth даже для public; без token качаем browser_download_url.
    const assetUrl = hasGithubToken
      ? asset.url || asset.browser_download_url
      : asset.browser_download_url || asset.url;
    return {
      ok: true,
      updateAvailable,
      currentVersion: current,
      latestVersion: latest,
      releaseName: release.name || tag,
      releaseNotes: release.body || "",
      releaseUrl: release.html_url || null,
      assetName: asset.name,
      assetUrl,
      assetBrowserUrl: asset.browser_download_url || null,
      assetSize: asset.size,
      publishedAt: release.published_at || null,
      ...baseMeta,
      message: updateAvailable
        ? `Доступна версия ${latest}`
        : `Уже последняя версия (${current})`,
    };
  }

  /**
   * Скачивает zip и готовит staging (API может ещё работать).
   */
  async function prepareUpdate() {
    const info = await checkLatest();
    if (!info.updateAvailable) {
      return { ok: Boolean(info.ok), prepared: false, ...info };
    }
    fs.mkdirSync(tempDir, { recursive: true });
    const zipPath = path.join(tempDir, ASSET_NAME);
    const extractDir = path.join(tempDir, "extract");
    const stagingDir = path.join(tempDir, `staging-${Date.now()}`);
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    rimraf(extractDir);

    appendLog(`download ${info.assetUrl}`);
    const dlHeaders = { ...githubHeaders() };
    if (String(info.assetUrl).includes("api.github.com")) {
      dlHeaders.Accept = "application/octet-stream";
    }
    await downloadFile(info.assetUrl, zipPath, dlHeaders);
    appendLog(`downloaded size=${fs.statSync(zipPath).size}`);
    extractZip(zipPath, extractDir);

    let root = extractDir;
    const directWeb = path.join(extractDir, "web", "index.html");
    if (!fs.existsSync(directWeb)) {
      const kids = fs.readdirSync(extractDir).filter((n) => !n.startsWith("."));
      if (kids.length === 1) {
        const nested = path.join(extractDir, kids[0]);
        if (fs.existsSync(path.join(nested, "web", "index.html"))) root = nested;
      }
    }

    const webSrc = path.join(root, "web");
    const apiSrc = path.join(root, "api");
    const desktopSrc = path.join(root, "desktop");
    const verSrc = path.join(root, "version.json");
    if (!fs.existsSync(path.join(webSrc, "index.html"))) {
      throw new Error("В архиве нет web/index.html");
    }
    if (
      !fs.existsSync(path.join(apiSrc, "dist", "index.js")) &&
      !fs.existsSync(path.join(apiSrc, "index.js"))
    ) {
      throw new Error("В архиве нет api/dist/index.js");
    }

    rimraf(stagingDir);
    fs.mkdirSync(stagingDir, { recursive: true });
    copyDir(webSrc, path.join(stagingDir, "web"));
    copyDir(apiSrc, path.join(stagingDir, "api"));
    // Hot-patch логики обновлений: следующий запуск подхватит runtime/desktop/updater.cjs
    if (fs.existsSync(path.join(desktopSrc, "updater.cjs"))) {
      copyDir(desktopSrc, path.join(stagingDir, "desktop"));
    }
    if (fs.existsSync(verSrc)) {
      fs.copyFileSync(verSrc, path.join(stagingDir, "version.json"));
    } else {
      fs.writeFileSync(
        path.join(stagingDir, "version.json"),
        JSON.stringify(
          {
            version: info.latestVersion,
            updatedAt: new Date().toISOString(),
            sha256: sha256File(zipPath),
          },
          null,
          2
        )
      );
    }

    appendLog(`staging ready ${stagingDir}`);
    return {
      ok: true,
      prepared: true,
      stagingDir,
      zipPath,
      extractDir,
      latestVersion: info.latestVersion,
      currentVersion: info.currentVersion,
      hasGithubToken: Boolean(info.hasGithubToken),
    };
  }

  /**
   * Ставит staging в %APPDATA%/…/runtime (вызывать после остановки API).
   */
  function commitPrepared(prepared) {
    if (!prepared?.prepared || !prepared.stagingDir) {
      throw new Error("Нет подготовленного обновления");
    }
    const rt = runtimeRoot();
    const backup = path.join(tempDir, `runtime-backup-${Date.now()}`);

    if (fs.existsSync(rt)) {
      rimraf(backup);
      fs.renameSync(rt, backup);
      appendLog(`backed up runtime → ${backup}`);
    }

    try {
      fs.renameSync(prepared.stagingDir, rt);
    } catch (e) {
      if (fs.existsSync(backup)) {
        try {
          if (fs.existsSync(rt)) rimraf(rt);
          fs.renameSync(backup, rt);
        } catch {
          /* ignore */
        }
      }
      throw e;
    }

    // Старый способ писал в resources portable — больше не трогаем.
    // Чистим extract/zip и лишние бэкапы.
    try {
      if (prepared.extractDir) rimraf(prepared.extractDir);
      if (prepared.zipPath && fs.existsSync(prepared.zipPath)) fs.unlinkSync(prepared.zipPath);
      const backups = fs
        .readdirSync(tempDir)
        .filter((n) => n.startsWith("runtime-backup-"))
        .map((n) => path.join(tempDir, n))
        .sort();
      while (backups.length > 1) {
        const old = backups.shift();
        if (old) rimraf(old);
      }
    } catch {
      /* ignore */
    }

    appendLog(`installed ${prepared.latestVersion} → ${rt}`);
    return {
      ok: true,
      applied: true,
      currentVersion: prepared.latestVersion,
      latestVersion: prepared.latestVersion,
      runtimeDir: rt,
      logPath: updateLogPath(),
      message: `Обновлено до ${prepared.latestVersion}. Перезапуск…`,
      restart: true,
      hasGithubToken: Boolean(getToken()),
    };
  }

  async function applyUpdate() {
    const prepared = await prepareUpdate();
    if (!prepared.prepared) {
      return { ok: Boolean(prepared.ok), applied: false, ...prepared };
    }
    return commitPrepared(prepared);
  }

  return {
    currentVersion,
    checkLatest,
    prepareUpdate,
    commitPrepared,
    applyUpdate,
    getToken,
    setToken,
    hasToken: () => Boolean(getToken()),
    resolvePaths: () => resolveAppPaths(resourcesDir),
  };
}

module.exports = {
  createUpdater,
  cmpSemver,
  parseSemver,
  versionFromTag,
  ASSET_NAME,
  DEFAULT_REPO,
  resolveAppPaths,
  runtimeRoot,
  updateLogPath,
  setUserDataDir,
};
