/**
 * Сборка art-pos-update.zip (+ portable exe) и публикация в GitHub Releases.
 *
 * Usage:
 *   node scripts/publish-pos-release.mjs              # версия из apps/desktop/package.json
 *   node scripts/publish-pos-release.mjs 0.2.0        # задать версию
 *   node scripts/publish-pos-release.mjs --dry-run    # только собрать, без gh release
 *
 * Нужен: gh auth login, Node 22+, pnpm
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const desktopPkgPath = path.join(repoRoot, "apps", "desktop", "package.json");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const versionArg = args.find((a) => !a.startsWith("--"));

function run(cmd, cwd = repoRoot) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", shell: true });
}

const desktopPkg = JSON.parse(fs.readFileSync(desktopPkgPath, "utf8"));
const version = versionArg || desktopPkg.version;
if (versionArg && versionArg !== desktopPkg.version) {
  desktopPkg.version = version;
  fs.writeFileSync(desktopPkgPath, JSON.stringify(desktopPkg, null, 2) + "\n");
  console.log(`version → ${version}`);
}

const tag = `pos-v${version}`;
const outDir = path.join(repoRoot, "apps", "desktop", "release");
const staging = path.join(outDir, "update-staging");
const zipPath = path.join(outDir, "art-pos-update.zip");

run("pnpm --filter @art/desktop exec node scripts/prepare-resources.mjs");

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

const resources = path.join(repoRoot, "apps", "desktop", "resources");
fs.cpSync(path.join(resources, "web"), path.join(staging, "web"), { recursive: true });
fs.cpSync(path.join(resources, "api"), path.join(staging, "api"), { recursive: true });
fs.copyFileSync(path.join(resources, "version.json"), path.join(staging, "version.json"));

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
if (process.platform === "win32") {
  run(
    `powershell -NoProfile -Command "Compress-Archive -Path '${staging.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`
  );
} else {
  run(`cd "${staging}" && zip -r "${zipPath}" .`);
}

run("pnpm --filter @art/desktop exec electron-builder --win portable --x64");

const portable = path.join(outDir, `ArtCarwash-POS-${version}-portable.exe`);
if (!fs.existsSync(portable)) {
  const found = fs.readdirSync(outDir).find((f) => f.endsWith("-portable.exe"));
  if (!found) throw new Error("portable exe не найден в release/");
  fs.renameSync(path.join(outDir, found), portable);
}

console.log("Artifacts:");
console.log(" -", zipPath);
console.log(" -", portable);

if (dryRun) {
  console.log("[dry-run] skip gh release");
  process.exit(0);
}

const notesPath = path.join(outDir, "release-notes.md");
fs.writeFileSync(
  notesPath,
  `Касса Автомойка АРТ ${version}

- \`art-pos-update.zip\` — обновление из админки (web + api)
- \`ArtCarwash-POS-${version}-portable.exe\` — полная установка

На кассе: Админ → Обновления → Проверить / Обновить.
Нужен Node.js 22+ x64.
`
);

run(
  `gh release create "${tag}" --title "POS ${version}" --notes-file "${notesPath}" "${zipPath}" "${portable}"`
);

console.log(`OK: https://github.com/AlekseyKu/Art_carwash/releases/tag/${tag}`);
