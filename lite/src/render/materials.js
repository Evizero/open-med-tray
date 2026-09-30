// Physically based pill materials: MeshPhysicalMaterial with small, validated
// shader patches. All procedural fields are evaluated in object space (mm), so
// the same pill looks identical in every scene and at every camera distance,
// with footprint-aware filtering instead of sparkling aliasing.
import * as THREE from 'three';

import { SURFACE_PRIORS, surfaceParameters } from './surface-priors.js';

// Blender Specular IOR Level has neutral gain .5; Three specularIntensity has
// neutral gain 1. Diffuse roughness/SSS lack direct equivalents in this raster
// shader; the existing sheen is an explicitly approximate powder response.
export const FINISHES = Object.fromEntries(['chalky', 'matte_film', 'satin_film'].map(name => [name, {
  ...SURFACE_PRIORS[name], specular: 2 * SURFACE_PRIORS[name].specularIOR,
  sheen: {chalky: .35, matte_film: .12, satin_film: 0}[name],
}]));

const NOISE = /* glsl */`
uvec3 pa_pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
float pa_h(vec3 p) { uvec3 q = uvec3(ivec3(p) + ivec3(65536)); return float(pa_pcg3d(q).x) * (2.0 / 4294967295.0) - 1.0; }
// Value noise with analytic derivatives (quintic). Returns (value, d/dx, d/dy, d/dz).
vec4 pa_noised(vec3 x) {
  vec3 i = floor(x), w = fract(x);
  vec3 u = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);
  vec3 du = 30.0 * w * w * (w * (w - 2.0) + 1.0);
  float a = pa_h(i), b = pa_h(i + vec3(1, 0, 0)), c = pa_h(i + vec3(0, 1, 0)), d = pa_h(i + vec3(1, 1, 0));
  float e = pa_h(i + vec3(0, 0, 1)), f = pa_h(i + vec3(1, 0, 1)), g = pa_h(i + vec3(0, 1, 1)), h = pa_h(i + vec3(1, 1, 1));
  float k0 = a, k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d, k5 = a - c - e + g, k6 = a - b - e + f, k7 = -a + b + c - d + e - f - g + h;
  float v = k0 + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z;
  vec3 dv = du * vec3(k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z, k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x, k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y);
  return vec4(v, dv);
}
float pa_noise(vec3 x) { return pa_noised(x).x; }
// Two-octave field with gradient (in object mm), and a filter weight per octave.
vec4 pa_fbmd(vec3 p, float wl, float fw, out float lost) {
  vec4 acc = vec4(0.0); float amp = 1.0, freq = 1.0 / wl, norm = 0.0; lost = 0.0;
  for (int o = 0; o < 3; o++) {
    float feature = 1.0 / freq;
    float keep = 1.0 - smoothstep(0.22, 0.65, fw / feature);
    vec4 n = pa_noised(p * freq + float(o) * 17.13);
    acc += amp * keep * vec4(n.x, n.yzw * freq);
    lost += amp * (1.0 - keep);
    norm += amp; amp *= 0.42; freq *= 2.07;
  }
  lost /= norm;
  return acc / norm;
}
`;

const VERTEX_PARS = /* glsl */`
varying vec3 vLocal;
varying vec3 vLocalN;
varying vec3 vAxX; varying vec3 vAxY; varying vec3 vAxZ;
`;
const VERTEX_MAIN = /* glsl */`
vLocal = position;
vLocalN = normal;
vAxX = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));
vAxY = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));
vAxZ = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
`;

function patchVertex(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + VERTEX_PARS)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERTEX_MAIN);
}

const FRAG_COMMON = /* glsl */`
varying vec3 vLocal;
varying vec3 vLocalN;
varying vec3 vAxX; varying vec3 vAxY; varying vec3 vAxZ;
vec3 pa_toView(vec3 l) { return normalize(l.x * vAxX + l.y * vAxY + l.z * vAxZ); }
${NOISE}
`;

