// Procedural worktops and backdrops (no photographic textures).
import * as THREE from 'three';
import {oakMaterial} from './wood.js';
import { makeNoise2, RNG, clamp } from '../util/rng.js';

export const SURFACES = { wood: 'Oak wood', brushed_steel: 'Brushed steel', smudged_steel: 'Smudged steel', laminate: 'Laminate' };
const cache = new Map();

function canvasTex(w, h, fn, srgb = true) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  fn(img.data, w, h);
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function surfaceMaterial(kind) {
  if (cache.has(kind)) return cache.get(kind);
  const n = makeNoise2(kind.length * 97 + 5);
  let m;
  const S = 1024;
  if (kind === 'wood') {
    m = oakMaterial();
  } else if (kind === 'laminate') {
    const col = canvasTex(S, S, (d, w, h) => {
      for (let i = 0; i < w * h; i++) {
        const x = i % w, y = Math.floor(i / w);
        const sp = n(x * .9, y * .9), big = n.fbm(x / 180, y / 180, 3);
        const t = .88 + .05 * big + (sp > .55 ? -.12 : 0) + (sp < -.62 ? .05 : 0);
        d[i * 4] = 206 * t; d[i * 4 + 1] = 202 * t; d[i * 4 + 2] = 192 * t; d[i * 4 + 3] = 255;
      }
    });
    m = new THREE.MeshPhysicalMaterial({ map: col, roughness: .5, specularIntensity: .7 });
    m.userData.repeat = 1 / 160;
  } else {
    const smudged = kind === 'smudged_steel';
    const rng = new RNG(smudged ? 71 : 17);
    const rough = canvasTex(S, S, (d, w, h) => {
      const blobs = [];
      if (smudged) for (let k = 0; k < 14; k++) blobs.push([rng.uniform(0, w), rng.uniform(0, h), rng.uniform(30, 110), rng.uniform(.2, .6)]);
      for (let y = 0; y < h; y++) {
        const line = n(0, y * .9) * .5 + n(3, y * 3.1) * .3;
        for (let x = 0; x < w; x++) {
          let v = .34 + .08 * line + .04 * n(x * .02, y * 1.7);
          for (const [bx, by, br, bs] of blobs) { const q = ((x - bx) ** 2 + (y - by) ** 2) / (br * br); if (q < 4) v += bs * .25 * Math.exp(-q * 1.6) * (.6 + .4 * Math.sin((x - bx) * .35 + (y - by) * .2)); }
          const i = (y * w + x) * 4;
          const g = clamp(v, 0, 1) * 255;
          d[i] = g; d[i + 1] = g; d[i + 2] = g; d[i + 3] = 255;
        }
      }
    }, false);
    m = new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setRGB(.74, .74, .72), metalness: 1, roughness: 1.25, roughnessMap: rough, anisotropy: .5, anisotropyRotation: 0 });
    m.userData.repeat = 1 / 240;
  }
  cache.set(kind, m);
  return m;
}

export function worktop(kind, size = [6000, 6000], seed = 1) {
  const g = new THREE.PlaneGeometry(size[0], size[1], Math.ceil(size[0]/150), Math.ceil(size[1]/150));
  const source=surfaceMaterial(kind),m=source.clone();
  m.onBeforeCompile=source.onBeforeCompile;m.customProgramCacheKey=source.customProgramCacheKey;
  const rng = new RNG(seed ^ 0x48319), angle = rng.uniform(0, Math.PI*2), ox=rng.uniform(-2000,2000), oy=rng.uniform(-2000,2000);
  const co=Math.cos(angle),si=Math.sin(angle);
  if(kind==='wood'){m.color.setHSL(rng.uniform(.07,.105),rng.uniform(.02,.08),rng.uniform(.89,1));m.clearcoat=rng.uniform(.06,.22);}
  if(kind.includes('steel'))m.anisotropyRotation=angle;
  const rep = m.userData.repeat;
  const uv = g.attributes.uv;
  // Stable physical texture scale/phase when the acquisition rolls or shifts.
  // The plane is larger than the widest supported frustum, so an off-centre
  // stress sample cannot accidentally reveal the old preview stage boundary.
  const pos=g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i,(pos.getX(i)*co-pos.getY(i)*si+ox)*rep+.5,(pos.getX(i)*si+pos.getY(i)*co+oy)*(m.userData.repeatY??rep)+.5);
  const mesh = new THREE.Mesh(g, m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.userData.label = { instance: 0, semantic: 0 };
  mesh.userData.surfacePose={seed,rotation_deg:angle*180/Math.PI,origin_mm:[ox,oy],tile_mm:[1/rep,1/(m.userData.repeatY??rep)],revision:m.userData.surfaceRevision??'procedural_v1'};
  return mesh;
}

// Stone cyclorama for the specimen studio: floor that curves into a back wall.
export function stoneSweep() {
  const w = 900, depth = 420, radius = 140, height = 380, seg = 48;
  const pts = [];
  pts.push([depth / 2, 0]);
  for (let i = 0; i <= seg; i++) { const a = i / seg * Math.PI / 2; pts.push([-depth / 2 + radius - Math.sin(a) * radius, radius - Math.cos(a) * radius]); }
  pts.push([-depth / 2, height]);
  const pos = [], uv = [], idx = [];
  const cols = 2;
  for (let r = 0; r < pts.length; r++) for (let c = 0; c <= cols; c++) {
    const [z, y] = pts[r];
    pos.push((c / cols - .5) * w, y, z); uv.push(c / cols, r / (pts.length - 1));
  }
  for (let r = 0; r < pts.length - 1; r++) for (let c = 0; c < cols; c++) { const a = r * (cols + 1) + c; idx.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const n = makeNoise2(3);
  const tex = canvasTex(512, 512, (d, w2, h) => { for (let i = 0; i < w2 * h; i++) { const x = i % w2, y = Math.floor(i / w2); const v = 128 + 26 * n.fbm(x / 9, y / 9, 3); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; } }, false);
  tex.repeat.set(10, 10);
  const m = new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setRGB(.31, .285, .25), roughness: .92, bumpMap: tex, bumpScale: .4, specularIntensity: .35, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  mesh.position.z = -60;
  mesh.userData.label = { instance: 0, semantic: 0 };
  return mesh;
}
