// Face relief maps (heights in mm, <= 0) for tablets: debossed imprint dies,
// sparse polygonal granule breakouts and small pores. The shader samples the
// map in local XY; depth follows the crowned face (conformal by construction).
import * as THREE from 'three';
import { RNG, makeNoise2, clamp } from '../util/rng.js';
import { surfaceParameters } from '../render/surface-priors.js';

export const IMPRINT_LAYOUTS = ['none', 'text', 'stacked', 'cross', 'boxed', 'symbol_code', 'emblem'];
export const IMPRINT_FONTS = { sans: '700 100px "IBM Plex Sans"', serif: '400 100px "Instrument Serif"', mono: '500 100px "IBM Plex Mono"' };
export const EMBLEMS = ['diamond', 'circle', 'triangle', 'shield', 'square', 'heart', 'cross'];

// Emblems in canvas semantics (y down), centred at (cx, cy), overall size span.
function emblemPath(ctx, name, cx, cy, span) {
  const r = span / 2;
  ctx.beginPath();
  if (name === 'circle') ctx.arc(cx, cy, r, 0, Math.PI * 2);
  else if (name === 'triangle') { ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * .92, cy + r * .6); ctx.lineTo(cx - r * .92, cy + r * .6); ctx.closePath(); }
  else if (name === 'shield') { ctx.moveTo(cx - r * .84, cy - r * .88); ctx.lineTo(cx + r * .84, cy - r * .88); ctx.lineTo(cx + r * .72, cy + r * .16); ctx.quadraticCurveTo(cx + r * .4, cy + r * .7, cx, cy + r); ctx.quadraticCurveTo(cx - r * .4, cy + r * .7, cx - r * .72, cy + r * .16); ctx.closePath(); }
  else if (name === 'square') ctx.rect(cx - r, cy - r, 2 * r, 2 * r);
  else if (name === 'heart') { ctx.moveTo(cx, cy + r * .85); ctx.bezierCurveTo(cx + r * 1.3, cy - r * .1, cx + r * .6, cy - r * 1.1, cx, cy - r * .45); ctx.bezierCurveTo(cx - r * .6, cy - r * 1.1, cx - r * 1.3, cy - r * .1, cx, cy + r * .85); ctx.closePath(); }
  else if (name === 'cross') { const a = r * .3; ctx.moveTo(cx - a, cy - r); ctx.lineTo(cx + a, cy - r); ctx.lineTo(cx + a, cy - a); ctx.lineTo(cx + r, cy - a); ctx.lineTo(cx + r, cy + a); ctx.lineTo(cx + a, cy + a); ctx.lineTo(cx + a, cy + r); ctx.lineTo(cx - a, cy + r); ctx.lineTo(cx - a, cy + a); ctx.lineTo(cx - r, cy + a); ctx.lineTo(cx - r, cy - a); ctx.lineTo(cx - a, cy - a); ctx.closePath(); }
  else { ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath(); }
}

// Fit text into a box (mm, in canvas px units via k) and draw it.
function fitText(ctx, text, cx, cy, boxW, boxH, font) {
  ctx.font = IMPRINT_FONTS[font] || IMPRINT_FONTS.sans;
  const m = ctx.measureText(text);
  const w = m.width, asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
  const h = asc + desc;
  const s = Math.min(boxW / Math.max(w, 1), boxH / Math.max(h, 1));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 0, (asc - desc) / 2);
  ctx.restore();
}