// ---------------------------------------------------------------- tablets
const TABLET_PARS = /* glsl */`
uniform vec3 uBase;
uniform vec4 uGrain;     // grain wavelength, grain relief, fine wavelength, fine relief (mm)
uniform vec4 uSurf;      // mottling, powder, speckles, seed
uniform vec4 uScore;     // layout (0 none 1 single 2 cross 3 parallel), half width, depth, faces (0 top 1 both)
uniform vec4 uScore2;    // reach, length, width, taper
uniform vec4 uProf;      // shoulder z, bevel, half thickness, core flag
uniform sampler2D uRelief;
uniform vec4 uReliefRect;  // min x, min y, size x, size y (mm)
uniform vec3 uReliefInfo;  // texel x, texel y, enabled
uniform float uRoughBase;
uniform float uLabelDim;
float pa_groove(float t) {
  if (t >= 1.0) return 0.0;
  const float e = 0.12; float nrm = sqrt(1.0 + e * e) - e;
  return 1.0 - (sqrt(t * t + e * e) - e) / nrm;
}
float pa_scoreH(vec2 p) {
  int lay = int(uScore.x + 0.5);
  if (lay == 0) return 0.0;
  float hw = uScore.y;
  float reach = uScore2.x;
  float ry = reach * uScore2.z * 0.5 * 1.08, rx = reach * uScore2.y * 0.5 * 1.08, tp = uScore2.w;
  float ey = reach >= 0.999 ? 1.0 : clamp((ry - abs(p.y)) / tp, 0.0, 1.0);
  float ex = reach >= 0.999 ? 1.0 : clamp((rx - abs(p.x)) / tp, 0.0, 1.0);
  float g;
  if (lay == 3) {
    float off = uScore2.y / 6.0;
    g = max(pa_groove(abs(p.x - off) / hw), pa_groove(abs(p.x + off) / hw)) * ey;
  } else {
    g = pa_groove(abs(p.x) / hw) * ey;
    if (lay == 2) g = max(g, pa_groove(abs(p.y) / hw) * ex);
  }
  return g;
}
float pa_relief(vec2 p, float top) {
  vec2 uv = (p - uReliefRect.xy) / uReliefRect.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
  vec4 t = texture2D(uRelief, uv);
  return top > 0.5 ? t.r : t.g;
}
`;

