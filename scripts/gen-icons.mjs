// Toolbar / store icon generator. Composites the real Pepper chili mark
// (public/icons/button-logo.png — white mark on transparent) onto a coral
// rounded-square app tile, at every size Chrome asks for. Both the "green"
// (recipe found) and "red" (no recipe) filenames are generated so the manifest
// resolves; the page's floating button already signals state, so the toolbar
// icon stays consistently on-brand — "red" is only slightly muted.
import { inflateSync, deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const iconsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(iconsDir, { recursive: true });

const SIZES = [16, 32, 48, 128];
const CORAL = [255, 95, 80]; // #ff5f50 — recipe found
const MUTED = [199, 120, 110]; // dusty coral — no recipe (subtle, still on-brand)

// ---------------------------------------------------------------- PNG codec

function crc32(data) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of data) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, px) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    px.copy(row, 1, y * size * 4, (y + 1) * size * 4);
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function decodePng(buf) {
  let pos = 8;
  let width, height, bitDepth, colorType;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  if (bitDepth !== 8 || colorType !== 6) throw new Error('button-logo.png must be 8-bit RGBA');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const px = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? row[i - 4] : 0;
      const b = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
      let v = row[i];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      row[i] = v;
    }
    prev = row;
    row.copy(px, y * stride);
  }
  return { width, height, px };
}

// ---------------------------------------------------------------- compositing

const mark = decodePng(readFileSync(join(iconsDir, 'button-logo.png')));

/** Rounded-square coral tile with the white chili mark centered. */
function makeIcon(size, [r, g, b]) {
  const out = Buffer.alloc(size * size * 4);
  const radius = size * 0.22; // app-tile rounding
  const markScale = 0.66;
  const markSize = size * markScale;
  const offset = (size - markSize) / 2;

  // signed distance to a rounded square, for 1px anti-aliased edges
  const half = size / 2;
  const roundedAlpha = (x, y) => {
    const dx = Math.abs(x + 0.5 - half) - (half - radius);
    const dy = Math.abs(y + 0.5 - half) - (half - radius);
    const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - radius;
    const dist = Math.min(Math.max(dx, dy), 0) + outside;
    if (dist <= -0.5) return 255;
    if (dist >= 0.5) return 0;
    return Math.round(255 * (0.5 - dist));
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      const tileA = roundedAlpha(x, y);
      if (tileA === 0) continue;
      // bilinear sample of the white mark's alpha
      const mx = ((x - offset) / markSize) * mark.width;
      const my = ((y - offset) / markSize) * mark.height;
      let markA = 0;
      if (mx >= 0 && my >= 0 && mx < mark.width - 1 && my < mark.height - 1) {
        const x0 = Math.floor(mx), y0 = Math.floor(my);
        const fx = mx - x0, fy = my - y0;
        const at = (xx, yy) => mark.px[(yy * mark.width + xx) * 4 + 3];
        markA =
          at(x0, y0) * (1 - fx) * (1 - fy) +
          at(x0 + 1, y0) * fx * (1 - fy) +
          at(x0, y0 + 1) * (1 - fx) * fy +
          at(x0 + 1, y0 + 1) * fx * fy;
      }
      const t = markA / 255;
      out[o] = Math.round(255 * t + r * (1 - t));
      out[o + 1] = Math.round(255 * t + g * (1 - t));
      out[o + 2] = Math.round(255 * t + b * (1 - t));
      out[o + 3] = tileA;
    }
  }
  return encodePng(size, out);
}

for (const size of SIZES) {
  writeFileSync(join(iconsDir, `pepper-green-${size}.png`), makeIcon(size, CORAL));
  writeFileSync(join(iconsDir, `pepper-red-${size}.png`), makeIcon(size, MUTED));
}
console.log(`icons written to ${iconsDir}`);
