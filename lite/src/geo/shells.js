// Surfaces of revolution along local X: softgels (rotary-die, port of
// blender/softgel_geometry.py) and two-piece hard capsules (cap telescoped over
// body with a real lip step). Units: mm.
import { vertexNormals, surfaceIndices } from './tablet.js';
import { RNG, clamp } from '../util/rng.js';

// Softgel: in scaled coordinates (x/cap, y/(w/2), z/(h/2)) the shell is exactly a
// capsule of radius 1 around the segment |x| <= straight/2. The shader relies on
// this for an analytic chord length (Beer-Lambert path through the fill).
export function softgelDims(spec) {
  const L = spec.length, W = Math.min(spec.width, L), H = Math.min(spec.thickness, W);
  const straightFrac = spec.shape === 'oblong' ? clamp(spec.straight ?? .45, 0, .6) : 0;
  const straight = straightFrac * L;
  const cap = (L - straight) / 2;
  return { L, W, H, straight, cap };
}

export function buildSoftgel(spec, { n = 160, endRings = 34 } = {}) {
  const d = softgelDims(spec);
  const rng = new RNG(spec.seed ?? 1);
  const phase = rng.uniform(0, Math.PI * 2);
  const asym = clamp(spec.asymmetry ?? .004, 0, .02);
  // [x, radius factor, latitude]: latitude gives the analytic normal. With a
  // zero straight section the middle rings coincide (fixed topology for
  // morphing), so normals must not come from (degenerate) faces.
  const rings = [];
  for (let j = 1; j <= endRings; j++) { const a = -Math.PI / 2 + j * Math.PI / 2 / endRings; rings.push([-d.straight / 2 + d.cap * Math.sin(a), Math.cos(a), a]); }
  for (let j = 1; j < 10; j++) rings.push([-d.straight / 2 + d.straight * j / 10, 1, 0]);
  for (let j = 0; j < endRings; j++) { const a = j * Math.PI / 2 / endRings; rings.push([d.straight / 2 + d.cap * Math.sin(a), Math.cos(a), a]); }
  const R = rings.length, vcount = R * n + 2;
  const pos = new Float32Array(vcount * 3);
  for (let r = 0; r < R; r++) {
    const [x, rr] = rings[r];
    for (let k = 0; k < n; k++) {
      const a = k * 2 * Math.PI / n;
      // Small smooth forming variation, never a lumpy candy surface.
      const warp = 1 + asym * Math.sin(a * 2 + phase) * Math.sin(Math.PI * (x / d.L + .5));
      const o = (r * n + k) * 3;
      pos[o] = x; pos[o + 1] = d.W / 2 * rr * Math.cos(a) * warp; pos[o + 2] = d.H / 2 * rr * Math.sin(a) * warp;
    }
  }
  const p0 = R * n, p1 = R * n + 1;
  pos[p0 * 3] = -d.L / 2; pos[p1 * 3] = d.L / 2;
  const index = surfaceIndices(R, n, { poles: true });
  // Analytic normals: capsule normal in scaled space, mapped by the scale.
  const nrm = new Float32Array(vcount * 3);
  const put = (o, sx, sy, sz) => { const nx = sx / d.cap, ny = sy / (d.W / 2), nz = sz / (d.H / 2), l = Math.hypot(nx, ny, nz) || 1; nrm[o] = nx / l; nrm[o + 1] = ny / l; nrm[o + 2] = nz / l; };
  for (let r = 0; r < R; r++) {
    const lat = rings[r][2];
    for (let k = 0; k < n; k++) { const a = k * 2 * Math.PI / n; put((r * n + k) * 3, Math.sin(lat), Math.cos(lat) * Math.cos(a), Math.cos(lat) * Math.sin(a)); }
  }
  put(p0 * 3, -1, 0, 0); put(p1 * 3, 1, 0, 0);
  return { positions: pos, normals: nrm, index, dims: d, vcount, rings: R, n };
}