const TABLET_MAIN = /* glsl */`
{
  vec3 P = vLocal;
  vec3 nL = normalize(vLocalN);
  float fw = max(length(dFdx(P)), length(dFdy(P)));
  float seed = uSurf.w;
  vec3 Q = P + vec3(seed * 3.17, seed * 1.31, seed * 2.07);
  bool core = uProf.w > 0.5;
  float shoulder = uProf.x, bevel = uProf.y;
  // Face weight: 1 on crowned faces, fading to 0 across the bevel.
  float faceW = max(clamp((abs(P.z) - shoulder) / max(bevel, 1e-3), 0.0, 1.0) * step(0.25, abs(nL.z)), smoothstep(0.5, 0.9, abs(nL.z)));
  float top = P.z > 0.0 ? 1.0 : 0.0;

  // 1. Compacted granule relief + fine grain (object-space fbm with gradients).
  float lost1, lost2;
  vec4 g1 = pa_fbmd(Q, uGrain.x, fw, lost1);
  vec4 g2 = pa_fbmd(Q * 1.0 + 11.0, uGrain.z, fw, lost2);
  // Punch faces carry the granule relief; the die-wall band is burnished smoother
  // with faint axial striations.
  float faceGrain = mix(0.3, 1.0, faceW);
  vec3 grad = (g1.yzw * uGrain.y * 0.5 + g2.yzw * uGrain.w * 0.5) * faceGrain;
  if (!core && faceW < 1.0) {
    vec4 st = pa_noised(vec3(Q.x * 22.0, Q.y * 22.0, Q.z * 1.2));
    grad += vec3(st.y * 22.0, st.z * 22.0, st.w * 1.2) * 0.00045 * (1.0 - faceW) * (1.0 - smoothstep(0.3, 0.9, fw * 22.0));
  }
  float heightN = g1.x;

  // 2. Score grooves (analytic, crisp at any zoom).
  float groove = 0.0;
  vec2 hGrad = vec2(0.0);
  float scoreOn = (uScore.x > 0.5 && !core && (top > 0.5 || uScore.w > 0.5)) ? 1.0 : 0.0;
  if (scoreOn > 0.5 && faceW > 0.0) {
    float e = max(0.0025, uScore.y * 0.04);
    groove = pa_scoreH(P.xy);
    float gx = (pa_scoreH(P.xy + vec2(e, 0.0)) - pa_scoreH(P.xy - vec2(e, 0.0))) / (2.0 * e);
    float gy = (pa_scoreH(P.xy + vec2(0.0, e)) - pa_scoreH(P.xy - vec2(0.0, e))) / (2.0 * e);
    hGrad += -uScore.z * faceW * vec2(gx, gy);
    groove *= faceW;
  }
  // 3. Relief map: imprint die, sparse polygonal breakouts, pores (heights in mm, <= 0).
  float reliefH = 0.0;
  if (uReliefInfo.z > 0.0 && faceW > 0.0 && !core) {
    vec2 tx = uReliefInfo.xy * uReliefRect.zw;
    reliefH = pa_relief(P.xy, top);
    float rx = (pa_relief(P.xy + vec2(tx.x, 0.0), top) - pa_relief(P.xy - vec2(tx.x, 0.0), top)) / (2.0 * tx.x);
    float ry = (pa_relief(P.xy + vec2(0.0, tx.y), top) - pa_relief(P.xy - vec2(0.0, tx.y), top)) / (2.0 * tx.y);
    // Filter the relief when a texel is sub-pixel: keeps the tray view calm.
    float keep = 1.0 - smoothstep(0.6, 3.0, fw / max(tx.x, 1e-4) * 0.5);
    hGrad += faceW * uReliefInfo.z * vec2(rx, ry) * mix(0.35, 1.0, keep);
    reliefH *= faceW * uReliefInfo.z;
  }
  // Perturb: tangential gradients of heights measured along the normal.
  vec3 G = grad - dot(grad, nL) * nL;
  vec3 hG3 = vec3(hGrad, 0.0);
  hG3 -= dot(hG3, nL) * nL;
  vec3 nP = normalize(nL - G - hG3);
  normal = pa_toView(nP);

  // Colour: formulation mottling, powder patches, sparse flecks.
  float mott = pa_noise(Q / 0.38) * 0.5 + 0.5;
  vec3 col = uBase * mix(1.0 - uSurf.x, 1.0, mott);
  float powder = 0.0;
  if (uSurf.y > 0.0) {
    float pn = pa_noise(Q / 1.35 + 5.0) * 0.5 + 0.5;
    pn += 0.25 * pa_noise(Q / 0.45 + 9.0);
    powder = smoothstep(0.50, 0.72, pn) * uSurf.y;
    col = mix(col, min(uBase * 1.08 + 0.02, vec3(0.98)), powder);
  }
  if (uSurf.z > 0.0) {
    float sp = pa_noise(Q / 0.36 + 23.0) * 0.5 + 0.5;
    float fleck = smoothstep(0.80, 0.86, sp) * uSurf.z;
    col = mix(col, uBase * 0.52, fleck);
  }
  if (core) {
    // Exposed compact: lighter, whiter, coarser.
    col = mix(uBase, vec3(0.93, 0.92, 0.88), 0.45) * mix(0.93, 1.02, mott);
  }
  diffuseColor.rgb = col;
  // Roughness heterogeneity + filtered-away micro slope becomes roughness.
  float r = uRoughBase - 0.06 * (1.0 - faceW) * (core ? 0.0 : 1.0) + 0.075 * heightN + 0.08 * powder + 0.35 * (lost1 * uGrain.y + lost2 * uGrain.w) / max(uGrain.x, 1e-3);
  roughnessFactor = clamp(r, 0.08, 1.0);
  pa_specMul = mix(1.0, 0.35, powder);
  // Cavity occlusion for recesses (score, imprint, breakouts).
  float cav = smoothstep(0.02, 0.12, -reliefH);
  pa_occ = (1.0 - 0.38 * groove) * (1.0 - 0.45 * cav);
}
`;

