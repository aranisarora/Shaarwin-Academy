// One-off generator for the PWA maskable icon and the iOS apple-touch icon.
// Both need a SOLID #F4F1EA background with a safe zone (the raw logo on a
// transparent background gets cropped to a tiny circle by Android launchers).
// Run: node scripts/gen-app-icons.mjs
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BG = { r: 244, g: 241, b: 234, alpha: 1 }; // #F4F1EA
const SRC = path.join(ROOT, "public/icon-512.png");

async function make(canvas, outPath) {
  const inner = Math.round(canvas * 0.66);
  // Trim the source's transparent padding so "66% of canvas" is the logo
  // itself, then fit it inside the inner box and centre on a solid square.
  const logo = await sharp(SRC)
    .trim()
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  await sharp({ create: { width: canvas, height: canvas, channels: 4, background: BG } })
    .composite([{ input: logo, gravity: "centre" }])
    .png()
    .toFile(outPath);
  console.log("wrote", path.relative(ROOT, outPath));
}

await make(512, path.join(ROOT, "public/icon-maskable.png"));
await make(180, path.join(ROOT, "app/apple-icon.png"));
