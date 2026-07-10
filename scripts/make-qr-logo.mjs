// Composites the white chili mark onto a green disc → public/icons/qr-logo.png
// (the center logo for the pairing QR code). Pure Node, no deps.
import { inflateSync, deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const iconsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

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
  if (bitDepth !== 8 || colorType !== 6) throw new Error('expects 8-bit RGBA');
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

function crc32(data) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
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

const SIZE = 128;
const GREEN = [29, 185, 84];
const mark = decodePng(readFileSync(join(iconsDir, 'button-logo.png')));

const out = Buffer.alloc(SIZE * SIZE * 4);
const cx = SIZE / 2, cy = SIZE / 2, radius = SIZE / 2 - 2;
const markScale = 0.62;
const markSize = SIZE * markScale;
const offset = (SIZE - markSize) / 2;

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const o = (y * SIZE + x) * 4;
    const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    const discAlpha = dist <= radius ? 255 : dist <= radius + 1 ? Math.round(255 * (radius + 1 - dist)) : 0;
    if (discAlpha === 0) continue;
    // bilinear sample of the mark
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
    out[o] = Math.round(255 * t + GREEN[0] * (1 - t));
    out[o + 1] = Math.round(255 * t + GREEN[1] * (1 - t));
    out[o + 2] = Math.round(255 * t + GREEN[2] * (1 - t));
    out[o + 3] = discAlpha;
  }
}

writeFileSync(join(iconsDir, 'qr-logo.png'), encodePng(SIZE, out));
console.log('qr-logo.png written');