// ---------------------------------------------------------------- capsules
const CAPSULE_PARS = /* glsl */`
uniform vec3 uBase;
uniform vec4 uShell;    // scuff strength, seed, radius, print enabled
uniform sampler2D uInk;
uniform vec4 uInkRect;  // x0, s0, xsize, ssize (mm)
uniform vec3 uInkColor;
uniform float uRoughBase;
`;
const CAPSULE_MAIN = /* glsl */`
{
  vec3 P = vLocal;
  vec3 nL = normalize(vLocalN);
  float fw = max(length(dFdx(P)), length(dFdy(P)));
  float seed = uShell.y;
  vec3 Q = P + seed * 1.7;
  // Drawn-shell scuffs: long thin striations along the axis inside handling patches.
  vec3 sq = vec3(Q.x * 0.85, Q.y * 45.0, Q.z * 45.0);
  float keep = 1.0 - smoothstep(0.3, 0.9, fw * 45.0 * 0.5);
  vec4 sc = pa_noised(sq);
  float scr = max(sc.x * 0.5 + 0.5 - 0.61, 0.0) * keep;
  float hpatch = smoothstep(0.43, 0.72, pa_noise(Q / 0.95) * 0.5 + 0.5);
  scr *= hpatch * uShell.x;
  vec3 gs = vec3(sc.y * 0.85, sc.z * 45.0, sc.w * 45.0) * scr * 0.0009;
  vec3 gn = pa_noised(Q / 0.23).yzw / 0.23 * 0.0009;
  vec3 G = gs + gn;
  G -= dot(G, nL) * nL;
  normal = pa_toView(normalize(nL - G));
  vec3 col = uBase * mix(0.985, 1.0, pa_noise(Q / 0.38) * 0.5 + 0.5);
  col = mix(col, vec3(0.8, 0.77, 0.68), scr * 0.6);
  float r = uRoughBase + 0.20 * hpatch * uShell.x * 0.35 + scr * 2.2;
  if (uShell.w > 0.0) {
    float ang = atan(P.z, P.y);
    vec2 uv = vec2((P.x - uInkRect.x) / uInkRect.z, (ang * uShell.z - uInkRect.y) / uInkRect.w);
    float ink = texture2D(uInk, uv).r * step(0.0, uv.x) * step(uv.x, 1.0);
    ink *= 1.0 - smoothstep(0.55, 0.95, abs(nL.x));
    col = mix(col, uInkColor, ink * 0.92 * uShell.w);
    r = mix(r, 0.5, ink * uShell.w);
  }
  diffuseColor.rgb = col;
  roughnessFactor = clamp(r, 0.06, 1.0);
}
`;

