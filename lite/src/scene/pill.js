// One medication instance: geometry + materials for tablets, two-piece capsules
// (cap and body share ONE instance) and softgels. Supports vertex-for-vertex
// morphs between same-topology specs and section-plane clipping for topology
// changes. Local frame matches the Blender generator (x length, y width, z
// thickness); the group rotates it to three.js Y-up.
import * as THREE from 'three';
import {classFor, INSTANCE} from '../labels/schema.js';
import { buildTablet, tabletDims } from '../geo/tablet.js';
import { buildSoftgel, buildCapsule, softgelDims, capsuleDims } from '../geo/shells.js';
import { buildRelief, buildCapsuleInk } from '../geo/relief.js';
import { displaceFaceRelief } from '../geo/physical-relief.js';
import { surfaceParameters } from '../render/surface-priors.js';
import { cleanSolid, applyDamage } from '../geo/damage.js';
import { makeTabletMaterial, updateTabletUniforms, makeCapsuleMaterial, makeSoftgelMaterial, updateSoftgelMaterial } from '../render/materials.js';
import { validate } from './catalog.js';
import { easeInOut } from '../util/rng.js';

export const LOD = {
  hero: { tabletN: 320, relief: 1024, shellN: 192, capsuleN: 176 },
  tray: { tabletN: 160, relief: 320, shellN: 112, capsuleN: 96 },
};

const HATCH_VS = /* glsl */`
#include <common>
#include <clipping_planes_pars_vertex>
void main() {
  #include <begin_vertex>
  #include <project_vertex>
  #include <clipping_planes_vertex>
}`;
const HATCH_FS = /* glsl */`
#include <common>
#include <clipping_planes_pars_fragment>
uniform vec3 uColor; uniform vec3 uInk;
void main() {
  #include <clipping_planes_fragment>
  float h = step(0.72, fract((gl_FragCoord.x + gl_FragCoord.y) / 7.0));
  gl_FragColor = vec4(mix(uColor, uInk, h * 0.85), 1.0);
}`;

function geometryFrom(built) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(built.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(built.normals, 3));
  g.setIndex(new THREE.BufferAttribute(built.index, 1));
  g.computeBoundingSphere();
  return g;
}

export class Pill {
  constructor(spec, { lod = 'hero', instance = INSTANCE.pillStart, semantic = classFor(spec) } = {}) {
    this.lodName = lod;
    this.lod = LOD[lod];
    this.group = new THREE.Group();
    this.frame = new THREE.Group();
    this.frame.rotation.x = -Math.PI / 2; // local z (thickness) -> world +Y
    this.group.add(this.frame);
    this.label = { instance, semantic };
    this.meshes = [];
    this.materials = [];
    this.textures = [];
    this.fragments = [];
    this.morph = null;
    this.record = {};
    this.build(validate(structuredClone(spec)));
  }

  get kind() { return this.spec.kind; }

  // Height of the resting pose's centre above the support, and footprint (mm).
  get restHeight() { const d = this.dims; return this.kind === 'capsule' ? d.rc * (this.spec.ovality ?? .99) : d.H / 2; }
  get footprint() { const d = this.dims; return this.kind === 'capsule' ? [d.L, d.rc * 2] : [d.L, d.W]; }

