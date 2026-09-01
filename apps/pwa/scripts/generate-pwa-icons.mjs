#!/usr/bin/env node
/**
 * Генерация pwa-192.png и pwa-512.png из public/icon.svg
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = path.join(root, "public/icon.svg");
const svg = fs.readFileSync(svgPath);

for (const size of [192, 512]) {
  const out = path.join(root, "public", `pwa-${size}.png`);
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(out);
  console.log(`wrote ${out}`);
}
