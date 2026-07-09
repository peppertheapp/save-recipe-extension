// Placeholder icon generator — solid rounded-circle pepper dots in brand green/red.
// Replace with real brand assets when Jake provides them (open item #4 in the plan).
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const COLORS = {
  green: [29, 185, 84],
  red: [217, 48, 37],
};
const SIZES = [16, 32, 48, 128];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

function makePng(size, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - Math.max(1, size / 16);
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const alpha = dist <= radius ? 255 : dist <= radius + 1 ? Math.round(255 * (radius + 1 - dist)) : 0;
      // Simple "stem" notch: lighter wedge in the upper right for pepper-ness.
      const stem = alpha > 0 && y < size * 0.28 && Math.abs(x - cx) < size * 0.06;
      row[1 + x * 4] = stem ? Math.min(255, r + 60) : r;
      row[1 + x * 4 + 1] = stem ? Math.min(255, g + 40) : g;
      row[1 + x * 4 + 2] = stem ? Math.min(255, b + 40) : b;
      row[1 + x * 4 + 3] = alpha;
    }
    rows.push(row);
  }
  const idat = deflateSync(Buffer.concat(rows));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, color] of Object.entries(COLORS)) {
  for (const size of SIZES) {
    writeFileSync(join(outDir, `pepper-${name}-${size}.png`), makePng(size, color));
  }
}
// Placeholder white mark for the floating button (public/icons/button-logo.png).
// Overwrite this file with the real brand logo (white, transparent bg) + rebuild.
function makeLogoPng(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const cx = size / 2;
  const cy = size * 0.58;
  const radius = size * 0.36;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const body = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= radius;
      // Curved stem: thin arc from the body's top toward upper right.
      const t = (y - size * 0.08) / (size * 0.2);
      const stemX = cx + size * 0.1 * t * t;
      const stem = t >= 0 && t <= 1 && Math.abs(x - stemX) < size * 0.035;
      const on = body || stem;
      row[1 + x * 4] = 255;
      row[1 + x * 4 + 1] = 255;
      row[1 + x * 4 + 2] = 255;
      row[1 + x * 4 + 3] = on ? 255 : 0;
    }
    rows.push(row);
  }
  const idat = deflateSync(Buffer.concat(rows));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
writeFileSync(join(outDir, 'button-logo.png'), makeLogoPng(128));
console.log(`icons written to ${outDir}`);