  build(spec) {
    this.cancelMorph();
    this.disposeContent();
    this.spec = spec;
    this.label.semantic = classFor(spec);
    const lod = this.lod;
    if (spec.kind === 'tablet') {
      const built = buildTablet(spec, { n: lod.tabletN });
      this.dims = built.dims;
      this.relief = buildRelief(spec, built.dims, { size: lod.relief });
      this.textures.push(this.relief.texture);
      this.record.physicalRelief = displaceFaceRelief(built, this.relief, spec);
      this.record.surfaceParameters = surfaceParameters(spec);
      const shell = makeTabletMaterial(spec, this.relief);
      const core = makeTabletMaterial(spec, null, { core: true });
      updateTabletUniforms(shell, spec, built.dims, this.relief);
      updateTabletUniforms(core, spec, built.dims, null);
      this.materials.push(shell, core);
      let geometry;
      const dmg = spec.damage || {};
      if (dmg.chips > 0 || dmg.fracture) {
        const solid = cleanSolid(built.positions, built.normals, built.index);
        try {
          const res = applyDamage(solid, built.dims, dmg, shell, core, { fragments: this.lodName === 'tray' });
          geometry = res.geometry;
          this.record.damage = res.record;
          this.fragmentGeometries = res.fragments;
        } catch (e) {
          console.warn('CSG damage failed; keeping intact tablet', e);
          geometry = geometryFrom(built);
          this.record.damage = { failed: String(e) };
        }
        this.base = null;
      } else {
        geometry = geometryFrom(built);
        this.base = built;
        this.record.damage = null;
      }
      geometry.computeBoundingSphere();
      // Multi-material meshes only draw their groups: intact tablets are all shell.
      if (!geometry.groups.length) geometry.addGroup(0, geometry.index ? geometry.index.count : geometry.attributes.position.count, 0);
      this.addMesh(geometry, [shell, core]);
      this.record.relief = this.relief.info;
    } else if (spec.kind === 'capsule') {
      const built = buildCapsule(spec, { n: lod.capsuleN });
      this.dims = built.dims;
      const ink = buildCapsuleInk(spec, built.dims, { size: this.lodName === 'hero' ? 1024 : 384 });
      if (ink) this.textures.push(ink.texture);
      const capM = makeCapsuleMaterial(spec.capColor, { seed: spec.seed, scuffs: spec.scuffs ?? 1, radius: built.dims.rc, ink });
      const bodyM = makeCapsuleMaterial(spec.bodyColor, { seed: spec.seed + 17, scuffs: (spec.scuffs ?? 1) * .7, radius: built.dims.rb, ink });
      capM.userData.uniforms.uRoughBase.value = .21; bodyM.userData.uniforms.uRoughBase.value = .245;
      this.materials.push(capM, bodyM);
      this.addMesh(geometryFrom(built.cap), capM);
      this.addMesh(geometryFrom(built.body), bodyM);
      this.base = built;
    } else {
      const built = buildSoftgel(spec, { n: lod.shellN });
      this.dims = built.dims;
      const m = makeSoftgelMaterial(spec);
      updateSoftgelMaterial(m, spec, built.dims);
      this.materials.push(m);
      const mesh = this.addMesh(geometryFrom(built), m);
      // Raster shadow maps are binary; a clear gel's real shadow is coloured
      // and bright, so transmissive shells do not cast opaque shadows (AO keeps contact).
      mesh.castShadow = spec.transmission < .5;
      this.base = built;
      this.record.optics = m.userData.optics;
    }
  }

  addMesh(geometry, material) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.label = this.label;
    mesh.userData.pill = this;
    this.frame.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  setLabel(instance, semantic) {
    this.label.instance = instance; this.label.semantic = semantic;
  }

  // Fast in-place update while a slider is dragged: same topology -> rewrite
  // vertex arrays and uniforms; relief is rebuilt at reduced resolution only if
  // it depends on what changed. `final` does the full-quality rebuild.
  live(spec, final = false) {
    spec = validate(structuredClone(spec));
    this.label.semantic = classFor(spec);
    const hasDmg = (s) => s.kind === 'tablet' && ((s.damage?.chips ?? 0) > 0 || s.damage?.fracture);
    const dNow = hasDmg(spec), dPrev = hasDmg(this.spec);
    // CSG damage is only re-evaluated on release; while dragging, update shading.
    if (!final && spec.kind === this.spec.kind && (dNow || dPrev) && dNow === dPrev) { this.spec = spec; this.updateUniformsOnly(spec); return; }
    if (final || spec.kind !== this.spec.kind || !this.base || dNow || dPrev || this.morph) { this.build(spec); return; }
    let target;
    if (spec.kind === 'tablet') target = buildTablet(spec, { n: this.lod.tabletN });
    else if (spec.kind === 'softgel') target = buildSoftgel(spec, { n: this.lod.shellN });
    else target = buildCapsule(spec, { n: this.lod.capsuleN });
    const prev = this.spec;
    if (spec.kind === 'tablet') {
      const reliefKey = (s) => JSON.stringify([s.imprint, s.imprintBack, s.length, s.width, s.outline, s.sides, s.seed, s.pores, s.pressDefects, s.breakoutDensity, s.breakoutSize, s.breakoutFaces, s.texture, s.finish, s.wear]);
      if (reliefKey(prev) !== reliefKey(spec)) {
        // Keep one resolution during drag and release: no last-frame relief jump.
        const r = buildRelief(spec, target.dims, { size: this.lod.relief });
        const old = this.relief.texture;
        this.textures = this.textures.filter(t => t !== old); old.dispose();
        this.textures.push(r.texture); this.relief = r;
      }
      this.record.physicalRelief = displaceFaceRelief(target, this.relief, spec);
      this.record.surfaceParameters = surfaceParameters(spec);
    }
    const pairs = spec.kind === 'capsule' ? [[target.cap, this.meshes[0], 'cap'], [target.body, this.meshes[1], 'body']] : [[target, this.meshes[0], null]];
    for (const [t, m, key] of pairs) {
      const pos = m.geometry.attributes.position, nor = m.geometry.attributes.normal;
      if (pos.array.length !== t.positions.length) { this.build(spec); return; }
      pos.array.set(t.positions); nor.array.set(t.normals);
      pos.needsUpdate = true; nor.needsUpdate = true;
      m.geometry.computeBoundingSphere();
      t.positions = pos.array; t.normals = nor.array;
    }
    this.base = target;
    this.dims = target.dims;
    this.spec = spec;
    if (spec.kind === 'tablet') {
      updateTabletUniforms(this.materials[0], spec, target.dims, this.relief);
      updateTabletUniforms(this.materials[1], spec, target.dims, null);
    } else this.updateUniformsOnly(spec);
  }

