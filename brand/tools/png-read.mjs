// Minimal PNG reader for the landing-page asset build: 8/16-bit greyscale,
// RGB and RGBA, non-interlaced (the formats the generator writes). Returns
// { width, height, channels, depth, data } with one array element per sample.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export function readPNG(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG: ' + path);
  let o = 8, width, height, depth, type, interlace; const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), kind = buf.toString('ascii', o + 4, o + 8), body = buf.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    o += 12 + len;
  }
  if (interlace) throw new Error('interlaced PNG not supported: ' + path);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  if (!channels || (depth !== 8 && depth !== 16)) throw new Error(`unsupported PNG type ${type}/${depth}: ${path}`);
  const bpp = channels * depth / 8, stride = width * bpp, raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = px.subarray(y * stride, (y + 1) * stride), up = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0, b = up ? up[i] : 0, c = up && i >= bpp ? up[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[i] = v & 255;
    }
  }
  const n = width * height * channels, data = depth === 16 ? new Uint16Array(n) : new Uint8Array(n);
  if (depth === 16) for (let i = 0; i < n; i++) data[i] = px.readUInt16BE(i * 2); else data.set(px);
  return { width, height, channels, depth, data };
}

// .npy float32/float64 little-endian, C order.
export function readNPY(path) {
  const buf = readFileSync(path), hlen = buf.readUInt16LE(8), header = buf.toString('latin1', 10, 10 + hlen);
  const descr = header.match(/'descr':\s*'([^']+)'/)[1], shape = header.match(/'shape':\s*\(([^)]*)\)/)[1].split(',').filter((s) => s.trim()).map(Number);
  const start = 10 + hlen, ab = buf.buffer.slice(buf.byteOffset + start, buf.byteOffset + buf.length);
  const data = descr === '<f4' ? new Float32Array(ab) : descr === '<f8' ? new Float64Array(ab) : null;
  if (!data) throw new Error('unsupported npy dtype ' + descr);
  return { shape, data };
}