// Revolve a (x, r) profile around X. closeStart/closeEnd add pole vertices.
function revolve(profile, n, ovality = 1, wobble = null) {
  const R = profile.length, vcount = R * n;
  const pos = new Float32Array(vcount * 3);
  for (let r = 0; r < R; r++) {
    const [x, rad] = profile[r];
    for (let k = 0; k < n; k++) {
      const a = k * 2 * Math.PI / n;
      const w = wobble ? wobble(x, a) : 0;
      const o = (r * n + k) * 3;
      pos[o] = x; pos[o + 1] = (rad + w) * Math.cos(a); pos[o + 2] = (rad + w) * Math.sin(a) * ovality;
    }
  }
  const index = surfaceIndices(R, n);
  return { positions: pos, normals: vertexNormals(pos, index, vcount), index, vcount };
}

export function capsuleDims(spec) {
  const L = spec.length;
  const rb = clamp(spec.width / 2, 1.2, L * .38);
  const wall = clamp(spec.capWall ?? .105, .06, .3);
  const rc = rb + wall;
  const capFrac = clamp(spec.capFraction ?? .54, Math.max(.38,(rc+wall*.5+.12)/L), Math.min(.62,1-(rb+.12)/L));
  const capLen = capFrac * L;
  const xRim = L / 2 - capLen;
  // The closed body tip and the cap dome are hemispheres; the cap overlaps the body.
  return { L, rb, rc, wall, capFrac, capLen, xRim, W: rc * 2, H: rc * 2 * (spec.ovality ?? .99) };
}

export function buildCapsule(spec, { n = 160 } = {}) {
  const d = capsuleDims(spec);
  const rng = new RNG(spec.seed ?? 3);
  const ph = rng.uniform(0, 6.28), ph2 = rng.uniform(0, 6.28);
  const ov = d.H / d.W;
  // Body: closed hemispherical tip at -X, cylinder running hidden inside the cap.
  const body = [];
  const bodyTip = -d.L / 2;
  // A straight body tube must stop before the cap's dome narrows. A fraction
  // of cap length alone protrudes through the dome on short, wide capsules.
  const bodyEnd = Math.min(d.xRim + d.capLen * .72, d.L/2-d.rc-Math.max(.06,d.wall*.5));
  const bodyDomeC = bodyTip + d.rb;
  for (let j = 0; j <= 22; j++) { const a = -Math.PI / 2 + j * Math.PI / 2 / 22; body.push([bodyDomeC + d.rb * Math.sin(a), Math.max(1e-4, d.rb * Math.cos(a))]); }
  const bodyLen = bodyEnd - bodyDomeC;
  for (let j = 1; j <= 14; j++) body.push([bodyDomeC + bodyLen * j / 14 * (j < 14 ? 1 : .985), d.rb * (j === 14 ? .96 : 1)]);
  body.push([bodyEnd, d.rb * .5]); body.push([bodyEnd, 1e-4]);
  // Cap: rolled lip at the rim, a faint snap ring, cylinder, dome at +X.
  const cap = [];
  const lipR = d.wall / 2;
  cap.push([d.xRim + lipR * 2.5, d.rb * .999]);
  for (let j = 0; j <= 8; j++) { const a = -Math.PI / 2 - j * Math.PI / 8; cap.push([d.xRim + lipR + lipR * Math.cos(a), d.rb + lipR + lipR * Math.sin(a)]); }
  const capDomeC = d.L / 2 - d.rc;
  const cylLen = capDomeC - (d.xRim + lipR);
  const ringAt = .09, ringW = .045, ringDepth = .018;
  for (let j = 1; j <= 24; j++) {
    const t = j / 24, x = d.xRim + lipR + cylLen * t;
    const g = Math.exp(-Math.pow((t - ringAt) / ringW, 2));
    cap.push([x, d.rc - ringDepth * g]);
  }
  for (let j = 1; j <= 22; j++) { const a = j * Math.PI / 2 / 22; cap.push([capDomeC + d.rc * Math.sin(a), Math.max(1e-4, d.rc * Math.cos(a))]); }
  // Tiny manufacturing irregularity (microns), different on each half.
  const wb = (amp, f1, f2, p) => (x, a) => amp * Math.sin(a * f1 + x * .52 + p) * Math.sin(a * f2 - x * .95);
  const bodyMesh = revolve(body, n, ov, wb(.004, 9, 5, ph));
  const capMesh = revolve(cap, n, ov, wb(.005, 7, 4, ph2));
  return { body: bodyMesh, cap: capMesh, dims: d };
}
