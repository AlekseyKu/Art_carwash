/**
 * Собирает web + бандл local-api в apps/desktop/resources для electron-builder.
 */
import * as esbuild from "esbuild";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, "..");
const repoRoot = path.join(desktopRoot, "..", "..");
const resources = path.join(desktopRoot, "resources");
const webOut = path.join(resources, "web");
const apiOut = path.join(resources, "api");

function run(cmd, cwd = repoRoot) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", shell: true });
}

function rimraf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

rimraf(resources);
fs.mkdirSync(apiOut, { recursive: true });

run("pnpm --filter @art/shared build");
run("pnpm --filter @art/web build");

const apiEntry = path.join(repoRoot, "services", "local-api", "src", "index.ts");
const apiBundle = path.join(apiOut, "dist", "index.js");
fs.mkdirSync(path.dirname(apiBundle), { recursive: true });

console.log("> esbuild local-api bundle");
await esbuild.build({
  entryPoints: [apiEntry],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: apiBundle,
  packages: "bundle",
  banner: {
    js: 'import { createRequire as __artCreateRequire } from "module"; const require = __artCreateRequire(import.meta.url);',
  },
  // node:sqlite и прочие built-in
  external: ["node:*"],
});

fs.writeFileSync(
  path.join(apiOut, "package.json"),
  JSON.stringify({ name: "art-local-api-bundle", private: true, type: "module" }, null, 2)
);

rimraf(webOut);
copyDir(path.join(repoRoot, "apps", "web", "dist"), webOut);

const desktopPkg = JSON.parse(
  fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8")
);
fs.writeFileSync(
  path.join(resources, "version.json"),
  JSON.stringify(
    {
      version: desktopPkg.version,
      builtAt: new Date().toISOString(),
      channel: "github",
    },
    null,
    2
  )
);

console.log("[prepare-resources] OK →", resources, "v" + desktopPkg.version);
