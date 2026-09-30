// Read-only view of one collected scene: decodes the scene's own archive (the
// same bytes that are downloaded) into typed target arrays on demand.
import { unzipSync, strFromU8 } from 'fflate';
import { decodePNG } from '../util/png.js';

const ROOT = 'pill-atelier-dataset/';

export function parseNPY(bytes) {
  if (bytes[0] !== 0x93 || strFromU8(bytes.subarray(1, 6)) !== 'NUMPY') throw new Error('Not an NPY file');
  const major = bytes[6], hlen = major === 1 ? bytes[8] | (bytes[9] << 8) : new DataView(bytes.buffer, bytes.byteOffset + 8, 4).getUint32(0, true);
  const start = major === 1 ? 10 : 12, header = strFromU8(bytes.subarray(start, start + hlen));
  if (!/'descr':\s*'<f4'/.test(header) || /'fortran_order':\s*True/.test(header)) throw new Error(`Unsupported NPY layout: ${header}`);
  const [h, w] = header.match(/'shape':\s*\((\d+),\s*(\d+)/).slice(1).map(Number);
  const dv = new DataView(bytes.buffer, bytes.byteOffset + start + hlen, w * h * 4), data = new Float32Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = dv.getFloat32(i * 4, true);
  return { width: w, height: h, data };
}

export function loadScene(record) {
  const files = unzipSync(record.archive);
  const trainJson = Object.keys(files).find((p) => /^pill-atelier-dataset\/blender\/train\/\d{6}\.json$/.test(p));
  if (!trainJson) throw new Error('Scene archive has no training record');
  const stem = trainJson.slice(0, -'.json'.length), scene = `${ROOT}${record.name}/`;
  const [width, height] = record.meta.camera.resolution_px;
  const memo = new Map();
  const once = (key, fn) => { if (!memo.has(key)) memo.set(key, fn()); return memo.get(key); };
  const png = (path) => once(path, () => {
    if (!files[path]) return null;
    const d = decodePNG(files[path]);
    if (d.width !== width || d.height !== height) throw new Error(`${path}: ${d.width}×${d.height}, expected ${width}×${height}`);
    return d.data;
  });
  const paths = {
    rgb: scene + 'rgb.png', instance: stem + '_instance.png', semantic: stem + '_semantic.png', depth: stem + '_depth.npy',
    film: stem + '_film.png', glare: stem + '_glare.png', sticker: stem + '_sticker.png', print: stem + '_print_instance.png', printMask: stem + '_print.png',
    train: trainJson, meta: scene + 'metadata.json',
  };
  return {
    name: record.name, width, height, files, paths, stem: stem.slice(ROOT.length), meta: record.meta,
    train: JSON.parse(strFromU8(files[trainJson])),
    rgb: () => png(paths.rgb),
    array: (key) => (key === 'depth' ? once('depth', () => (files[paths.depth] ? parseNPY(files[paths.depth]).data : null)) : png(paths[key])),
    bytes: (key) => files[paths[key] ?? key],
    list: () => Object.entries(files).map(([path, b]) => ({ path, short: path.slice(ROOT.length), bytes: b.length })),
  };
}