// ---------------------------------------------------------------- softgels
const SOFTGEL_PARS = /* glsl */`
uniform vec3 uBase;
uniform vec3 uSecond;
uniform vec4 uGel;     // two-tone flag, seam half width, seam relief, seed
uniform vec4 uGelDim;  // cap length, half width, half height, half straight
uniform float uRoughBase;
// Exit distance of a ray starting inside the softgel. In scaled space the shell
// is a unit-radius capsule around the X segment; t is in original mm.
float pa_softgelExit(vec3 p, vec3 d) {
  vec3 s = vec3(1.0 / uGelDim.x, 1.0 / uGelDim.y, 1.0 / uGelDim.z);
  vec3 ps = p * s, ds = d * s;
  float hs = uGelDim.w / uGelDim.x;
  float best = 0.0;
  // Cylinder (yz)
  float a = dot(ds.yz, ds.yz), b = dot(ps.yz, ds.yz), c = dot(ps.yz, ps.yz) - 1.0;
  float disc = b * b - a * c;
  if (a > 1e-8 && disc > 0.0) { float t = (-b + sqrt(disc)) / a; float x = ps.x + t * ds.x; if (abs(x) <= hs + 1e-4) best = max(best, t); }
  for (int i = 0; i < 2; i++) {
    vec3 cc = vec3(i == 0 ? -hs : hs, 0.0, 0.0);
    vec3 oc = ps - cc;
    float A = dot(ds, ds), B = dot(oc, ds), C = dot(oc, oc) - 1.0;
    float D = B * B - A * C;
    if (D > 0.0) { float t = (-B + sqrt(D)) / A; float x = ps.x + t * ds.x; if ((i == 0 && x <= -hs + 1e-4) || (i == 1 && x >= hs - 1e-4)) best = max(best, t); }
  }
  return best;
}
`;
const SOFTGEL_MAIN = /* glsl */`
{
  vec3 P = vLocal;
  vec3 nL = normalize(vLocalN);
  float seed = uGel.w;
  // Longitudinal rotary-die seam: a narrow raised ridge where local y ~ 0.
  float sw = uGel.y, rel = uGel.z;
  float ys = P.y / sw;
  float e = exp(-ys * ys);
  float dh = rel * e * (-2.0 * P.y / (sw * sw));
  vec3 G = vec3(0.0, dh, 0.0);
  G += pa_noised(P / 0.28 + seed).yzw / 0.28 * 0.00035;
  G -= dot(G, nL) * nL;
  normal = pa_toView(normalize(nL - G));
  vec3 col = uBase;
  col = mix(uBase, uSecond, smoothstep(-sw * 0.6, sw * 0.6, P.y) * uGel.x);
  diffuseColor.rgb = col;
  roughnessFactor = clamp(uRoughBase + 0.05 * e, 0.04, 1.0);
}
`;

function install(material, { pars, main, extraUniforms, transmissionPatch = null, occlusion = false }) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, extraUniforms);
    patchVertex(shader);
    let fs = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_COMMON + pars + '\nfloat pa_specMul = 1.0; float pa_occ = 1.0;\n')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + main)
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.specularColor *= pa_specMul; material.specularColorBlended *= pa_specMul;\n');
    if (occlusion) {
      fs = fs.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectDiffuse *= pa_occ; reflectedLight.indirectSpecular *= pa_occ; reflectedLight.directDiffuse *= mix(1.0, pa_occ, 0.6); reflectedLight.directSpecular *= pa_occ;\n');
    }
    if (transmissionPatch) {
      // The chunk is still an #include at this point: expand it, then patch.
      const chunk = THREE.ShaderChunk.transmission_fragment;
      if (!chunk.includes('material.thickness = thickness;')) console.warn('Open Med Tray Lite: transmission patch target missing');
      fs = fs.replace('#include <transmission_fragment>', chunk.replace('material.thickness = thickness;', transmissionPatch));
    }
    for (const tag of ['#include <normal_fragment_maps>', '#include <lights_physical_fragment>']) if (!shader.fragmentShader.includes(tag)) console.warn('Open Med Tray Lite: shader patch target missing', tag);
    shader.fragmentShader = fs;
    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => material.userData.programKey || material.type;
}

