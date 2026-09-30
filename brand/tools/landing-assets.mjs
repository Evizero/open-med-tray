// Landing-page imagery, derived only from genuine generator output:
//
//  - Hero: one Open Med Tray Lite dataset export (rgb.png + 16-bit
//    instance_ids.png, 1536 x 768) captured by capture-landing.mjs. The pill
//    instances become vector outlines (marching squares on the ID map) with
//    their integer IDs and classes from metadata.json.
//  - Target stack: one Open Med Tray (Cycles) scene from the v4.6 test split
//    with its own instance, class, depth, cover, sticker and printed-ink maps,
//    recoloured for a light page. Values are not altered, only coloured.
//  - Edition images: one further scene from each generator.
//
// When a source is missing (e.g. in the final repository, where the corpora
// and temporary captures are absent) the committed files in brand/img/ are
// used unchanged.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { readPNG, readNPY } from './png-read.mjs';

export const HERO_SCENE = 'scene_0001', BENCH_SCENE = 'scene_0005';
export const STACK_SCENE = '00008', CYCLES_BENCH = '00062';

// ---------- PNG writer (8-bit RGB) ----------
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
export function writePNG(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.subarray(y * w * 3, (y + 1) * w * 3).forEach((v, i) => { raw[y * (w * 3 + 1) + 1 + i] = v; }); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- contours ----------
// Marching squares on a binary mask; returns closed loops in pixel-edge
// coordinates (pixel centres at +.5), simplified (Ramer–Douglas–Peucker).
function contours(mask, w, h, x0, y0, x1, y1) {
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] ? 1 : 0;
  const segs = new Map(); const key = (p) => p[0] * 4096 + p[1];
  const add = (a, b) => { segs.set(key(a), b); };
  // Edge midpoints in doubled integer coordinates to keep keys exact.
  for (let y = y0 - 1; y <= y1; y++) for (let x = x0 - 1; x <= x1; x++) {
    const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1);
    const c = tl * 8 + tr * 4 + br * 2 + bl;
    const T = [2 * x + 2, 2 * y + 1], R = [2 * x + 3, 2 * y + 2], B = [2 * x + 2, 2 * y + 3], L = [2 * x + 1, 2 * y + 2];
    // Oriented so that the inside is on the right.
    switch (c) {
      case 1: add(L, B); break; case 2: add(B, R); break; case 3: add(L, R); break; case 4: add(R, T); break;
      case 5: add(L, T); add(R, B); break; case 6: add(B, T); break; case 7: add(L, T); break; case 8: add(T, L); break;
      case 9: add(T, B); break; case 10: add(T, R); add(B, L); break; case 11: add(T, R); break; case 12: add(R, L); break;
      case 13: add(R, B); break; case 14: add(B, L); break; default: break;
    }
  }
  const loops = [];
  for (const [k0] of segs) {
    if (!segs.has(k0)) continue;
    const loop = []; let k = k0;
    while (segs.has(k)) { const p = segs.get(k); segs.delete(k); loop.push(p); k = key(p); }
    if (loop.length > 8) loops.push(loop.map(([a, b]) => [a / 2, b / 2]));
  }
  return loops;
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts.at(-1)]; let dmax = 0, idx = 0;
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / len; if (d > dmax) { dmax = d; idx = i; } }
  if (dmax <= eps) return [a, b];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}