// Draw an imprint in "mm space" (origin at tablet centre, y up) onto ctx.
function drawImprint(ctx, im, spec) {
  const span = im.span;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff';
  ctx.save();
  ctx.translate(im.offsetX ?? 0, -(im.offsetY ?? 0));
  // Drawing space is y-down and mapped with a y flip: negate for CCW-positive in the local frame.
  ctx.rotate(-(im.rotation ?? 0) * Math.PI / 180);
  const text = String(im.text ?? '');
  const font = im.font ?? 'sans';
  const stroke = Math.max(.12, span * .055);
  ctx.lineWidth = stroke; ctx.lineJoin = 'round';
  if (im.layout === 'text') fitText(ctx, text, 0, 0, span, span * .62, font);
  else if (im.layout === 'stacked') {
    let lines = text.split('/');
    if (lines.length === 1) { const k = Math.max(1, Math.floor(text.length / 2)); lines = [text.slice(0, k), text.slice(k)]; }
    lines = lines.slice(0, 3).filter(Boolean);
    const step = span * .85 / lines.length;
    lines.forEach((line, i) => fitText(ctx, line, 0, (i - (lines.length - 1) / 2) * step, span, step * .72, font));
  } else if (im.layout === 'cross') {
    let word = text.length % 2 ? text : text + '·';
    word = word.slice(0, 9);
    const mid = Math.floor(word.length / 2), cell = span / word.length;
    for (let i = 0; i < word.length; i++) {
      fitText(ctx, word[i], (i - mid) * cell, 0, cell * .82, cell * .82, font);
      if (i !== mid) fitText(ctx, word[i], 0, (i - mid) * cell, cell * .82, cell * .82, font);
    }
  } else if (im.layout === 'boxed') {
    ctx.lineWidth = stroke * .8;
    ctx.strokeRect(-span * .45, -span * .45, span * .9, span * .9);
    fitText(ctx, text, 0, 0, span * .62, span * .52, font);
  } else if (im.layout === 'symbol_code') {
    emblemPath(ctx, im.symbol ?? 'diamond', -span * .3, 0, span * .32);
    ctx.lineWidth = stroke * .7; ctx.stroke();
    fitText(ctx, text, span * .17, 0, span * .56, span * .34, font);
  } else if (im.layout === 'emblem') {
    emblemPath(ctx, im.symbol ?? 'diamond', 0, 0, span * .8);
    if (im.filled) ctx.fill(); else { ctx.lineWidth = stroke; ctx.stroke(); }
  }
  ctx.restore();
}

