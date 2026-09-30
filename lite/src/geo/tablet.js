// Pressed (compression) tablets, ported from blender/tablet_geometry.py.
// Profile: side band -> rounded bevel -> optional flat shoulder land -> crown
// meeting the land at a distinct (optionally blended) junction. All ranges in mm.
// Topology is fixed by (n, ring counts) so every tablet outline/profile can be
// morphed vertex-for-vertex.
import { outlinePoints, outlineNormals, minCurvatureRadius } from './outline.js';
import { clamp } from '../util/rng.js';

export const CROWN_RINGS = 40, LAND_RINGS = 4, BEVEL_RINGS = 8, BAND_RINGS = 6;

// Resolve derived dimensions and clamp everything to a valid, non-self-
// intersecting profile. Returns the effective values (recorded in metadata).
export function tabletDims(spec, outline) {
  const L = spec.length, W = spec.width, H = spec.thickness;
  const minDim = Math.min(L, W);
  const rcurv = outline ? minCurvatureRadius(outline) : minDim / 2;
  const bevel = clamp(spec.edgeRadius ?? Math.min(.22, H * .09), .04, Math.min(H * .22, rcurv * .8));
  const crown = clamp(spec.crownHeight, 0, H * .38);
  // Land must fit within the outline's tightest curve (inward offset stays simple).
  const rimMax = spec.outline === 'heart' ? 0 : Math.max(0, Math.min(minDim * .28, rcurv * .92 - bevel));
  const rim = clamp(spec.rimWidth ?? 0, 0, rimMax);
  const shoulder = H / 2 - crown - bevel;
  const blend = clamp(spec.crownBlend ?? .06, 0, .6);
  const curve = clamp(spec.crownCurve ?? 1.6, 1, 4);
  return { L, W, H, bevel, crown, rim, rimMax, shoulder, blend, curve, zLand: H / 2 - crown };
}

// Score groove profile shared verbatim with the GLSL (materials.js). t = |d|/halfwidth.
const SE = .12, SNORM = Math.sqrt(1 + SE * SE) - SE;
export function grooveProfile(t) {
  if (t >= 1) return 0;
  return 1 - (Math.sqrt(t * t + SE * SE) - SE) / SNORM;
}

// Groove depth fraction (0..1) at local (x, y) for a score spec.
export function scoreField(x, y, spec) {
  const s = spec.score;
  if (!s || !s.count) return 0;
  const hw = s.width / 2;
  const reachX = s.reach * spec.length / 2 * 1.08, reachY = s.reach * spec.width / 2 * 1.08;
  const taper = Math.max(.25, spec.width * .08);
  const endY = (yy) => s.reach >= .999 ? 1 : clamp((reachY - Math.abs(yy)) / taper, 0, 1);
  const endX = (xx) => s.reach >= .999 ? 1 : clamp((reachX - Math.abs(xx)) / taper, 0, 1);
  let g = 0;
  if (s.layout === 'parallel') {
    const off = spec.length / 6;
    g = Math.max(grooveProfile(Math.abs(x - off) / hw), grooveProfile(Math.abs(x + off) / hw)) * endY(y);
  } else {
    g = grooveProfile(Math.abs(x) / hw) * endY(y);
    if (s.layout === 'cross') g = Math.max(g, grooveProfile(Math.abs(y) / hw) * endX(x));
  }
  return g;
}

