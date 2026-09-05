import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const outDir = resolve(rootDir, "apps", "extension", "scripts", "icons");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

const SHIELD = [
  [0.5, 0.9],
  [0.2, 0.42],
  [0.23, 0.12],
  [0.77, 0.12],
  [0.8, 0.42],
];

function inRoundedRect(x, y, size, radius) {
  const margin = radius;
  const minX = margin;
  const maxX = size - margin;
  const minY = margin;
  const maxY = size - margin;
  if (x < minX || x > maxX || y < minY || y > maxY) return false;
  const cx = x < size / 2 ? minX : maxX;
  const cy = y < size / 2 ? minY : maxY;
  const dx = Math.abs(x - cx);
  const dy = Math.abs(y - cy);
  return dx * dx + dy * dy <= radius * radius;
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const ss = 3;
  const radius = size * 0.22;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accA = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;
          const inBg = inRoundedRect(px, py, size, radius);
          const inShield = pointInPolygon(px / size, py / size, SHIELD);
          const t = py / size;
          const bgR = lerp(0x1d, 0x43, t);
          const bgG = lerp(0x4e, 0x38, t);
          const bgB = lerp(0xd8, 0xca, t);
          let r = bgR;
          let g = bgG;
          let b = bgB;
          let a = inBg ? 255 : 0;
          if (inBg && inShield) {
            r = 0xff;
            g = 0xff;
            b = 0xff;
          }
          accR += r * a;
          accG += g * a;
          accB += b * a;
          accA += a;
        }
      }
      const total = accA || 1;
      const idx = (y * size + x) * 4;
      rgba[idx] = Math.round(accR / total);
      rgba[idx + 1] = Math.round(accG / total);
      rgba[idx + 2] = Math.round(accB / total);
      rgba[idx + 3] = Math.round(accA / (ss * ss));
    }
  }
  return rgba;
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  const png = encodePng(size, size, drawIcon(size));
  writeFileSync(resolve(outDir, `icon${size}.png`), png);
  console.log(`[icons] wrote icon${size}.png (${png.length}B)`);
}