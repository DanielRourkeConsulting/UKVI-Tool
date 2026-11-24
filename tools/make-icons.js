// Generates plain PNG icons (blue square with a white tick) with no dependencies.
const zlib = require('zlib'), fs = require('fs'), path = require('path');
const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const inTick = (x, y) => { const u = x / size, v = y / size;
    const seg = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; let t = ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy); t = Math.max(0, Math.min(1, t));
      return Math.hypot(u - (ax + t * dx), v - (ay + t * dy)) < 0.085; };
    return seg(0.24, 0.52, 0.42, 0.70) || seg(0.42, 0.70, 0.78, 0.30); };
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) { const o = y * (size * 4 + 1) + 1 + x * 4; const w = inTick(x, y);
      raw[o] = w ? 255 : 0x1d; raw[o + 1] = w ? 255 : 0x70; raw[o + 2] = w ? 255 : 0xb8; raw[o + 3] = 255; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [16, 48, 128]) fs.writeFileSync(path.join(__dirname, '..', 'icons', s + '.png'), png(s));
