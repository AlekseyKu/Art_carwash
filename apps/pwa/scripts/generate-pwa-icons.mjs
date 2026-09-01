#!/usr/bin/env node
/**
 * Единственный исходник: public/logo/logo.jpeg
 *
 * Генерирует:
 * — logo.png — белые линии + брендовые мазки на прозрачном (для UI)
 * — pwa-192/512.png, favicon-32.png — иконки на графите
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logoDir = path.join(root, "public/logo");
const logoSourcePath = path.join(logoDir, "logo.jpeg");

/** Соответствует --brand-primary-bright в tokens.css */
const BRAND_STROKE = { r: 243, g: 74, b: 74 };
const GRAPHITE = { r: 38, g: 47, b: 52, alpha: 1 };

function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function isBackground(r, g, b) {
  return r > 235 && g > 235 && b > 235;
}

/** Красные мазки из исходного JPEG */
function redStrength(r, g, b) {
  if (r < 60) return 0;
  const dominance = r - Math.max(g, b);
  if (dominance < 25) return 0;
  if (g > 160 && b > 160) return 0;
  return Math.min(1, dominance / 120);
}

function inkStrength(r, g, b) {
  if (isBackground(r, g, b)) return 0;
  const lum = luminance(r, g, b);
  if (lum > 210) return 0;
  return Math.min(1, (210 - lum) / 180);
}

function recolorLogoPixels(data, width, height) {
  const out = Buffer.alloc(data.length);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const red = redStrength(r, g, b);
    const ink = inkStrength(r, g, b) * (1 - red * 0.85);

    if (red < 0.04 && ink < 0.04) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
      continue;
    }

    if (red >= ink) {
      const alpha = Math.round(255 * Math.min(1, red * 1.15 + 0.2));
      out[i] = BRAND_STROKE.r;
      out[i + 1] = BRAND_STROKE.g;
      out[i + 2] = BRAND_STROKE.b;
      out[i + 3] = alpha;
    } else {
      const alpha = Math.round(255 * Math.min(1, ink * 1.1 + 0.15));
      out[i] = 255;
      out[i + 1] = 255;
      out[i + 2] = 255;
      out[i + 3] = alpha;
    }
  }

  return sharp(out, { raw: { width, height, channels: 4 } }).png();
}

async function buildBrandedLogoPng() {
  if (!fs.existsSync(logoSourcePath)) {
    throw new Error(`Missing logo source: ${logoSourcePath}`);
  }

  const { data, info } = await sharp(logoSourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return recolorLogoPixels(data, info.width, info.height);
}

async function getLogoBuffer(targetSize) {
  return buildBrandedLogoPng().then((pipeline) =>
    pipeline
      .resize(targetSize, targetSize, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer()
  );
}

async function renderLogoPng(size, outPath, options = {}) {
  const { background = null, padding = 0.12 } = options;
  const inner = Math.round(size * (1 - padding * 2));
  const logoBuffer = await getLogoBuffer(inner);

  if (background) {
    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background,
      },
    })
      .composite([{ input: logoBuffer, gravity: "center" }])
      .png()
      .toFile(outPath);
    return;
  }

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: logoBuffer, gravity: "center" }])
    .png()
    .toFile(outPath);
}

await renderLogoPng(1024, path.join(logoDir, "logo.png"));
console.log("wrote public/logo/logo.png (from logo.jpeg)");

for (const size of [192, 512]) {
  const out = path.join(root, "public", `pwa-${size}.png`);
  await renderLogoPng(size, out, { background: GRAPHITE, padding: 0.14 });
  console.log(`wrote ${out}`);
}

await renderLogoPng(32, path.join(root, "public", "favicon-32.png"), {
  background: GRAPHITE,
  padding: 0.1,
});
console.log("wrote public/favicon-32.png");