export function makeTabletMaterial(p, relief, { core = false } = {}) {
  const f = FINISHES[p.finish] || FINISHES.chalky, q = surfaceParameters(p);
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: q.roughness, metalness: 0, ior: 1.47,
    specularIntensity: f.specular, sheen: core ? .4 : f.sheen, sheenRoughness: .85, sheenColor: new THREE.Color(1, 1, 1),
  });
  const u = {
    uBase: { value: new THREE.Color().setRGB(...p.color, THREE.LinearSRGBColorSpace) },
    uGrain: { value: new THREE.Vector4(core ? .17 : q.grain, core ? .065 : q.relief, q.fine, q.fineRelief) },
    uSurf: { value: new THREE.Vector4(f.mottling * (p.mottling ?? 1), p.finish === 'chalky' ? (p.powder ?? .8) : 0, p.speckles ?? 0, (p.seed ?? 1) % 997) },
    uScore: { value: new THREE.Vector4() },
    uScore2: { value: new THREE.Vector4() },
    uProf: { value: new THREE.Vector4(0, .2, 1, core ? 1 : 0) },
    uRelief: { value: relief?.texture ?? blankRelief() },
    uReliefRect: { value: new THREE.Vector4(-1, -1, 2, 2) },
    uReliefInfo: { value: new THREE.Vector3(0, 0, 0) },
    uRoughBase: { value: core ? .92 : q.roughness },
    uLabelDim: { value: 0 },
  };
  m.userData.uniforms = u;
  m.userData.programKey = 'pa-tablet';
  m.userData.sheenBase = m.sheen;
  install(m, { pars: TABLET_PARS, main: TABLET_MAIN, extraUniforms: u, occlusion: true });
  return m;
}

export function updateTabletUniforms(m, spec, dims, relief) {
  const u = m.userData.uniforms;
  const f = FINISHES[spec.finish] || FINISHES.chalky, q = surfaceParameters(spec);
  const core = u.uProf.value.w > .5;
  u.uBase.value.setRGB(...spec.color, THREE.LinearSRGBColorSpace);
  if (!core) {
    u.uGrain.value.set(q.grain, q.relief, q.fine, q.fineRelief);
    u.uSurf.value.set(f.mottling * (spec.mottling ?? 1), spec.finish === 'chalky' ? (spec.powder ?? .8) : 0, spec.speckles ?? 0, (spec.seed ?? 1) % 997);
    u.uRoughBase.value = q.roughness;
    m.roughness = q.roughness;
    m.sheen = f.sheen; m.specularIntensity = f.specular;
  } else {
    u.uSurf.value.w = (spec.seed ?? 1) % 997;
  }
  const s = spec.score || {};
  const layout = !s.count ? 0 : s.layout === 'cross' ? 2 : s.layout === 'parallel' ? 3 : 1;
  u.uScore.value.set(layout, (s.width ?? .3) / 2, Math.min(s.depth ?? .14, dims.H * .12), s.faces === 'both' ? 1 : 0);
  u.uScore2.value.set(s.reach ?? 1, dims.L, dims.W, Math.max(.25, dims.W * .08));
  u.uProf.value.set(dims.shoulder, dims.bevel, dims.H / 2, core ? 1 : 0);
  if (relief) {
    u.uRelief.value = relief.texture;
    u.uReliefRect.value.set(relief.rect[0], relief.rect[1], relief.rect[2], relief.rect[3]);
    u.uReliefInfo.value.set(1 / relief.size, 1 / relief.size, 1);
  } else u.uReliefInfo.value.z = 0;
}

let _blank = null;
function blankRelief() {
  if (_blank) return _blank;
  _blank = new THREE.DataTexture(new Uint16Array(4 * 4 * 2), 4, 4, THREE.RGFormat, THREE.HalfFloatType);
  _blank.needsUpdate = true;
  return _blank;
}

export function makeCapsuleMaterial(color, { seed = 1, scuffs = 1, radius = 3.5, ink = null } = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: .22, ior: 1.5, specularIntensity: 1, clearcoat: .25, clearcoatRoughness: .12 });
  const u = {
    uBase: { value: new THREE.Color().setRGB(...color, THREE.LinearSRGBColorSpace) },
    uShell: { value: new THREE.Vector4(scuffs, seed % 991, radius, ink ? 1 : 0) },
    uInk: { value: ink?.texture ?? blankRelief() },
    uInkRect: { value: new THREE.Vector4(...(ink?.rect ?? [0, 0, 1, 1])) },
    uInkColor: { value: new THREE.Color().setRGB(.035, .035, .04, THREE.LinearSRGBColorSpace) },
    uRoughBase: { value: .22 },
  };
  m.userData.uniforms = u;
  m.userData.programKey = 'pa-capsule';
  install(m, { pars: CAPSULE_PARS, main: CAPSULE_MAIN, extraUniforms: u });
  return m;
}