export function buildTablet(spec, { n = 256 } = {}) {
  if (spec.outline === 'ring') return buildRing(spec, n);
  const P = outlinePoints(spec, n);
  const N = outlineNormals(P);
  const d = tabletDims(spec, P);
  const { bevel, crown, rim, shoulder, blend, curve, zLand } = d;
  const power = curve + 1;
  const minHalf = Math.min(d.L, d.W) / 2;
  const blendU = rim > 0 ? Math.min(blend / minHalf, .25) : 0;

  // Radial profile samples: [kind, param]; kind 'c' crown scale u, 'o' offset from outline.
  const top = [];
  for (let j = 1; j <= CROWN_RINGS; j++) {
    // Concentrate rings toward the crown edge where curvature and the junction live.
    const t = j / CROWN_RINGS;
    top.push(['c', 1 - Math.pow(1 - t, 1.6)]);
  }
  for (let i = 1; i <= LAND_RINGS; i++) top.push(['o', bevel + rim * (1 - i / LAND_RINGS), zLand]);
  for (let i = 1; i <= BEVEL_RINGS; i++) {
    const phi = Math.PI / 2 * (1 - i / BEVEL_RINGS);
    top.push(['o', bevel * (1 - Math.cos(phi)), shoulder + bevel * Math.sin(phi)]);
  }
  const crownZ = (u) => {
    if (rim > 0) {
      let cap = Math.max(0, 1 - Math.pow(u, power));
      if (blendU > 0 && u > 1 - blendU) {
        // Hermite blend into the land: zero slope at the land, matched slope on the crown.
        const u0 = 1 - blendU, y0 = 1 - Math.pow(u0, power), dy0 = -power * Math.pow(u0, power - 1);
        const t = (u - u0) / blendU;
        cap = (2 * t ** 3 - 3 * t * t + 1) * y0 + (t ** 3 - 2 * t * t + t) * blendU * dy0;
      }
      return zLand + crown * cap;
    }
    return d.H / 2 - crown * u * u;
  };

  const rings = [];
  for (const r of top) rings.push({ ...toRing(r), sign: 1 });
  for (let i = 1; i < BAND_RINGS; i++) rings.push({ kind: 'o', off: 0, z: shoulder * (1 - 2 * i / BAND_RINGS), sign: 0 });
  for (let r = top.length - 1; r >= 0; r--) { const q = toRing(top[r]); rings.push({ ...q, z: -q.z, sign: -1 }); }
  function toRing(r) {
    if (r[0] === 'c') return { kind: 'c', u: r[1], z: crownZ(r[1]) };
    return { kind: 'o', off: r[1], z: r[2] };
  }

  const R = rings.length;
  const vcount = R * n + 2;
  const base = new Float32Array(vcount * 3);
  const pos = new Float32Array(vcount * 3);
  const inner = rim + bevel;
  for (let r = 0; r < R; r++) {
    const ring = rings[r];
    for (let k = 0; k < n; k++) {
      const [px, py] = P[k], [nx, ny] = N[k];
      let x, y;
      if (ring.kind === 'c') { x = (px - nx * inner) * ring.u; y = (py - ny * inner) * ring.u; }
      else { x = px - nx * ring.off; y = py - ny * ring.off; }
      const o = (r * n + k) * 3;
      base[o] = x; base[o + 1] = y; base[o + 2] = ring.z;
    }
  }
  const tp = R * n, bp = R * n + 1;
  base[tp * 3 + 2] = crownZ(0); base[bp * 3 + 2] = -crownZ(0);

  // Displace positions by the analytic score (silhouette notch at the rim);
  // normals stay those of the undisplaced surface, and the shader adds the
  // crisp analytic groove normal on top.
  pos.set(base);
  const faces = spec.score?.faces || 'top';
  const depth = spec.score?.count ? Math.min(spec.score.depth, d.H * .12) : 0;
  if (depth > 0) {
    for (let v = 0; v < vcount; v++) {
      const o = v * 3, z = base[o + 2];
      if (Math.abs(z) <= shoulder) continue;
      if (z < 0 && faces !== 'both') continue;
      const w = Math.min(1, (Math.abs(z) - shoulder) / bevel);
      const g = scoreField(base[o], base[o + 1], spec);
      pos[o + 2] -= Math.sign(z) * depth * g * w;
    }
  }

  const tris = [];
  for (let k = 0; k < n; k++) tris.push(tp, k, (k + 1) % n);
  for (let r = 0; r < R - 1; r++) {
    for (let k = 0; k < n; k++) {
      const a = r * n + k, b = r * n + (k + 1) % n, c = (r + 1) * n + (k + 1) % n, e = (r + 1) * n + k;
      tris.push(a, e, c, a, c, b);
    }
  }
  const last = (R - 1) * n;
  for (let k = 0; k < n; k++) tris.push(last + k, bp, last + (k + 1) % n);
  const index = new Uint32Array(tris);
  const normals = vertexNormals(base, index, vcount);
  return { positions: pos, normals, index, dims: d, rings: R, n, vcount, referencePositions: base };
}

// Blender's ring_tablet is a flattened torus, not a disk with a painted hole.
// Periodic indices close both seams without coincident duplicate vertices.
function buildRing(spec, n) {
  const d = tabletDims(spec), m = 48, major = d.L * .34, minor = d.L * .16;
  const positions = new Float32Array(n * m * 3), normals = new Float32Array(n * m * 3);
  const index = new Uint32Array(n * m * 6), zscale = d.H / (2 * minor);
  let t = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const u = i / n * Math.PI * 2, v = j / m * Math.PI * 2;
    const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
    const a = i * m + j, b = ((i + 1) % n) * m + j;
    const c = ((i + 1) % n) * m + (j + 1) % m, e = i * m + (j + 1) % m;
    positions.set([(major + minor * cv) * cu, (major + minor * cv) * su, minor * sv * zscale], a * 3);
    const nx = cv * cu, ny = cv * su, nz = sv / zscale, len = Math.hypot(nx, ny, nz);
    normals.set([nx / len, ny / len, nz / len], a * 3);
    index.set([a, b, c, a, c, e], t); t += 6;
  }
  return {positions, normals, index, dims: {...d, W: d.L, major, minor, innerDiameter: 2 * (major - minor)}, n, rings: m, vcount: n * m};
}

export function vertexNormals(pos, index, vcount) {
  const nrm = new Float32Array(vcount * 3);
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { nrm[o] += nx; nrm[o + 1] += ny; nrm[o + 2] += nz; }
  }
  for (let v = 0; v < vcount; v++) {
    const o = v * 3, l = Math.hypot(nrm[o], nrm[o + 1], nrm[o + 2]) || 1;
    nrm[o] /= l; nrm[o + 1] /= l; nrm[o + 2] /= l;
  }
  return nrm;
}

export function signedVolume(pos, index) {
  let v = 0;
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
    v += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
      - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
      + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  return v / 6;
}
