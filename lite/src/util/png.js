// Exact, dependency-light PNG codec (zlib via fflate). Browser canvas encoders
// may colour-manage or premultiply; label maps must round-trip bit-exactly, so we
// write and verify PNG bytes ourselves.
import { zlibSync, unzlibSync } from 'fflate';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes, start, end) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// colorType: 0 gray, 2 RGB, 6 RGBA. bitDepth 8 or 16 (16 only for gray).
export function encodePNG({ width, height, data, colorType = 2, bitDepth = 8, level = 6 }) {
  const channels = { 0: 1, 2: 3, 6: 4 }[colorType];
  const bpp = channels * (bitDepth / 8);
  const stride = width * bpp;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1);
    // Filter 1 (Sub) for photographic RGB, 0 (None) for labels: both lossless.
    const filter = colorType === 0 ? 0 : 1;
    raw[o] = filter;
    for (let x = 0; x < width * channels; x++) {
      const i = y * width * channels + x;
      if (bitDepth === 16) {
        const v = data[i];
        raw[o + 1 + x * 2] = (v >> 8) & 255;
        raw[o + 2 + x * 2] = v & 255;
      } else {
        const v = data[i];
        const left = x >= channels ? data[i - channels] : 0;
        raw[o + 1 + x] = filter === 1 ? (v - left) & 255 : v;
      }
    }
  }
  const idat = zlibSync(raw, { level });
  const chunks = [];
  const chunk = (type, body) => {
    const buf = new Uint8Array(12 + body.length);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) buf[4 + i] = type.charCodeAt(i);
    buf.set(body, 8);
    dv.setUint32(8 + body.length, crc32(buf, 4, 8 + body.length));
    chunks.push(buf);
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height);
  ihdr[8] = bitDepth; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunk('IHDR', ihdr);
  if (colorType === 2 || colorType === 6) chunk('sRGB', new Uint8Array([0]));
  chunk('IDAT', idat);
  chunk('IEND', new Uint8Array(0));
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  const total = 8 + chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  out.set(sig, 0);
  let off = 8;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

export function decodePNG(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8, width = 0, height = 0, bitDepth = 8, colorType = 2;
  const idat = [];
  while (off < bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...bytes.subarray(off + 4, off + 8));
    const body = bytes.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      const d = new DataView(body.buffer, body.byteOffset, body.byteLength);
      width = d.getUint32(0); height = d.getUint32(4); bitDepth = body[8]; colorType = body[9];
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const joined = new Uint8Array(idat.reduce((s, c) => s + c.length, 0));
  let o = 0; for (const c of idat) { joined.set(c, o); o += c.length; }
  const raw = unzlibSync(joined);
  const channels = { 0: 1, 2: 3, 6: 4 }[colorType];
  const bpp = channels * (bitDepth / 8);
  const stride = width * bpp;
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = px.subarray(y * stride, (y + 1) * stride);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = prev ? prev[x] : 0, c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[x] = v & 255;
    }
  }
  let data = px;
  if (bitDepth === 16) {
    data = new Uint16Array(width * height * channels);
    for (let i = 0; i < data.length; i++) data[i] = (px[i * 2] << 8) | px[i * 2 + 1];
  }
  return { width, height, bitDepth, colorType, data };
}