  updateUniformsOnly(spec) {
    if (spec.kind === 'tablet') {
      updateTabletUniforms(this.materials[0], spec, this.dims, this.relief);
      if (this.materials[1]) updateTabletUniforms(this.materials[1], spec, this.dims, null);
    } else if (spec.kind === 'softgel') updateSoftgelMaterial(this.materials[0], spec, this.dims);
    else {
      this.materials[0].userData.uniforms.uBase.value.setRGB(...spec.capColor, THREE.LinearSRGBColorSpace);
      this.materials[1].userData.uniforms.uBase.value.setRGB(...spec.bodyColor, THREE.LinearSRGBColorSpace);
      this.materials[0].userData.uniforms.uShell.value.x = spec.scuffs ?? 1;
      this.materials[1].userData.uniforms.uShell.value.x = (spec.scuffs ?? 1) * .7;
    }
  }

  // Try a vertex-for-vertex morph; returns false if topology differs.
  morphTo(spec, duration = .7) {
    spec = validate(structuredClone(spec));
    if (spec.kind !== this.spec.kind || !this.base) return false;
    const dmg = spec.damage || {};
    if (spec.kind === 'tablet' && (dmg.chips > 0 || dmg.fracture)) return false;
    // Prepare the exact destination once. Completion only adopts these resources;
    // it must not rebuild relief/materials after the last interpolated frame.
    const prepared = new Pill(spec, { lod: this.lodName, ...this.label });
    const target = prepared.base;
    const from = this.base, to = target;
    const pairs = spec.kind === 'capsule' ? [[from.cap, to.cap, this.meshes[0]], [from.body, to.body, this.meshes[1]]] : [[from, to, this.meshes[0]]];
    if (pairs.some(([a, b]) => a.positions.length !== b.positions.length)) { prepared.dispose(); return false; }
    this.cancelMorph();
    const snapshot = (m) => ({
      uniforms: Object.fromEntries(Object.entries(m.userData.uniforms).map(([key, u]) => [key, u.value?.isTexture ? u.value : u.value?.clone ? u.value.clone() : u.value])),
      properties: Object.fromEntries(['roughness', 'specularIntensity', 'sheen', 'clearcoat', 'clearcoatRoughness', 'transmission', 'attenuationDistance'].map(key => [key, m[key]])),
      attenuationColor: m.attenuationColor.clone(),
    });
    this.morph = { t: 0, duration, pairs: pairs.map(([a, b, m]) => ({ a, b, m, p0: a.positions.slice(), n0: a.normals.slice() })),
      from: this.spec, to: spec, target, prepared,
      materialsFrom: this.materials.map(snapshot), materialsTo: prepared.materials.map(snapshot),
      startPosition: this.group.position.clone(), endPosition: null };
    return true;
  }

  // Returns true while animating.
  update(dt) {
    const M = this.morph;
    if (!M) return false;
    M.t = Math.min(1, M.t + dt / M.duration);
    const k = easeInOut(M.t);
    for (const p of M.pairs) {
      const pos = p.m.geometry.attributes.position, nor = p.m.geometry.attributes.normal;
      const P = pos.array, N = nor.array, B = p.b.positions, BN = p.b.normals;
      for (let i = 0; i < P.length; i++) { P[i] = p.p0[i] + (B[i] - p.p0[i]) * k; N[i] = p.n0[i] + (BN[i] - p.n0[i]) * k; }
      pos.needsUpdate = true; nor.needsUpdate = true;
      p.m.geometry.computeBoundingSphere();
    }
    this.blendMaterials(M.from, M.to, k, M);
    if (M.endPosition) this.group.position.lerpVectors(M.startPosition, M.endPosition, k);
    if (M.t >= 1) {
      this.morph = null;
      // The last blended state already equals this destination. Keep the pose
      // and instance identity, move prepared resources without generating again.
      this.disposeContent();
      for (const key of ['spec', 'dims', 'base', 'relief', 'record', 'materials', 'textures', 'meshes', 'fragmentGeometries']) this[key] = M.prepared[key];
      for (const mesh of this.meshes) { this.frame.add(mesh); mesh.userData.pill = this; mesh.userData.label = this.label; }
      return false;
    }
    return true;
  }

