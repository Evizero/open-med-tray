// Progressive raster pipeline. Interaction draws one crisp MSAA frame; at rest
// the frame "develops": sub-pixel jitter (AA), jittered area-light shadows and
// thin-lens depth of field accumulate, then rendering stops until something
// changes. The same output shader is used for the screen and for exports.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

const ACCUM_FS = /* glsl */`
uniform sampler2D tNew; uniform sampler2D tOld; uniform float uWeight;
varying vec2 vUv;
void main() {
  vec4 b = texture2D(tNew, vUv);
  // Never let a NaN/Inf sample poison the running average.
  if (any(isnan(b)) || any(isinf(b))) b = vec4(0.0, 0.0, 0.0, 1.0);
  b = min(b, vec4(64.0));
  if (uWeight >= 1.0) { gl_FragColor = b; return; }
  vec4 a = texture2D(tOld, vUv);
  gl_FragColor = mix(a, b, uWeight);
}
`;
const VS = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Khronos PBR Neutral: preserves base colours and keeps white tablets legible.
const OUTPUT_FS = /* glsl */`
uniform sampler2D tColor; uniform sampler2D tFade; uniform float uFade; uniform float uExposure; uniform float uVignette; uniform vec2 uRes; uniform float uGrain; uniform vec2 uAspectFix;
varying vec2 vUv;
vec3 neutral(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  const float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  if (uFade < 1.0) c = mix(texture2D(tFade, vUv).rgb, c, uFade);
  c *= uExposure;
  vec2 q = (vUv - 0.5) * uAspectFix;
  float v = 1.0 - uVignette * smoothstep(0.25, 0.95, dot(q, q) * 1.6);
  c *= v;
  c = srgb(clamp(neutral(c), 0.0, 1.0));
  c += (hash(gl_FragCoord.xy) - 0.5) * uGrain / 255.0;
  gl_FragColor = vec4(c, 1.0);
}
`;