// Nominal linear RGB transmittance at an 8 mm reference path, scaled by a
// density control relative to 150 (softgel_optics.py). Returns three.js
// attenuationColor/Distance with identical Beer-Lambert coefficients.
export function softgelOptics(color, density) {
  const scale = Math.max(0, density) / 150;
  const refPath = 8;
  const coeff = color.map((c) => -Math.log(Math.min(.995, Math.max(.002, c))) / refPath * scale); // per mm
  // three: coefficient = -ln(attenuationColor) / attenuationDistance. Choose distance = refPath.
  const att = coeff.map((k) => Math.exp(-k * refPath));
  return { attenuationColor: att, attenuationDistance: refPath, coefficientsPerMm: coeff };
}

export function makeSoftgelMaterial(sg) {
  const optics = softgelOptics(sg.color, sg.density);
  const t = sg.transmission;
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: sg.roughness, ior: 1.46, transmission: t, thickness: 1,
    attenuationColor: new THREE.Color().setRGB(...optics.attenuationColor, THREE.LinearSRGBColorSpace),
    attenuationDistance: optics.attenuationDistance, specularIntensity: 1, clearcoat: t > .5 ? 0 : .35, clearcoatRoughness: .08,
  });
  const u = {
    uBase: { value: new THREE.Color() },
    uSecond: { value: new THREE.Color() },
    uGel: { value: new THREE.Vector4() },
    uGelDim: { value: new THREE.Vector4(1, 1, 1, 0) },
    uRoughBase: { value: sg.roughness },
  };
  m.userData.uniforms = u;
  m.userData.programKey = 'pa-softgel';
  const patch = `material.thickness = max(0.05, pa_softgelExit(vLocal - normalize(vLocalN) * 0.002, normalize(transpose(mat3(modelMatrix)) * refract(-normalize(cameraPosition - vWorldPosition), normalize(transformNormalByInverseViewMatrix(normal, viewMatrix)), 1.0 / ior))));`;
  install(m, { pars: SOFTGEL_PARS, main: SOFTGEL_MAIN, extraUniforms: u, transmissionPatch: patch });
  updateSoftgelMaterial(m, sg);
  return m;
}

export function updateSoftgelMaterial(m, sg, dims) {
  const u = m.userData.uniforms;
  const t = sg.transmission;
  // Transparent shells: white base so colour comes only from volume absorption
  // (avoids diffuse leakage washing out brown/green, per softgel_optics.py).
  const base = t >= .99 ? [1, 1, 1] : sg.color;
  u.uBase.value.setRGB(...base, THREE.LinearSRGBColorSpace);
  u.uSecond.value.setRGB(...(sg.secondColor ?? sg.color), THREE.LinearSRGBColorSpace);
  u.uGel.value.set(sg.twoTone ? 1 : 0, sg.seamWidth ?? .09, sg.seamRelief ?? .012, (sg.seed ?? 1) % 977);
  u.uRoughBase.value = sg.roughness;
  if (dims) u.uGelDim.value.set(dims.cap, dims.W / 2, dims.H / 2, dims.straight / 2);
  const optics = softgelOptics(sg.color, sg.density);
  m.transmission = t;
  m.roughness = sg.roughness;
  m.clearcoat = t > .5 ? 0 : .35;
  m.attenuationColor.setRGB(...optics.attenuationColor, THREE.LinearSRGBColorSpace);
  m.attenuationDistance = optics.attenuationDistance;
  m.userData.optics = optics;
}
