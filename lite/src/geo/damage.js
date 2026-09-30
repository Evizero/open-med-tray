// Real geometric damage (Boolean CSG, three-bvh-csg): angular edge chips and a
// warped, tilted fracture. Newly exposed faces use the compact core material.
// Mirrors blender/tablet_geometry.py chip_tablet / fracture_tablet.
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, makeNoise2 } from '../util/rng.js';
import { signedVolume } from './tablet.js';

const evaluator = new Evaluator();
evaluator.attributes = ['position', 'normal'];
evaluator.useGroups = true;

// Weld duplicate rings/poles and drop degenerate triangles so the solid is 2-manifold.
export function cleanSolid(positions, normals, index) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.deleteAttribute('normal');
  const merged = mergeVertices(g, 1e-6);
  const idx = merged.index.array, keep = [];
  const P = merged.attributes.position.array;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    if (a === b || b === c || a === c) continue;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (area < 1e-12) continue;
    keep.push(a, b, c);
  }
  merged.setIndex(keep);
  merged.computeVertexNormals();
  return merged;
}

function faceted(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.computeVertexNormals();
  return g;
}

function chipBrush(dims, rng, amount) {
  const rx = dims.L / 2, ry = dims.W / 2, h = dims.H;
  const angle = rng.uniform(0, Math.PI * 2);
  const radius = Math.min(rx, ry) * amount * 1.5;
  const base = mergeVertices(new THREE.IcosahedronGeometry(1, 1).deleteAttribute('normal').deleteAttribute('uv'), 1e-6);
  const p = base.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const f = rng.uniform(.8, 1.2);
    p.setXYZ(i, p.getX(i) * radius * f, p.getY(i) * radius * f, p.getZ(i) * radius * .75 * f);
  }
  const g = faceted(base);
  const brush = new Brush(g);
  // Centre just inside the outline, above mid-thickness: bites through the top bevel.
  const topSide = rng.chance(.7) ? 1 : -1;
  brush.position.set(rx * .97 * Math.cos(angle), ry * .97 * Math.sin(angle), topSide * h * rng.uniform(.22, .38));
  brush.rotation.set(rng.uniform(0, 6.28), rng.uniform(0, 6.28), rng.uniform(0, 6.28));
  brush.updateMatrixWorld();
  return { brush, angle, radius };
}

function fractureBrush(dims, rng, { offset, tilt, waviness, lip }) {
  const L = dims.L, W = dims.W, H = dims.H;
  const off = offset ?? rng.uniform(-L * .075, L * .075);
  const phase = rng.uniform(0, 6), cy = rng.uniform(-W * .23, W * .23), cz = rng.uniform(-H * .1, H * .1);
  const slope = Math.tan(tilt * Math.PI / 180);
  const noise = makeNoise2(rng.int(1, 1e6));
  const ny = 72, nz = 28, spanY = W * .72, spanZ = H * .85;
  const back = Math.min(-L, off - Math.abs(slope) * spanZ - waviness - lip - L);
  const verts = [];
  for (const isBack of [false, true]) {
    for (let iz = 0; iz <= nz; iz++) {
      const z = (iz / nz * 2 - 1) * spanZ;
      for (let iy = 0; iy <= ny; iy++) {
        const y = (iy / ny * 2 - 1) * spanY;
        const wave = waviness * (.64 * Math.sin(y / Math.max(W, .001) * 12 + phase) + .36 * Math.sin(z / Math.max(H, .001) * 8 + y / Math.max(W, .001) * 9 + phase));
        const jag = .085 * noise(y * 6.5 + phase, z * 6.5) + .03 * noise(y * 22, z * 22 + 5);
        const tongue = lip * Math.exp(-(((y - cy) / (W * .14)) ** 2) - (((z - cz) / (H * .35)) ** 2));
        verts.push(isBack ? back : off + slope * z + wave + jag - tongue, y, z);
      }
    }
  }
  const count = (ny + 1) * (nz + 1), idx = [];
  for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) {
    const a = iz * (ny + 1) + iy;
    idx.push(a, a + 1, a + ny + 2, a, a + ny + 2, a + ny + 1);
    idx.push(a + count, a + ny + 1 + count, a + ny + 2 + count, a + count, a + ny + 2 + count, a + 1 + count);
  }
  const boundary = [];
  for (let iy = 0; iy <= ny; iy++) boundary.push(iy);
  for (let iz = 1; iz <= nz; iz++) boundary.push(iz * (ny + 1) + ny);
  for (let iy = ny - 1; iy >= 0; iy--) boundary.push(nz * (ny + 1) + iy);
  for (let iz = nz - 1; iz > 0; iz--) boundary.push(iz * (ny + 1));
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i], b = boundary[(i + 1) % boundary.length];
    idx.push(a, b + count, b, a, a + count, b + count);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  // Orientation: make the closed cutter's signed volume positive.
  const pos = g.attributes.position.array, ind = g.index.array;
  if (signedVolume(pos, ind) < 0) { for (let i = 0; i < ind.length; i += 3) { const t = ind[i + 1]; ind[i + 1] = ind[i + 2]; ind[i + 2] = t; } }
  const brush = new Brush(faceted(g));
  brush.updateMatrixWorld();
  return { brush, offset: off };
}