export class Pipeline {
  constructor(canvas, { mobile = false } = {}) {
    this.canvas = canvas;
    this.mobile = mobile;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false, stencil: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.localClippingEnabled = true;
    this.maxDpr = mobile ? 1.5 : 1.75;
    this.maxSamples = mobile ? 20 : 40;
    this.samples = 0;
    this.exposure = 1;
    this.vignette = .42;
    this.aoEnabled = true;
    this.dof = { enabled: false, aperture: 0, focus: 100 };
    this.jitterLights = [];
    this.baseShift = [0, 0];
    this.settleMs = mobile ? 260 : 200;
    this.lastReset = 0;
    this.scene = null; this.camera = null;
    const rtOpts = { type: THREE.HalfFloatType, depthBuffer: true, samples: 4 };
    this.sceneRT = new THREE.WebGLRenderTarget(4, 4, rtOpts);
    this.aoRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    this.accum = [0, 1].map(() => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false }));
    this.accumIndex = 0;
    this.accumMat = new THREE.ShaderMaterial({ uniforms: { tNew: { value: null }, tOld: { value: null }, uWeight: { value: 1 } }, vertexShader: VS, fragmentShader: ACCUM_FS, depthTest: false, depthWrite: false });
    this.outputMat = new THREE.ShaderMaterial({ uniforms: { tColor: { value: null }, tFade: { value: null }, uFade: { value: 1 }, uExposure: { value: 1 }, uVignette: { value: .3 }, uRes: { value: new THREE.Vector2() }, uGrain: { value: 1.2 }, uAspectFix: { value: new THREE.Vector2(1, 1) } }, vertexShader: VS, fragmentShader: OUTPUT_FS, depthTest: false, depthWrite: false, toneMapped: false });
    this.quad = new FullScreenQuad(this.accumMat);
    this.gtao = null;
    this.width = 4; this.height = 4;
    this._jitterSeq = halton2D(256);
    this.onFrame = null;
  }

  setScene(scene, camera) {
    this.scene = scene; this.camera = camera;
    if (this.gtao) { this.gtao.dispose(); this.gtao = null; }
    this.gtao = new GTAOPass(scene, camera, this.width, this.height);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.setAO(this._aoParams || { radius: 2, intensity: .8 });
    this.reset();
  }

  setAO({ radius, intensity, distanceExponent = 1.4, thickness = 1.2 }) {
    this._aoParams = { radius, intensity, distanceExponent, thickness };
    if (!this.gtao) return;
    this.gtao.blendIntensity = intensity;
    this.gtao.updateGtaoMaterial({ radius, distanceExponent, thickness, scale: 1, samples: this.mobile ? 8 : 12, distanceFallOff: 1, screenSpaceRadius: false });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 12 });
  }

  resize(cssW, cssH) {
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    // Cap total pixels: large retina displays keep a sensible GPU budget.
    const cap = this.mobile ? 1.6e6 : 3.2e6;
    let s = dpr;
    if (cssW * cssH * s * s > cap) s = Math.sqrt(cap / (cssW * cssH));
    const w = Math.max(2, Math.round(cssW * s)), h = Math.max(2, Math.round(cssH * s));
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = cssW + 'px'; this.canvas.style.height = cssH + 'px';
    this.width = w; this.height = h;
    this.sceneRT.setSize(w, h);
    this.aoRT.setSize(w, h);
    for (const a of this.accum) a.setSize(w, h);
    if (this.gtao) this.gtao.setSize(w, h);
    this.reset();
  }

  // Any change restarts from the deterministic interactive frame; refinement
  // (jittered samples) only begins after a quiet interval, so slow input never
  // mixes a handful of noisy samples into what is on screen.
  reset() { this.samples = 0; this.lastReset = performance.now(); }
  get quietFor() { return performance.now() - (this.lastReset || 0); }
  get canRefine() { return this.samples > 0 && this.quietFor >= this.settleMs; }

  // Content offset (fraction of width/height) so the subject centres in the
  // area not covered by the inspector. Exports never use it.
  applyBaseShift(cam, shift = true, width = this.width, height = this.height) {
    const capture=cam.userData.captureShift??[0,0], x=capture[0]+(shift?this.baseShift[0]:0), y=capture[1]+(shift?this.baseShift[1]:0);
    if (x || y) cam.setViewOffset(width, height, x * width, y * height, width, height);
    else cam.clearViewOffset();
  }
  get converged() { return this.samples >= this.maxSamples; }

  // One progressive sample into the accumulation buffer.
  renderSample({ target = null, width = this.width, height = this.height, sceneRT = this.sceneRT, aoRT = this.aoRT, accum = this.accum, index = null, shift = true } = {}) {
    const r = this.renderer, cam = this.camera, scene = this.scene;
    if (!scene || !cam) return;
    const n = index ?? this.samples;
    const still = n > 0;
    const [jx, jy] = still ? this._jitterSeq[n % this._jitterSeq.length] : [.5, .5];
    // Thin-lens DOF: shift the eye within the aperture and shear the frustum so
    // the focus plane stays fixed.
    const saved = cam.position.clone();
    let ox = 0, oy = 0;
    if (still && this.dof.enabled && this.dof.aperture > 0) {
      const [u, v] = this._jitterSeq[(n * 7 + 3) % this._jitterSeq.length];
      // Ramp the aperture in over the first samples: focus falls off smoothly
      // instead of jumping from sharp to a few ghosted lens positions.
      const ramp = this.dofRamp === false ? 1 : Math.min(1, n / 14);
      const rad = Math.sqrt(u) * this.dof.aperture * ramp, th = v * Math.PI * 2;
      ox = rad * Math.cos(th); oy = rad * Math.sin(th);
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      cam.position.addScaledVector(right, ox).addScaledVector(up, oy);
      cam.updateMatrixWorld();
    }
    const fh = 2 * this.dof.focus * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const pxPerMM = height / fh;
    const sx = (jx - .5) - ox * pxPerMM, sy = (jy - .5) + oy * pxPerMM;
    const capture=cam.userData.captureShift??[0,0];
    const bx=(capture[0]+(shift?this.baseShift[0]:0))*width, by=(capture[1]+(shift?this.baseShift[1]:0))*height;
    cam.setViewOffset(width, height, sx + bx, sy + by, width, height);
    // Area-light shadows: jitter shadow-casting lights over their emitter.
    for (const L of this.jitterLights) L.jitter(still ? n : null);
    r.setRenderTarget(sceneRT);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(scene, cam);
    let src = sceneRT;
    if (this.aoEnabled && this.gtao && this._aoParams.intensity > 0) {
      this.gtao.camera = cam;
      this.gtao.render(r, aoRT, sceneRT);
      src = aoRT;
    }
    this.applyBaseShift(cam, shift, width, height);
    for (const L of this.jitterLights) L.jitter(null);
    cam.position.copy(saved);
    cam.updateMatrixWorld();
    const read = accum[this.accumIndex], write = accum[1 - this.accumIndex];
    this.accumMat.uniforms.tNew.value = src.texture;
    this.accumMat.uniforms.tOld.value = read.texture;
    this.accumMat.uniforms.uWeight.value = 1 / (n + 1);
    this.quad.material = this.accumMat;
    r.setRenderTarget(write);
    this.quad.render(r);
    this.accumIndex = 1 - this.accumIndex;
    this._output(target, width, height, accum[this.accumIndex]);
    if (index === null) this.samples++;
  }

  _output(target, width, height, src) {
    const r = this.renderer;
    this.outputMat.uniforms.tColor.value = src.texture;
    let f = 1;
    if (target === null && this.fade < 1 && this.fadeRT) {
      const t = Math.min(1, (performance.now() - this.fadeStart) / 1000 / this.fadeDuration);
      this.fade = t;
      f = t * t * (3 - 2 * t);
      this.outputMat.uniforms.tFade.value = this.fadeRT.texture;
    }
    this.outputMat.uniforms.uFade.value = f;
    this.outputMat.uniforms.uExposure.value = this.exposure;
    this.outputMat.uniforms.uVignette.value = this.vignette;
    this.outputMat.uniforms.uRes.value.set(width, height);
    const a = width / height;
    this.outputMat.uniforms.uAspectFix.value.set(a > 1 ? 1 : a, a > 1 ? 1 / a : 1);
    this.quad.material = this.outputMat;
    r.setRenderTarget(target);
    this.quad.render(r);
  }

  // Offscreen still at an exact size (dataset/export). Returns RGBA8 pixels, top row first.
  renderStill(width, height, samples, { vignette = 0, grain = 0 } = {}) {
    const r = this.renderer;
    const sceneRT = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 });
    const aoRT = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: false });
    const accum = [0, 1].map(() => new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: false }));
    const out = new THREE.WebGLRenderTarget(width, height, { type: THREE.UnsignedByteType, depthBuffer: false });
    const prev = { v: this.vignette, g: this.outputMat.uniforms.uGrain.value, ai: this.accumIndex, dof: this.dof.enabled };
    this.vignette = vignette; this.outputMat.uniforms.uGrain.value = grain; this.dof.enabled = false;
    if (this.gtao) this.gtao.setSize(width, height);
    this.accumIndex = 0;
    for (let i = 0; i < samples; i++) this.renderSample({ target: out, width, height, sceneRT, aoRT, accum, index: i, shift: false });
    const px = new Uint8Array(width * height * 4);
    r.readRenderTargetPixels(out, 0, 0, width, height, px);
    const flipped = flipRows(px, width, height, 4);
    for (const t of [sceneRT, aoRT, ...accum, out]) t.dispose();
    this.vignette = prev.v; this.outputMat.uniforms.uGrain.value = prev.g; this.accumIndex = prev.ai; this.dof.enabled = prev.dof;
    if (this.gtao) this.gtao.setSize(this.width, this.height);
    this.reset();
    return flipped;
  }

  dispose() {
    for (const t of [this.sceneRT, this.aoRT, ...this.accum]) t.dispose();
    if (this.gtao) this.gtao.dispose();
    this.renderer.dispose();
  }
}

export function flipRows(px, w, h, c) {
  const out = new Uint8Array(px.length), stride = w * c;
  for (let y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * stride, (h - y) * stride), y * stride);
  return out;
}

function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }
function halton2D(n) { const out = []; for (let i = 1; i <= n; i++) out.push([halton(i, 2), halton(i, 3)]); return out; }
