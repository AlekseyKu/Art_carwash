const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");

const DEFAULT_REPO = process.env.ART_UPDATE_REPO || "AlekseyKu/Art_carwash";
const ASSET_NAME = "art-pos-update.zip";

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function parseSemver(v) {
  const m = String(v || "")
    .replace(/^v/i, "")
    .replace(/^pos-/i, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
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
          reject(new Error(`GitHub HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
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
        fs.unlinkSync(dest);
        downloadFile(res.headers.location, dest, headers).then(resolve, reject);
        return;
      }
      if ((res.statusCode || 500) >= 400) {
        file.close();
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
    const r = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-Command", ps],
      { encoding: "utf8", windowsHide: true }
    );
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

function createUpdater({ resourcesDir, currentVersionPath, tempDir }) {
  function currentVersion() {
    const fromFile = readJson(currentVersionPath, null);
    if (fromFile?.version) return String(fromFile.version);
    return "0.0.0";
  }

  async function checkLatest() {
    const repo = DEFAULT_REPO;
    const releases = await httpGetJson(
      `https://api.github.com/repos/${repo}/releases?per_page=15`
    );
    if (!Array.isArray(releases) || releases.length === 0) {
      return {
        ok: true,
        updateAvailable: false,
        currentVersion: currentVersion(),
        latestVersion: null,
        message: "На GitHub пока нет Releases",
      };
    }
    const release = releases.find((r) =>
      (r.assets || []).some(
        (a) => a.name === ASSET_NAME || /^art-pos-update.*\.zip$/i.test(a.name)
      )
    );
    if (!release) {
      return {
        ok: true,
        updateAvailable: false,
        currentVersion: currentVersion(),
        latestVersion: null,
        message: "Нет Release с файлом art-pos-update.zip",
      };
    }
    const tag = release.tag_name || "";
    const ver =
      parseSemver(tag)?.join(".") ||
      tag.replace(/^pos-v?/i, "").replace(/^v/i, "") ||
      null;
    const asset = (release.assets || []).find(
      (a) => a.name === ASSET_NAME || /^art-pos-update.*\.zip$/i.test(a.name)
    );
    if (!asset?.browser_download_url) {
      return {
        ok: true,
        updateAvailable: false,
        currentVersion: currentVersion(),
        latestVersion: ver || null,
        message: "В Release нет art-pos-update.zip",
        releaseUrl: release.html_url || null,
      };
    }
    const current = currentVersion();
    const latest = ver || current;
    const updateAvailable = cmpSemver(current, latest) < 0;
    return {
      ok: true,
      updateAvailable,
      currentVersion: current,
      latestVersion: latest,
      releaseName: release.name || tag,
      releaseNotes: release.body || "",
      releaseUrl: release.html_url || null,
      assetName: asset.name,
      assetUrl: asset.browser_download_url,
      assetSize: asset.size,
      publishedAt: release.published_at || null,
      message: updateAvailable
        ? `Доступна версия ${latest}`
        : `Уже последняя версия (${current})`,
    };
  }

  async function applyUpdate() {
    const info = await checkLatest();
    if (!info.updateAvailable) {
      return { ok: true, applied: false, ...info };
    }
    fs.mkdirSync(tempDir, { recursive: true });
    const zipPath = path.join(tempDir, ASSET_NAME);
    const extractDir = path.join(tempDir, "extract");
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    rimraf(extractDir);

    await downloadFile(info.assetUrl, zipPath, {
      Accept: "application/octet-stream",
    });
    extractZip(zipPath, extractDir);

    // zip может содержать корень art-pos-update/ или сразу web+api
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
    const verSrc = path.join(root, "version.json");
    if (!fs.existsSync(path.join(webSrc, "index.html"))) {
      throw new Error("В архиве нет web/index.html");
    }
    if (!fs.existsSync(path.join(apiSrc, "dist", "index.js")) && !fs.existsSync(path.join(apiSrc, "dist"))) {
      // allow api/dist/index.js
      if (!fs.existsSync(path.join(apiSrc, "index.js"))) {
        throw new Error("В архиве нет api/dist");
      }
    }

    const webDest = path.join(resourcesDir, "web");
    const apiDest = path.join(resourcesDir, "api");
    const webBak = path.join(resourcesDir, "web.bak");
    const apiBak = path.join(resourcesDir, "api.bak");

    rimraf(webBak);
    rimraf(apiBak);
    if (fs.existsSync(webDest)) fs.renameSync(webDest, webBak);
    if (fs.existsSync(apiDest)) fs.renameSync(apiDest, apiBak);

    try {
      copyDir(webSrc, webDest);
      copyDir(apiSrc, apiDest);
      if (fs.existsSync(verSrc)) {
        fs.copyFileSync(verSrc, currentVersionPath);
      } else {
        fs.writeFileSync(
          currentVersionPath,
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
      rimraf(webBak);
      rimraf(apiBak);
    } catch (e) {
      rimraf(webDest);
      rimraf(apiDest);
      if (fs.existsSync(webBak)) fs.renameSync(webBak, webDest);
      if (fs.existsSync(apiBak)) fs.renameSync(apiBak, apiDest);
      throw e;
    }

    return {
      ok: true,
      applied: true,
      currentVersion: info.latestVersion,
      latestVersion: info.latestVersion,
      message: `Обновлено до ${info.latestVersion}. Перезапуск…`,
      restart: true,
    };
  }

  return { currentVersion, checkLatest, applyUpdate };
}

module.exports = { createUpdater, cmpSemver, ASSET_NAME, DEFAULT_REPO };
