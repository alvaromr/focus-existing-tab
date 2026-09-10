// Generates icons/icon{16,32,48,128}.png without external dependencies.
// Drawing: blue rounded square, two overlapping "tab" cards; the front one is highlighted.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const SIZES = [16, 32, 48, 128];
const SUPERSAMPLE = 4;

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixelAt) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Shapes in unit coordinates (0..1). Later entries are painted on top.
const BG = [37, 99, 235, 255];
const BACK_TAB = [191, 219, 254, 255];
const FRONT_TAB = [255, 255, 255, 255];
const FRONT_BAR = [30, 64, 175, 255];

function roundedRect(u, v, x0, y0, x1, y1, r) {
  const cx = Math.max(x0 + r, Math.min(u, x1 - r));
  const cy = Math.max(y0 + r, Math.min(v, y1 - r));
  return Math.hypot(u - cx, v - cy) <= r;
}

function colorAt(u, v) {
  if (!roundedRect(u, v, 0, 0, 1, 1, 0.22)) return [0, 0, 0, 0];
  let color = BG;
  if (roundedRect(u, v, 0.34, 0.16, 0.86, 0.64, 0.05)) color = BACK_TAB;
  if (roundedRect(u, v, 0.14, 0.36, 0.66, 0.84, 0.05)) {
    color = v < 0.46 ? FRONT_BAR : FRONT_TAB;
  }
  return color;
}

function supersampled(size) {
  return (x, y) => {
    const acc = [0, 0, 0, 0];
    for (let sy = 0; sy < SUPERSAMPLE; sy++) {
      for (let sx = 0; sx < SUPERSAMPLE; sx++) {
        const u = (x + (sx + 0.5) / SUPERSAMPLE) / size;
        const v = (y + (sy + 0.5) / SUPERSAMPLE) / size;
        const c = colorAt(u, v);
        // premultiplied accumulation keeps edges clean over transparency
        acc[0] += c[0] * c[3];
        acc[1] += c[1] * c[3];
        acc[2] += c[2] * c[3];
        acc[3] += c[3];
      }
    }
    if (acc[3] === 0) return [0, 0, 0, 0];
    const n = SUPERSAMPLE * SUPERSAMPLE;
    return [
      Math.round(acc[0] / acc[3]),
      Math.round(acc[1] / acc[3]),
      Math.round(acc[2] / acc[3]),
      Math.round(acc[3] / n),
    ];
  };
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  writeFileSync(join(OUT_DIR, `icon${size}.png`), encodePng(size, supersampled(size)));
}
console.log(`icons written to ${OUT_DIR}`);