function volumeOf(geometry) {
  const g = geometry.index ? geometry : geometry;
  const pos = g.attributes.position.array;
  const index = g.index ? g.index.array : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
  return signedVolume(pos, index);
}

// Returns { geometry (with groups 0 shell / 1 core), fragments: [geometry], record }.
export function applyDamage(solid, dims, damage, shellMat, coreMat, { fragments: wantFragments = true } = {}) {
  const rng = new RNG(damage.seed ?? 42);
  const record = { chips: [], fracture: null };
  const before = volumeOf(solid);
  let current = new Brush(solid, [shellMat]);
  current.geometry.clearGroups();
  current.geometry.addGroup(0, current.geometry.index ? current.geometry.index.count : current.geometry.attributes.position.count, 0);
  current.material = [shellMat];
  current.updateMatrixWorld();
  const fragments = [];
  const t0 = performance.now();
  const chips = damage.chips ?? 0;
  for (let i = 0; i < chips; i++) {
    const { brush, angle, radius } = chipBrush(dims, rng, damage.chipSize ?? .16);
    brush.material = coreMat;
    if (wantFragments) {
      const piece = evaluator.evaluate(current, brush, INTERSECTION);
      if (piece.geometry.attributes.position.count > 12) fragments.push(piece.geometry.clone());
    }
    current = evaluator.evaluate(current, brush, SUBTRACTION);
    current.updateMatrixWorld();
    record.chips.push({ angle_deg: +(angle * 180 / Math.PI).toFixed(1), radius_mm: +radius.toFixed(3) });
  }
  if (damage.fracture) {
    const { brush, offset } = fractureBrush(dims, rng, { offset: damage.fractureOffset, tilt: damage.tilt ?? 18, waviness: damage.waviness ?? .34, lip: damage.lip ?? .5 });
    brush.material = coreMat;
    current = evaluator.evaluate(current, brush, SUBTRACTION);
    record.fracture = { tilt_deg: damage.tilt ?? 18, offset_mm: +offset.toFixed(3), waviness_mm: damage.waviness ?? .34, tongue_mm: damage.lip ?? .5 };
  }
  const geometry = current.geometry;
  const mats = Array.isArray(current.material) ? current.material : [current.material];
  // Normalise groups to material indices 0 = shell, 1 = core.
  for (const gr of geometry.groups) gr.materialIndex = mats[gr.materialIndex] === coreMat ? 1 : 0;
  record.remaining_fraction = +(volumeOf(geometry) / before).toFixed(4);
  record.csg_ms = Math.round(performance.now() - t0);
  return { geometry, fragments, record };
}