  // Keep the current rendered geometry/material state when a new preset
  // interrupts a morph. Any destination textures now referenced stay owned.
  cancelMorph() {
    if (!this.morph) return;
    const dest = this.morph.prepared;
    this.textures.push(...dest.textures); dest.textures = [];
    dest.dispose(); this.morph = null;
  }

  blendMaterials(a, b, k, M) {
    const fade = Math.abs(1 - 2 * k), second = k >= .5;
    for (let j = 0; j < this.materials.length; j++) {
      const m = this.materials[j], A = M.materialsFrom[j], B = M.materialsTo[j], u = m.userData.uniforms;
      for (const [key, av] of Object.entries(A.uniforms)) {
        const bv = B.uniforms[key];
        if (av?.isTexture) { u[key].value = second ? bv : av; continue; }
        if (typeof av === 'number') u[key].value = av + (bv - av) * k;
        else if (av?.isColor) u[key].value.copy(av).lerp(bv, k);
        else if (av?.isVector3 || av?.isVector4) u[key].value.lerpVectors(av, bv, k);
      }
      const variants = ['transmission', 'sheen', 'clearcoat'];
      const active = variants.map(key => m[key] > 0);
      for (const [key, av] of Object.entries(A.properties)) m[key] = av === B.properties[key] ? av : av + (B.properties[key] - av) * k;
      m.attenuationColor.copy(A.attenuationColor).lerp(B.attenuationColor, k);
      // Discrete artwork/layout changes happen only while their strength is zero.
      const pick = second ? B.uniforms : A.uniforms;
      if (a.kind === 'tablet') {
        u.uReliefRect.value.copy(pick.uReliefRect);
        u.uReliefInfo.value.copy(pick.uReliefInfo); u.uReliefInfo.value.z *= fade;
        u.uScore.value.copy(pick.uScore); u.uScore.value.z *= fade;
        u.uScore2.value.copy(pick.uScore2);
      } else if (a.kind === 'capsule') {
        u.uInkRect.value.copy(pick.uInkRect);
        u.uShell.value.w = pick.uShell.w * fade;
      }
      // Switching transmission shader variants is necessary at zero crossings.
      if (variants.some((key, i) => active[i] !== (m[key] > 0))) m.needsUpdate = true;
    }
  }

  setClipping(planes, hatch = false, hatchColor = [.8, .78, .74]) {
    for (const m of this.materials) { m.clippingPlanes = planes; m.clipShadows = true; m.needsUpdate = true; }
    if (this.hatchMeshes) { for (const h of this.hatchMeshes) { h.parent.remove(h); h.material.dispose(); } this.hatchMeshes = null; }
    if (planes && hatch) {
      this.hatchMeshes = this.meshes.map((m) => {
        const mat = new THREE.ShaderMaterial({ vertexShader: HATCH_VS, fragmentShader: HATCH_FS, side: THREE.BackSide, clipping: true, clippingPlanes: planes,
          uniforms: { uColor: { value: new THREE.Color().setRGB(...hatchColor, THREE.LinearSRGBColorSpace) }, uInk: { value: new THREE.Color().setRGB(.08, .075, .07, THREE.LinearSRGBColorSpace) } } });
        const h = new THREE.Mesh(m.geometry, mat);
        h.userData.noLabel = true;
        m.parent.add(h);
        return h;
      });
    }
  }

  // Dimension and imprint facts for annotation/metadata. Defaults to the
  // current state; pass `target` during a morph to describe where it ends.
  describe(d = this.dims, s = this.spec) {
    if (s.kind === 'capsule') return { L: d.L, W: d.rc * 2, H: d.rc * 2 * (s.ovality ?? .99) };
    return { L: d.L, W: d.W, H: d.H };
  }
  // Spec/dims the pill is morphing towards (or its current ones).
  get target() { return this.morph ? { spec: this.morph.to, dims: this.morph.target.dims } : { spec: this.spec, dims: this.dims }; }
  restHeightOf(d = this.dims, s = this.spec) { return s.kind === 'capsule' ? d.rc * (s.ovality ?? .99) : d.H / 2; }

  disposeContent() {
    for (const g of this.fragmentGeometries ?? []) g.dispose();
    this.fragmentGeometries = [];
    for (const m of this.meshes) { m.parent?.remove(m); m.geometry.dispose(); }
    if (this.hatchMeshes) { for (const h of this.hatchMeshes) { h.parent?.remove(h); h.material.dispose(); } this.hatchMeshes = null; }
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.meshes = []; this.materials = []; this.textures = [];
  }

  dispose() { this.cancelMorph(); this.disposeContent(); this.group.parent?.remove(this.group); }
}
