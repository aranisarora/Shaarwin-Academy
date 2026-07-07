import sharp from "sharp";

const svg = (s) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">
      <rect width="${s}" height="${s}" fill="#0B0C0F"/>
      <circle cx="${s / 2}" cy="${s / 2}" r="${s * 0.28}" fill="#E8590C"/>
      <circle cx="${s * 0.42}" cy="${s * 0.42}" r="${s * 0.055}" fill="#F4F1EA" opacity="0.85"/>
    </svg>`
  );

await sharp(svg(192)).png().toFile("public/icon-192.png");
await sharp(svg(512)).png().toFile("public/icon-512.png");
await sharp(svg(512)).png().toFile("public/icon-maskable.png");
console.log("icons OK");
