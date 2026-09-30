import {PrintAtlas} from '../labels/print-atlas.js';
// Containers as ONE connected moulded skin (heightfield with signed-distance
// wells), ported from blender/container_v46.py / container_geometry.py.
// Local frame: x = tray width, y = depth, z up; units mm. All artwork fictional.
import * as THREE from 'three';
import { RNG, clamp, smoothstep, makeNoise2 } from '../util/rng.js';
import { vertexNormals } from './tablet.js';

import { containerParameters, TRAY_STYLES } from './container-parameters.js';
export { TRAY_STYLES };
export const CONTAINER_COLORS = {
  blue_polypropylene: { color: [.035, .23, .47], kind: 'opaque' },
  gray_polypropylene: { color: [.30, .35, .44], kind: 'opaque' },
  white_plastic: { color: [.83, .84, .81], kind: 'opaque' },
  pink_polypropylene: { color: [.76, .42, .49], kind: 'opaque' },
  navy_polypropylene: { color: [.018, .052, .13], kind: 'opaque' },
  lilac_polypropylene: { color: [.43, .44, .58], kind: 'opaque' },
  clear_plastic: { color: [.88, .95, .99], kind: 'clear' },
  milky_polypropylene: { color: [.80, .85, .89], kind: 'milky' },
  tinted_clear: { color: [.43, .68, .82], kind: 'clear' },
};
export const TEXTS = {
  de: ['MORGEN', 'MITTAG', 'ABEND', 'NACHT', 'BEDARF', 'RESERVE', 'EXTRA'],
  en: ['MORNING', 'NOON', 'EVENING', 'NIGHT', 'AS NEEDED', 'RESERVE', 'EXTRA'],
  fr: ['MATIN', 'MIDI', 'SOIR', 'NUIT', 'SI BESOIN', 'RÉSERVE', 'EXTRA'],
  it: ['MATTINO', 'MEZZOGIORNO', 'SERA', 'NOTTE', 'AL BISOGNO', 'RISERVA', 'EXTRA'],
};
const PREFIXES = 'Alba Alva Arca Aris Arno Auro Avena Biora Cael Calda Cera Cinna Clara Dela Doria Eira Elio Elva Fara Fena Fior Hela Helio Ilma Iona Iris Isla Kaia Kora Lavo Leda Liora Luma Mael Mara Mira Nara Nela Niva Orsa Pela Quira Rena Sela Tavi Vela Vira'.split(' ');
const SUFFIXES = 'care med vita nova sana vera vale lis nor tel dor niva lino tera mia lora cura well fort avia lumen'.split(' ');
const DESCRIPTORS = { de: ['APOTHEKE', 'PFLEGE ZUHAUSE', 'ARZNEI · SERVICE'], en: ['CARE SYSTEMS', 'DISPENSING', 'HOME CARE'], fr: ['PHARMACIE', 'SOINS'], it: ['FARMACIA', 'CURA'] };
export const LOGOS = ['capsule', 'cross_ring', 'leaf', 'orbit', 'shield', 'wave', 'sunburst', 'diamond', 'scored_tablet'];

export function brandName(rng) { return rng.pick(PREFIXES) + rng.pick(SUFFIXES); }

// Parameters for a style (seeded, within the generator's ranges).
export function trayParams(rng, style, o = {}) {
  const p = containerParameters(rng, style, o);
  p.brand = o.brand ?? brandName(rng);
  p.logo = o.logo ?? rng.pick(LOGOS);
  p.descriptor = rng.pick(DESCRIPTORS[p.language]);
  return p;
}