function boxBlur(src, w, h, r) {
  if (r < 1) return src;
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    let acc = 0; const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * inv;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc * inv;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

let _canvas = null;
function scratchCanvas(size) {
  if (!_canvas) _canvas = document.createElement('canvas');
  if (_canvas.width !== size) { _canvas.width = size; _canvas.height = size; }
  return _canvas;
}

function imprintMask(im, spec, size, rect, mirror) {
  const cv = scratchCanvas(size);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
  const k = size / rect[2];
  // Drawing space: mm, canvas semantics (y down). Local frame: x right, y up
  // seen from +z. Pixel row grows with local y (texture v). The bottom face is
  // seen from -z, so its artwork is mirrored in x to read correctly.
  ctx.setTransform(mirror ? -k : k, 0, 0, -k, -rect[0] * k, -rect[1] * k);
  drawImprint(ctx, im, spec);
  const img = ctx.getImageData(0, 0, size, size).data;
  const m = new Float32Array(size * size);
  for (let i = 0; i < m.length; i++) m[i] = img[i * 4] / 255;
  return m;
}

export function buildRelief(spec, dims, { size = 1024, previous = null } = {}) {
  const ext = Math.max(dims.L, dims.W) + .6;
  const rect = [-ext / 2, -ext / 2, ext, ext];
  const texel = ext / size;
  const top = new Float32Array(size * size), bot = new Float32Array(size * size);
  const rng = new RNG((spec.seed ?? 1) * 7 + 711);
  const noise = makeNoise2((spec.seed ?? 1) + 31);
  const info = { breakouts: 0, pores: 0, breakoutFaces: spec.breakoutFaces ?? 'top' };
  const geometryFields = [], surface = surfaceParameters(spec);
  // Pores change with grain relief/finish, but the manufactured imprint and
  // pull-outs do not. Reuse their exact fields instead of re-rasterising text
  // and blurring two million texels on each surface-slider input.
  const geometryKey = JSON.stringify([size, dims.L, dims.W, spec.imprint, spec.imprintBack, spec.seed, spec.pressDefects, spec.breakoutDensity, spec.breakoutSize, spec.breakoutFaces]);
  const reuseGeometry = previous?.geometryKey === geometryKey;

  const addImprint = (im, target, mirror) => {
    if (!im || im.layout === 'none' || !(im.depth > 0)) return;
    const mask = imprintMask(im, spec, size, rect, mirror);
    const wall = Math.max(1, Math.round(im.depth * .75 / texel / 2));
    let b = boxBlur(mask, size, size, wall);
    b = boxBlur(b, size, size, Math.max(1, Math.round(wall * .7)));
    const wear = im.wear ?? 0;
    for (let i = 0; i < b.length; i++) {
      if (b[i] <= .01) continue;
      const t = clamp((b[i] - .08) / .84, 0, 1), s = t * t * (3 - 2 * t);
      const x = rect[0] + (i % size + .5) * texel, y = rect[1] + (Math.floor(i / size) + .5) * texel;
      const w = wear === 0 ? 1 : 1 - .25 * wear * (noise(x * 18, y * 18) + 1);
      target[i] = Math.min(target[i], -im.depth * s * w);
    }
  };
  if (!reuseGeometry) {
    addImprint(spec.imprint, top, false);
    addImprint(spec.imprintBack, bot, true);
  } else info.breakouts = previous.info.breakouts;

  // Sparse irregular granule pull-outs (not smooth round dents).
  const press = spec.pressDefects ?? 1;
  for (const [target, tag] of [[top, 1], [bot, 2]]) {
    const r2 = rng.fork(tag);
    if (reuseGeometry) {
      const field = tag === 1 ? previous.geometryTop : previous.geometryBottom;
      target.set(field); geometryFields.push(field);
    } else {
      const expected = Math.PI * dims.L * dims.W * .25 * (spec.breakoutDensity ?? .035) * Math.min(1.5, Math.max(0, press));
      let count = 0, prod = 1; const lim = Math.exp(-Math.min(expected, 20));
      while (prod > lim) { prod *= r2.random(); count++; }
      count = tag === 2 && spec.breakoutFaces !== 'both' ? 0 : Math.max(0, count - 1);
      for (let n = 0; n < count; n++) {
        const ang = r2.uniform(0, Math.PI * 2), rr = Math.sqrt(r2.uniform(.04, .78));
        const cx = rr * Math.cos(ang) * dims.L * .5, cy = rr * Math.sin(ang) * dims.W * .5;
        const radius = (spec.breakoutSize ?? .18) * r2.uniform(.62, 1.18);
        const aspect = r2.uniform(.55, 1.15), rot = r2.uniform(0, Math.PI * 2), sides = r2.int(4, 7);
        const planes = [];
        for (let k = 0; k < sides; k++) planes.push([Math.cos(rot + k * 2 * Math.PI / sides), Math.sin(rot + k * 2 * Math.PI / sides) / aspect, radius * r2.uniform(.72, 1.05)]);
        const depth = r2.uniform(.020, .047) * Math.min(1.7, press);
        const tx = r2.uniform(-.2, .2), ty = r2.uniform(-.2, .2);
        const x0 = Math.floor((cx - radius * 1.6 - rect[0]) / texel), x1 = Math.ceil((cx + radius * 1.6 - rect[0]) / texel);
        const y0 = Math.floor((cy - radius * 1.6 - rect[1]) / texel), y1 = Math.ceil((cy + radius * 1.6 - rect[1]) / texel);
        for (let py = Math.max(0, y0); py <= Math.min(size - 1, y1); py++) for (let px = Math.max(0, x0); px <= Math.min(size - 1, x1); px++) {
          const x = rect[0] + (px + .5) * texel, y = rect[1] + (py + .5) * texel;
          const ux = x - cx, uy = y - cy;
          let inset = Infinity;
          for (const [nx, ny, off] of planes) inset = Math.min(inset, off - nx * ux - ny * uy);
          if (inset <= 0) continue;
          const lip = Math.min(1, inset / .012);
          const crumb = noise(x * 51 + n, y * 51);
          const floor = Math.max(.35, .85 + tx * ux / radius + ty * uy / radius + .16 * crumb);
          const i = py * size + px;
          target[i] = Math.min(target[i], target[i] - depth * lip * floor);
        }
        info.breakouts++;
      }
      geometryFields.push(target.slice());
    }
    // Small pores: jittered cells gated by density (not a pit in every cell).
    const poreDensity = surface.pores;
    if (poreDensity > 0) {
      const cell = surface.pore, pr = r2.fork(9);
      for (let gy = -dims.W / 2; gy < dims.W / 2; gy += cell) for (let gx = -dims.L / 2; gx < dims.L / 2; gx += cell) {
        if (pr.random() >= poreDensity) { pr.random(); continue; }
        const px0 = gx + pr.random() * cell, py0 = gy + pr.random() * cell;
        const rad = cell * pr.uniform(.14, .3), dep = surface.poreDepth * pr.uniform(.5, 1.1);
        const x0 = Math.floor((px0 - rad * 1.5 - rect[0]) / texel), x1 = Math.ceil((px0 + rad * 1.5 - rect[0]) / texel);
        const y0 = Math.floor((py0 - rad * 1.5 - rect[1]) / texel), y1 = Math.ceil((py0 + rad * 1.5 - rect[1]) / texel);
        for (let py = Math.max(0, y0); py <= Math.min(size - 1, y1); py++) for (let px = Math.max(0, x0); px <= Math.min(size - 1, x1); px++) {
          const x = rect[0] + (px + .5) * texel, y = rect[1] + (py + .5) * texel;
          const d = Math.hypot(x - px0, y - py0) / rad + .35 * noise(x * 60, y * 60);
          if (d >= 1) continue;
          const i = py * size + px;
          target[i] = Math.min(target[i], target[i] - dep * Math.min(1, (1 - d) * 3));
        }
        info.pores++;
      }
    }
  }
  const half = new Uint16Array(size * size * 2);
  for (let i = 0; i < size * size; i++) {
    // Imprint edges can contain -0: preserve its half-float sign bit too.
    half[i * 2] = top[i] === 0 ? (1 / top[i] < 0 ? 0x8000 : 0) : THREE.DataUtils.toHalfFloat(top[i]);
    half[i * 2 + 1] = bot[i] === 0 ? (1 / bot[i] < 0 ? 0x8000 : 0) : THREE.DataUtils.toHalfFloat(bot[i]);
  }
  const texture = new THREE.DataTexture(half, size, size, THREE.RGFormat, THREE.HalfFloatType);
  texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return { texture, rect, size, info, top, bottom: bot, geometryKey, geometryTop: geometryFields[0], geometryBottom: geometryFields[1] };
}

// Capsule print: ink mask in (axial mm, arc mm) coordinates.
export function buildCapsuleInk(spec, dims, { size = 512 } = {}) {
  const pr = spec.print;
  if (!pr || !pr.text) return null;
  const circ = Math.PI * 2 * dims.rc;
  const rect = [-dims.L / 2, -circ / 2, dims.L, circ];
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = Math.round(size * rect[3] / rect[2] / 2) * 2;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
  const kx = cv.width / rect[2], ky = cv.height / rect[3];
  ctx.fillStyle = '#fff';
  // Drawing space is (axial mm, arc mm); canvas-up equals local +y seen from above.
  const put = (text, xmm, smm, h) => {
    ctx.setTransform(kx, 0, 0, ky, -rect[0] * kx, -rect[1] * ky);
    fitText(ctx, text, xmm, smm, dims.capLen * .62, h, pr.font ?? 'sans');
  };
  const h = dims.rc * .72;
  put(pr.text, dims.xRim - (dims.xRim + dims.L / 2) * .5, circ * .25, h);
  if (pr.capText) put(pr.capText, dims.xRim + dims.capLen * .45, circ * .25, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = false;
  tex.anisotropy = 4;
  return { texture: tex, rect };
}
