/* Broward Trading — tests for icons/icon-192.png and icons/icon-512.png (PWA maskable icons)
 * Run with:  node tests/icons.test.js
 * manifest.json lists the PNG icons with purpose "any maskable". A maskable icon
 * must be opaque all the way to its edges: launchers crop it with their own mask,
 * so transparent corners show up as wedges. This decodes the PNG with plain node
 * (zlib; RGB or RGBA, non-interlaced) and checks size and that every pixel is opaque.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function decodePng(buf) {
  assert.strictEqual(buf.readUInt32BE(0), 0x89504e47, 'PNG signature');
  let pos = 8;
  let ihdr = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        bitDepth: data[8], colorType: data[9], interlace: data[12]
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  assert.ok(ihdr, 'IHDR present');
  assert.strictEqual(ihdr.bitDepth, 8, '8-bit channels');
  assert.ok(ihdr.colorType === 2 || ihdr.colorType === 6, 'RGB or RGBA colour type (got ' + ihdr.colorType + ')');
  assert.strictEqual(ihdr.interlace, 0, 'not interlaced');
  const bpp = ihdr.colorType === 6 ? 4 : 3;
  const stride = ihdr.width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(stride * ihdr.height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < ihdr.height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); break; }
        default: throw new Error('bad filter ' + filter);
      }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  // Normalise to RGBA so the checks below need not care which type was written.
  let data = out;
  if (bpp === 3) {
    data = Buffer.alloc(ihdr.width * ihdr.height * 4);
    for (let i = 0, j = 0; i < out.length; i += 3, j += 4) { data[j] = out[i]; data[j + 1] = out[i + 1]; data[j + 2] = out[i + 2]; data[j + 3] = 255; }
  }
  return { width: ihdr.width, height: ihdr.height, colorType: ihdr.colorType, data };
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok - ' + name); }

/* manifest.json lists both PNG sizes as "any maskable"; each must pass the same checks.
 * The accent dot sits at (150,66) in the 192px render; coordinates scale with the size. */
for (const size of [192, 512]) {
  const name = 'icon-' + size + '.png';
  const png = decodePng(fs.readFileSync(path.join(__dirname, '..', 'icons', name)));
  const last = size - 1;
  const corners = [[0, 0], [last, 0], [0, last], [last, last]];

  test(name + ' is ' + size + 'x' + size, () => {
    assert.strictEqual(png.width, size);
    assert.strictEqual(png.height, size);
  });

  test(name + ' is fully opaque (no transparent maskable corners)', () => {
    let transparent = 0;
    for (let i = 3; i < png.data.length; i += 4) if (png.data[i] !== 255) transparent++;
    assert.strictEqual(transparent, 0, transparent + ' non-opaque pixels');
    const corner = (x, y) => png.data[(y * png.width + x) * 4 + 3];
    for (const [x, y] of corners) assert.strictEqual(corner(x, y), 255, `corner ${x},${y}`);
  });

  test(name + ' corners carry the dark brand tile, not black/white fill', () => {
    const px = (x, y) => { const o = (y * png.width + x) * 4; return [png.data[o], png.data[o + 1], png.data[o + 2]]; };
    for (const [x, y] of corners) {
      const [r, g, b] = px(x, y);
      assert.ok(r < 40 && g < 40 && b < 50 && b >= r, `corner ${x},${y} should be the dark navy tile, got rgb(${r},${g},${b})`);
    }
  });

  test(name + ' still contains the artwork (accent dot is white at its centre)', () => {
    const x = Math.round(150 * size / 192), y = Math.round(66 * size / 192);
    const o = (y * png.width + x) * 4;
    assert.deepStrictEqual([png.data[o], png.data[o + 1], png.data[o + 2]], [255, 255, 255]);
  });
}

console.log(`\n${passed} passed`);