function roundedRectSDF(px, py, cx, cy, w, h, r) {
  r = Math.min(r, w * .49, h * .49);
  const qx = Math.abs(px - cx) - (w / 2 - r), qy = Math.abs(py - cy) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// Returns { geometry, surfaceZ(x,y) } for the connected skin.
export function buildTraySkin(p, { spacing = .5 } = {}) {
  const W = p.width, D = p.depth, H = p.height, R = p.outerRound ? Math.min(W,D)*.499 : Math.min(p.corner, W * .08, D * .15);
  const nx = Math.ceil(W / spacing), ny = Math.ceil(D / spacing);
  const fillet = Math.min(1.2, p.rim * .3);
  const floor = p.floorZ;
  const zAt = (x, y, edgeDist) => {
    let z = H;
    for (const c of p.cells) {
      let dist, draft = c.draft ?? Math.min(p.draft, c.w * .10, c.h * .10);
      if (p.round) { dist = Math.hypot(x - c.x, y - c.y) - c.w / 2; draft = c.draft ?? p.draft; }
      else dist = roundedRectSDF(x, y, c.x, c.y, c.w, c.h, p.wellCorner ?? 4);
      const t = clamp((dist + draft) / draft, 0, 1);
      // Bowl-like cups: gentler floor curvature.
      const prof = p.round ? Math.pow(t, 1.35) * (3 - 2 * t) * t * .5 + t * t * (3 - 2 * t) * .5 : t * t * (3 - 2 * t);
      z = Math.min(z, floor + (H - floor) * prof);
    }
    // Quarter-round fillet at the outer rim edge.
    if (edgeDist < fillet) { const d = fillet - edgeDist; z -= fillet - Math.sqrt(Math.max(0, fillet * fillet - d * d)); }
    return z;
  };
  const pos = [], uv = [];
  const rowExtent = [];
  for (let j = 0; j <= ny; j++) {
    const y = -D / 2 + D * j / ny;
    const inset = Math.max(Math.abs(y) - (D / 2 - R), 0);
    rowExtent.push(W / 2 - R + Math.sqrt(Math.max(0, R * R - inset * inset)));
  }
  for (let j = 0; j <= ny; j++) {
    const y = -D / 2 + D * j / ny, ext = rowExtent[j];
    for (let i = 0; i <= nx; i++) {
      const x = (i / nx * 2 - 1) * ext;
      // Distance to the rounded-rectangle outline (outward positive -> use negative SDF).
      const edgeDist = -roundedRectSDF(x, y, 0, 0, W, D, R);
      pos.push(x, y, zAt(x, y, Math.max(0, edgeDist)));
      uv.push(x / W + .5, y / D + .5);
    }
  }
  const idx = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 2, d = a + nx + 1;
    idx.push(a, b, c, a, c, d);
  }
  // Skirt: the rim turns down (moulded flange) or forms a full rigid wall.
  const boundary = [];
  for (let i = 0; i <= nx; i++) boundary.push(i);
  for (let j = 1; j <= ny; j++) boundary.push(j * (nx + 1) + nx);
  for (let i = nx - 1; i >= 0; i--) boundary.push(ny * (nx + 1) + i);
  for (let j = ny - 1; j > 0; j--) boundary.push(j * (nx + 1));
  const skirtBottom = p.skirt === 'full' ? floor - p.thickness : H - fillet - p.skirt;
  const start = pos.length / 3;
  for (const b of boundary) {
    const x = pos[b * 3], y = pos[b * 3 + 1];
    // Slight outward draft on the wall.
    const l = Math.hypot(x, y) || 1;
    pos.push(x + x / l * .15, y + y / l * .15, skirtBottom);
    uv.push(uv[b * 2], uv[b * 2 + 1]);
  }
  for (let k = 0; k < boundary.length; k++) {
    const a = boundary[k], b = boundary[(k + 1) % boundary.length], c = start + (k + 1) % boundary.length, d = start + k;
    idx.push(a, d, c, a, c, b);
  }
  // Solidify the connected top + skirt: a real underside and rim, not a zero-thickness sheet.
  // Normal offset gives the film/plastic a physical interface for future transmission transport.
  const outerCount=pos.length/3, outerIndices=idx.slice();
  const outerNormals=vertexNormals(new Float32Array(pos),new Uint32Array(idx),outerCount);
  for(let i=0;i<outerCount;i++) {
    pos.push(pos[i*3]-outerNormals[i*3]*p.thickness,pos[i*3+1]-outerNormals[i*3+1]*p.thickness,pos[i*3+2]-outerNormals[i*3+2]*p.thickness);
    uv.push(uv[i*2],uv[i*2+1]);
  }
  for(let i=0;i<outerIndices.length;i+=3)idx.push(outerIndices[i]+outerCount,outerIndices[i+2]+outerCount,outerIndices[i+1]+outerCount);
  for(let k=0;k<boundary.length;k++) {
    const a=start+k,b=start+(k+1)%boundary.length;
    idx.push(a,a+outerCount,b+outerCount,a,b+outerCount,b);
  }
  const P = new Float32Array(pos), I = new Uint32Array(idx);
  // Orientation check: top faces must point +z.
  const probe = (() => { const a = I[0] * 3, b = I[1] * 3, c = I[2] * 3; return (P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[b + 1] - P[a + 1]) * (P[c] - P[a]); })();
  if (probe < 0) for (let t = 0; t < I.length; t += 3) { const s = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = s; }
  const N = vertexNormals(P, I, P.length / 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(I, 1));
  g.computeBoundingSphere();
  return { geometry: g, zAt: (x, y) => zAt(x, y, 10) };
}