// Closed loop -> smooth path (Catmull-Rom as cubic Béziers) through the simplified points.
function smoothPath(loop) {
  // Split the closed loop at its farthest point from the start, simplify both halves.
  let far = 0, best = -1; for (let i = 0; i < loop.length; i++) { const d = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2; if (d > best) { best = d; far = i; } }
  const p = [...rdp(loop.slice(0, far + 1), .6).slice(0, -1), ...rdp([...loop.slice(far), loop[0]], .6).slice(0, -1)], n = p.length; if (n < 3) return '';
  const f = (v) => +v.toFixed(1);
  let d = `M${f(p[0][0])} ${f(p[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + 'Z';
}

// Pill outlines of a Lite export: [{ id, cls, cx, cy, r, d }], sorted left to right.
export function heroLabels(dir) {
  const inst = readPNG(dir + 'instance_ids.png'), meta = JSON.parse(readFileSync(dir + 'metadata.json', 'utf8'));
  const classes = JSON.parse(readFileSync(new URL('../../configs/classes.json', import.meta.url), 'utf8'));
  const { width: w, height: h, data } = inst, items = [];
  // The render and the ID map must be the same export on the same pixel grid.
  const rgb = readPNG(dir + 'rgb.png');
  if (rgb.width !== w || rgb.height !== h) throw new Error(`hero render ${rgb.width}x${rgb.height} != ID map ${w}x${h}`);
  if (!meta.files || !meta.files.rgb.endsWith('/rgb.png') || meta.files.rgb.split('/')[0] !== meta.files.instance_ids.split('/')[0]) throw new Error('hero render and IDs are not one scene');
  const byId = new Map();
  for (let i = 0; i < data.length; i++) { const v = data[i]; if (v < 10 || v >= 500) continue; let b = byId.get(v); if (!b) byId.set(v, b = { n: 0, sx: 0, sy: 0, x0: w, y0: h, x1: 0, y1: 0 }); const x = i % w, y = (i / w) | 0; b.n++; b.sx += x; b.sy += y; if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; }
  for (const [id, b] of byId) {
    if (b.n < 40) continue;
    const mask = new Uint8Array(w * h); for (let i = 0; i < data.length; i++) if (data[i] === id) mask[i] = 1;
    const d = contours(mask, w, h, b.x0, b.y0, b.x1, b.y1).map(smoothPath).join('');
    const cls = classes[meta.instance_to_class[String(id)]]?.name ?? 'pill';
    items.push({ id, cls, cx: +(b.sx / b.n + .5).toFixed(1), cy: +(b.sy / b.n + .5).toFixed(1), r: +(Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2).toFixed(1), d });
  }
  items.sort((a, b) => a.cx - b.cx);
  return { w, h, scene: meta.scene, seed: meta.seed, files: { rgb: meta.files.rgb, instance_ids: meta.files.instance_ids }, items };
}

// ---------- Cycles target maps, recoloured for a light page ----------
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const PAPER = hex('#F4F3EF'), INK = hex('#0C2740'), ACCENT = hex('#1B64BE'), NAVY = hex('#0E3A66');
const PILL = ['#1B64BE', '#E0873A', '#2E9E8F', '#C4513F', '#6CB6F2', '#7A5CC8', '#D9A521', '#0E3A66', '#B34A7C', '#5DAE5A', '#4F7FD9', '#9A6B3F'].map(hex);
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

export function stackLayers(dir, n) {
  const P = (s) => readPNG(dir + n + s);
  const rgb = P('.png'), inst = P('_instance.png'), sem = P('_semantic.png'), film = P('_film.png'), stk = P('_sticker.png'), ink = P('_print.png');
  const depth = readNPY(dir + n + '_depth.npy').data;
  const classes = JSON.parse(readFileSync(new URL('../../configs/classes.json', import.meta.url), 'utf8'));
  const { width: w, height: h } = inst, N = w * h, ch = rgb.channels;
  const layer = (fn) => { const out = new Uint8Array(N * 3); for (let i = 0; i < N; i++) { const c = fn(i); out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2]; } return writePNG(w, h, out); };
  const edge = (arr, i) => { const x = i % w, v = arr[i]; return (x > 0 && arr[i - 1] !== v) || (x < w - 1 && arr[i + 1] !== v) || (i >= w && arr[i - w] !== v) || (i < N - w && arr[i + w] !== v); };
  const ids = [...new Set(inst.data)].filter((v) => v >= 10 && v < 500).sort((a, b) => a - b);
  const colorOf = new Map(ids.map((id, k) => [id, PILL[k % PILL.length]]));
  // Quiet photographic base for masks: the render, desaturated towards paper.
  const base = (i) => { const l = (rgb.data[i * ch] * .3 + rgb.data[i * ch + 1] * .59 + rgb.data[i * ch + 2] * .11) / 255; return mix(PAPER, [60, 66, 74], .55 * (1 - l) + .12); };
  const tint = (mask, i) => { const b = base(i); return mask.data[i] ? (edge(mask.data, i) ? ACCENT : mix(b, ACCENT, .5)) : b; };
  const finite = []; for (let i = 0; i < N; i++) if (depth[i] < 1e3) finite.push(depth[i]);
  finite.sort((a, b) => a - b);
  const d0 = finite[Math.floor(finite.length * .01)], d1 = finite[Math.floor(finite.length * .99)], step = .004;
  const band = (i) => Math.floor(depth[i] / step);
  const out = {
    instance: layer((i) => { const v = inst.data[i]; if (!v) return PAPER; const c = v >= 10 && v < 500 ? colorOf.get(v) : v >= 500 && v < 1000 ? [170, 174, 180] : v >= 1000 ? [236, 238, 241] : [214, 221, 229]; return edge(inst.data, i) ? mix(c, INK, .45) : c; }),
    class: layer((i) => { const s = sem.data[i]; if (!s) return PAPER; const c = s === 1 ? [214, 221, 229] : classes[s].color; return edge(sem.data, i) ? mix(c, INK, .4) : c; }),
    depth: layer((i) => { if (!(depth[i] < 1e3)) return PAPER; const t = Math.min(1, Math.max(0, (depth[i] - d0) / (d1 - d0))); const c = mix(NAVY, [216, 232, 246], t); const x = i % w; const iso = (x < w - 1 && band(i + 1) !== band(i) && depth[i + 1] < 1e3) || (i < N - w && band(i + w) !== band(i) && depth[i + w] < 1e3); return iso ? mix(c, [255, 255, 255], .35) : c; }),
    cover: layer((i) => tint(film, i)),
    sticker: layer((i) => tint(stk, i)),
    ink: layer((i) => ink.data[i] ? INK : sem.data[i] ? [226, 229, 233] : PAPER),
  };
  const present = [...new Set(sem.data)].filter((s) => s >= 2).sort((a, b) => a - b).map((s) => ({ id: s, name: classes[s].name.replace(/_/g, ' '), color: '#' + classes[s].color.map((v) => v.toString(16).padStart(2, '0')).join('') }));
  return { w, h, layers: out, pills: ids.length, classes: present, depthRange: [d0, d1] };
}

export function sourcesFor(ROOT, SOURCES) {
  const corpus = [ROOT + 'artifacts/dataset-v46/test/', ROOT + '../dataset-v46/test/'].find((d) => existsSync(d + STACK_SCENE + '.png'));
  const lite = SOURCES + 'lite-collection/pill-atelier-dataset/';
  return { corpus, lite: existsSync(lite + HERO_SCENE + '/rgb.png') ? lite : null };
}
export { writeFileSync };
