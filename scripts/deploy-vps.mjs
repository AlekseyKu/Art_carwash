#!/usr/bin/env node
/**
 * Сборка PWA + выкладка на VPS (cloud-api + static).
 * Требует: ssh art-vps, deploy/.env с секретами.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deployDir = path.join(root, "deploy");
const pwaDist = path.join(deployDir, "pwa-dist");

function run(cmd, cwd = root) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", shell: true });
}

run("pnpm --filter @art/pwa build");

fs.rmSync(pwaDist, { recursive: true, force: true });
fs.cpSync(path.join(root, "apps/pwa/dist"), pwaDist, { recursive: true });

const tgz = path.join(root, "deploy-context.tgz");
run(
  `tar --exclude=node_modules --exclude=.git --exclude=apps --exclude=services/local-api --exclude=services/terminal-bridge --exclude=data --exclude=apps/desktop --exclude=deploy-context.tgz -czf deploy-context.tgz deploy package.json pnpm-lock.yaml pnpm-workspace.yaml .dockerignore services/cloud-api packages/shared`
);

run(`scp deploy-context.tgz art-vps:~/art.tgz`);
run(`ssh art-vps "cd ~/art && tar -xzf ~/art.tgz && rm ~/art.tgz && cd deploy && docker compose up -d --build"`);

console.log("\nDone: https://carwash-jd.ru/");