// ---------------------------------------------------------------- printing
function drawLogo(ctx, kind, cx, cy, r, ink) {
  ctx.save(); ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = r * .16; ctx.lineCap = 'round';
  ctx.beginPath();
  if (kind === 'capsule') { ctx.translate(cx, cy); ctx.rotate(-.6); ctx.roundRect(-r, -r * .42, r * 2, r * .84, r * .42); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, -r * .42); ctx.lineTo(0, r * .42); ctx.stroke(); }
  else if (kind === 'cross_ring') { ctx.arc(cx, cy, r, 0, 7); ctx.stroke(); ctx.fillRect(cx - r * .14, cy - r * .6, r * .28, r * 1.2); ctx.fillRect(cx - r * .6, cy - r * .14, r * 1.2, r * .28); }
  else if (kind === 'leaf') { ctx.moveTo(cx - r, cy + r * .8); ctx.quadraticCurveTo(cx - r, cy - r, cx + r, cy - r); ctx.quadraticCurveTo(cx + r * .9, cy + r * .8, cx - r, cy + r * .8); ctx.fill(); }
  else if (kind === 'orbit') { ctx.ellipse(cx, cy, r, r * .42, -.5, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(cx, cy, r * .3, 0, 7); ctx.fill(); }
  else if (kind === 'shield') { ctx.moveTo(cx - r * .8, cy - r); ctx.lineTo(cx + r * .8, cy - r); ctx.lineTo(cx + r * .7, cy + r * .1); ctx.quadraticCurveTo(cx + r * .4, cy + r * .7, cx, cy + r); ctx.quadraticCurveTo(cx - r * .4, cy + r * .7, cx - r * .7, cy + r * .1); ctx.closePath(); ctx.stroke(); }
  else if (kind === 'wave') { for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(cx - r, cy - r * .45 + k * r * .45); ctx.bezierCurveTo(cx - r * .3, cy - r * .9 + k * r * .45, cx + r * .3, cy + k * r * .45, cx + r, cy - r * .45 + k * r * .45); ctx.stroke(); } }
  else if (kind === 'sunburst') { ctx.arc(cx, cy, r * .42, 0, 7); ctx.fill(); for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * .6, cy + Math.sin(a) * r * .6); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke(); } }
  else if (kind === 'scored_tablet') { ctx.arc(cx, cy, r, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx - r * .7, cy); ctx.lineTo(cx + r * .7, cy); ctx.stroke(); }
  else { ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * .8, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * .8, cy); ctx.closePath(); ctx.stroke(); }
  ctx.restore();
}

