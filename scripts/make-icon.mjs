/**
 * Draws the T3 source icon (a checkmark on a rounded square) as a PNG, with no
 * image dependencies. `npx tauri icon` slices this into the per-platform sizes.
 *
 *   node scripts/make-icon.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const S = 1024;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BG = [0x17, 0x17, 0x1b];
const ACCENT = [0x4f, 0x7c, 0xff];
const RADIUS = 224;

const px = Buffer.alloc(S * S * 4);

/** Distance from a point to a line segment, for stroking the checkmark. */
function distToSegment(px_, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px_ - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px_ - cx, py - cy);
}

/** Signed distance to a rounded rectangle centred in the canvas. */
function roundedRectDist(x, y) {
  const half = S / 2;
  const qx = Math.abs(x - half) - (half - RADIUS);
  const qy = Math.abs(y - half) - (half - RADIUS);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - RADIUS;
}

// The checkmark, as two stroked segments.
const STROKE = 84;
const A = [286, 528];
const B = [432, 676];
const C = [742, 356];

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const cx = x + 0.5;
    const cy = y + 0.5;

    // Antialias by treating the distance field edge as a 1px ramp.
    const bgCoverage = Math.min(1, Math.max(0, 0.5 - roundedRectDist(cx, cy)));
    const d = Math.min(
      distToSegment(cx, cy, A[0], A[1], B[0], B[1]),
      distToSegment(cx, cy, B[0], B[1], C[0], C[1]),
    );
    const markCoverage = Math.min(1, Math.max(0, STROKE / 2 - d + 0.5));

    for (let ch = 0; ch < 3; ch++) {
      px[i + ch] = Math.round(BG[ch] * (1 - markCoverage) + ACCENT[ch] * markCoverage);
    }
    px[i + 3] = Math.round(255 * bgCoverage);
  }
}

// -- minimal PNG encoder ------------------------------------------------------

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter: none
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(root, 'src-tauri', 'icons', 'source.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