const TIME_ICONS = ['sunrise', 'sun', 'sunset', 'moon'];
function drawTimeIcon(ctx, kind, cx, cy, r, ink) {
  ctx.save(); ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = r * .16; ctx.lineCap = 'round';
  if (kind === 'moon') { ctx.beginPath(); ctx.arc(cx, cy, r * .8, 0, 7); ctx.fill(); ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.arc(cx + r * .38, cy - r * .25, r * .7, 0, 7); ctx.fill(); }
  else {
    const half = kind !== 'sun';
    ctx.beginPath(); ctx.arc(cx, cy + (half ? r * .25 : 0), r * .45, half ? Math.PI : 0, Math.PI * 2); ctx.stroke();
    for (let k = 0; k < 7; k++) { const a = Math.PI + k / 6 * Math.PI; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * .68, cy + (half ? r * .25 : 0) + Math.sin(a) * r * .68); ctx.lineTo(cx + Math.cos(a) * r, cy + (half ? r * .25 : 0) + Math.sin(a) * r); ctx.stroke(); }
    if (half) { ctx.beginPath(); ctx.moveTo(cx - r, cy + r * .3); ctx.lineTo(cx + r, cy + r * .3); ctx.stroke(); }
  }
  ctx.restore();
}

// Colour map for the skin: base plastic + printed labels and branding.
export function trayPrintTexture(p, base, { size = 2048, lightInk = false } = {}) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = Math.round(size * p.depth / p.width);
  const ctx = cv.getContext('2d', {willReadFrequently:true});
  const k = cv.width / p.width;
  const toHex = (c) => '#' + c.map((v) => Math.round(Math.pow(clamp(v, 0, 1), 1 / 2.2) * 255).toString(16).padStart(2, '0')).join('');
  ctx.fillStyle = toHex(base); ctx.fillRect(0, 0, cv.width, cv.height);
  const atlas = new PrintAtlas(cv);
  const ink = lightInk ? '#e8e9e3' : '#12161c';
  // mm -> px with local +y at the canvas top (texture flipY).
  ctx.setTransform(k, 0, 0, -k, p.width / 2 * k, p.depth / 2 * k);
  const text = (s, x, y, h, weight = 600, font = 'IBM Plex Sans', track = .08, maxW = 999) => {
    ctx.save(); ctx.translate(x, y); ctx.scale(1, -1);
    ctx.font = `${weight} 100px "${font}"`;
    ctx.letterSpacing = `${track * 100}px`;
    const m = ctx.measureText(s);
    const sc = Math.min(h / 72, maxW / Math.max(1, m.width));
    ctx.scale(sc, sc); ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(s, 0, 0); ctx.restore();
    atlas.capture('tray_text',{text:s});
  };
  const names = TEXTS[p.language];
  p.cells.forEach((c, i) => {
    const name = c.name ?? names[i] ?? String(i + 1);
    const labelY = p.rows > 1 ? (c.row === 0 ? c.y + c.h / 2 + p.rim * .45 : c.y - c.h / 2 - p.rim * .45) : (p.brandPlacement === 'top' ? c.y - c.h / 2 - p.rim * .5 : c.y + c.h / 2 + p.rim * .5);
    const lh = Math.min(p.rim * .42, 2.6);
    const iconR = lh * .62;
    const wText = Math.min(c.w * .6, name.length * lh * .78);
    text(name, c.x + iconR * 1.2, labelY, lh, 600, 'IBM Plex Sans', .12, wText);
    ctx.save(); ctx.translate(c.x - wText / 2 - iconR * .4, labelY); ctx.scale(1, -1);
    drawTimeIcon(ctx, TIME_ICONS[i % 4], 0, 0, iconR, ink); ctx.restore();
    atlas.capture('time_icon',{icon:TIME_ICONS[i%4],compartment:i});
  });
  // Branding occupies the parameterized flange or side panel, not a fixed position.
  if (p.brandPanel) {
    const bp=p.brandPanel, side=['left','right'].includes(p.brandPlacement);
    const bh=Math.min(side ? bp.h*.16 : bp.h*.70, side ? bp.w*.19 : 3.6);
    if(side) {
      ctx.save();ctx.translate(bp.x,bp.y+bh*1.8);ctx.scale(1,-1);drawLogo(ctx,p.logo,0,0,bh*.8,ink);ctx.restore();atlas.capture('brand_logo',{symbol:p.logo});
      text(p.brand,bp.x,bp.y-bh*.45,bh,700,'Instrument Serif',.02,bp.w*.90);
      text(p.descriptor,bp.x,bp.y-bh*1.8,bh*.32,500,'IBM Plex Sans',.08,bp.w*.90);
    } else {
      ctx.save();ctx.translate(bp.x-bp.w*.39,bp.y);ctx.scale(1,-1);drawLogo(ctx,p.logo,0,0,bh*.65,ink);ctx.restore();atlas.capture('brand_logo',{symbol:p.logo});
      text(p.brand,bp.x+bp.w*.05,bp.y,bh,700,'Instrument Serif',.02,bp.w*.70);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData.printTarget = atlas.finish();
  return tex;
}

// ---------------------------------------------------------------- covers
// Seeded oil/fingerprint + scratch field (roughness/haze), cover_wear.smudges.
export function smudgeTexture(seed, width, depth, { nx = 1536 } = {}) {
  const ny = Math.round(nx * depth / width);
  const rng = new RNG(seed), noise = makeNoise2(seed);
  const field = new Float32Array(nx * ny);
  const prints = rng.int(2, 7);
  for (let f = 0; f < prints; f++) {
    const cx = rng.uniform(-width * .44, width * .44), cy = rng.pick([-1, 1]) * rng.uniform(depth * .1, depth * .42);
    const rx = rng.uniform(4, 9), ry = rng.uniform(6, 12), ang = rng.uniform(0, 6.28), co = Math.cos(ang), si = Math.sin(ang);
    const spacing = rng.uniform(.34, .55), strength = rng.uniform(.2, .6);
    const x0 = Math.floor((cx - 14 + width / 2) / width * nx), x1 = Math.ceil((cx + 14 + width / 2) / width * nx);
    const y0 = Math.floor((cy - 14 + depth / 2) / depth * ny), y1 = Math.ceil((cy + 14 + depth / 2) / depth * ny);
    for (let j = Math.max(0, y0); j < Math.min(ny, y1); j++) for (let i = Math.max(0, x0); i < Math.min(nx, x1); i++) {
      const x = (i + .5) / nx * width - width / 2, y = (j + .5) / ny * depth - depth / 2;
      const dx = (x - cx) * co + (y - cy) * si, dy = -(x - cx) * si + (y - cy) * co;
      const env = Math.exp(-((dx / rx) ** 2 + (dy / ry) ** 2) * 1.8);
      if (env < .01) continue;
      const curved = Math.hypot(dx + 1.5 * Math.sin(dy * .18), .65 * (dy + ry * 1.5));
      const ridge = Math.pow(.5 + .5 * Math.sin(curved * 6.283 / spacing), 3);
      const contact = clamp(.65 + .25 * Math.sin(dx * .74 + dy * .51) + .22 * Math.sin(dx * 1.7 - dy * 1.28), 0, 1);
      const v = env * (.35 + .65 * ridge) * contact * strength;
      field[j * nx + i] = Math.max(field[j * nx + i], v);
    }
  }
  // Dragged smear and faint handling haze.
  if (rng.chance(.5)) {
    const cx = rng.uniform(-width * .3, width * .3), cy = rng.uniform(-depth * .2, depth * .2), sx = rng.uniform(18, 35);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = (i + .5) / nx * width - width / 2, y = (j + .5) / ny * depth - depth / 2;
      const c = Math.exp(-(((x - cx) / sx) ** 2) - (((y - cy) / 4.5) ** 2)) * (.12 + .05 * Math.sin(x * .3 + y * .49));
      field[j * nx + i] = Math.max(field[j * nx + i], c);
    }
  }
  // Fine scratches: thin straight/curved lines.
  const scratches = rng.int(6, 18);
  for (let s = 0; s < scratches; s++) {
    let x = rng.uniform(-width / 2, width / 2), y = rng.uniform(-depth / 2, depth / 2);
    const ang = rng.uniform(0, 6.28), len = rng.uniform(4, 30), bend = rng.uniform(-.02, .02), str = rng.uniform(.25, .7);
    let a = ang;
    for (let t = 0; t < len; t += .12) {
      a += bend * .12; x += Math.cos(a) * .12; y += Math.sin(a) * .12;
      const i = Math.floor((x + width / 2) / width * nx), j = Math.floor((y + depth / 2) / depth * ny);
      if (i >= 0 && j >= 0 && i < nx && j < ny) field[j * nx + i] = Math.max(field[j * nx + i], str * (.6 + .4 * noise(t, s)));
    }
  }
  const data = new Uint8Array(nx * ny);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(clamp(field[i], 0, 1) * 255);
  const tex = new THREE.DataTexture(data, nx, ny, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return { texture: tex, prints, scratches };
}

// Bowed / rippled sheet supported on its long edges (rail constrained), local z up.
export function coverSheet(p, rng, { film = false, shift = 0, profile = null, nx = 140, ny = 44 } = {}) {
  const mode = profile ?? rng.weighted(['nearly_flat', 'bowed', 'rippled', 'bowed_rippled'], [12, 32, 22, 34]);
  let bow = film ? rng.uniform(.18, 1.1) : rng.uniform(.25, 2.2);
  if (mode === 'nearly_flat') bow = rng.uniform(.02, .1);
  const ripple = mode === 'nearly_flat' || mode === 'bowed' ? 0 : bow * rng.uniform(.2, .65);
  const cycles = rng.uniform(1.1, 3.1), phase = rng.uniform(0, 6.28), cross = rng.uniform(0, 6.28);
  const W = p.width - 1.5, Dd = p.depth - 1.5, z0 = p.height + .8;
  const pos = [], uv = [];
  let maxLift = 0;
  for (let j = 0; j <= ny; j++) {
    const v = j / ny * 2 - 1, y = v * Dd / 2, env = Math.max(0, 1 - v * v);
    for (let i = 0; i <= nx; i++) {
      const u = i / nx, x = (u - .5) * W;
      const broad = bow * (.82 + .18 * Math.cos((u - .5) * Math.PI));
      const wave = ripple * (.68 * Math.sin(cycles * 6.283 * u + phase) + .32 * Math.sin(1.7 * 6.283 * u + 1.4 * v + cross));
      const fine = mode.includes('rippled') ? (film ? .09 : .025) * Math.sin(u * 6.283 * 7.3 + v * 2 + phase) : 0;
      const dz = env * Math.max(0, broad + wave + fine);
      maxLift = Math.max(maxLift, dz);
      pos.push(x + shift, y, z0 + dz);
      uv.push(u, j / ny);
    }
  }
  const idx = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i; idx.push(a, a + 1, a + nx + 2, a, a + nx + 2, a + nx + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const heightAt = (x, y) => {
    const u = clamp((x - shift) / W + .5, 0, 1), v = clamp(y / (Dd / 2), -1, 1), env = Math.max(0, 1 - v * v);
    const broad = bow * (.82 + .18 * Math.cos((u - .5) * Math.PI));
    const wave = ripple * (.68 * Math.sin(cycles * 6.283 * u + phase) + .32 * Math.sin(1.7 * 6.283 * u + 1.4 * v + cross));
    return z0 + env * Math.max(0, broad + wave);
  };
  return { geometry: g, record: { profile: mode, bow_mm: +bow.toFixed(3), ripple_mm: +ripple.toFixed(3), max_lift_mm: +maxLift.toFixed(3), shift_mm: +shift.toFixed(2), film }, heightAt, size: [W, Dd] };
}

// Transparent thin-sheet material: reflection + Fresnel/haze-weighted
// transmission via premultiplied blending (no opaque white overlay).
export function makeFilmMaterial(smudge, { roughness = .04, haze = .5 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness, metalness: 0, ior: 1.5, specularIntensity: 1, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  const u = { uSmudge: { value: smudge }, uHaze: { value: haze }, uBaseRough: { value: roughness } };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vFilmUv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFilmUv = uv;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFilmUv; uniform sampler2D uSmudge; uniform float uHaze; uniform float uBaseRough; float pa_haze = 0.0;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nfloat smv = texture2D(uSmudge, vFilmUv).r; roughnessFactor = clamp(uBaseRough + smv * 0.45, 0.02, 1.0); pa_haze = smv * uHaze; diffuseColor.rgb = vec3(0.85) * pa_haze;')
      .replace('#include <opaque_fragment>', `
        vec3 Vv = normalize(vViewPosition);
        float cosT = abs(dot(normalize(normal), Vv));
        float F = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
        float a = clamp(F + pa_haze * 0.28, 0.0, 1.0);
        gl_FragColor = vec4(outgoingLight, a);`);
  };
  m.customProgramCacheKey = () => 'pa-film';
  m.userData.uniforms = u;
  return m;
}

// Fictional patient-style paper label (invented identifiers only).
export function stickerTexture(rng, { w = 46, h = 17, firstId=1001 } = {}) {
  const cv = document.createElement('canvas');
  const k = 16; cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  const ctx = cv.getContext('2d', {willReadFrequently:true});
  const paper = rng.pick(['#f1efe6', '#f6f4ee', '#e9efed', '#f3efd9']);
  ctx.fillStyle = paper; ctx.fillRect(0, 0, cv.width, cv.height);
  const atlas = new PrintAtlas(cv,firstId);
  const style = rng.pick(['thermal_barcode', 'blue_stripe', 'compact_id']);
  ctx.fillStyle = '#1b1d22';
  const nm = 'TESTPATIENT ' + String.fromCharCode(65 + rng.int(0, 25));
  const id = 'DEMO-' + rng.int(100000, 999999);
  const ward = rng.pick(['STATION 6 / ZIMMER 16', 'WARD B · BED 4', 'UNIT 3 · RM 12', 'STATION 2 / ZI. 7']);
  if (style === 'blue_stripe') { ctx.fillStyle = '#2d5d9a'; ctx.fillRect(0, 0, cv.width, cv.height * .2); ctx.fillStyle = '#1b1d22'; }
  const y0 = style === 'blue_stripe' ? .34 : .24;
  ctx.font = `700 ${h * k * .2}px "IBM Plex Sans"`; ctx.fillText(nm, w * k * .06, h * k * y0 + h * k * .1);
  ctx.font = `500 ${h * k * .15}px "IBM Plex Mono"`; ctx.fillText(id, w * k * .06, h * k * (y0 + .3));
  ctx.font = `500 ${h * k * .12}px "IBM Plex Sans"`; ctx.fillText(ward, w * k * .06, h * k * (y0 + .52));
  if (style === 'thermal_barcode') {
    let x = w * k * .7;
    while (x < w * k * .95) { const bw = rng.pick([1, 1, 2, 3]) * 2; if (rng.chance(.6)) ctx.fillRect(x, h * k * .2, bw, h * k * .55); x += bw + 2; }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  atlas.capture('sticker_ink',{text:[nm,id,ward].join(' | ')});
  tex.userData.printTarget=atlas.finish();
  return { texture: tex, record: { style, name: nm, id, ward, size_mm: [w, h], fictional: true } };
}
