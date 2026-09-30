// Image-based lighting built from emissive "softbox" scenes (no photographic
// HDRIs are bundled), plus a shadow-casting key aligned with the main emitter.
// Rigs follow blender/lighting_v46.py: chamber diffuse/strips/slit, window
// daylight, indoor. World units: mm, Y up.
import * as THREE from 'three';
import { captureLighting } from './lighting-priors.js';

export const LIGHTING = {
  studio: { label: 'Studio', exposure: 1.0 },
  chamber_strips: { label: 'Chamber strips', exposure: 1.05 },
  chamber_slit: { label: 'Chamber slit', exposure: 1.05 },
  chamber_diffuse: { label: 'Chamber diffuse', exposure: 1.0 },
  chamber_glare: { label: 'Chamber glare', exposure: 1.05 },
  window: { label: 'Window daylight', exposure: 1.0 },
  overcast: { label: 'Overcast sky', exposure: 1.0 },
  sunlight: { label: 'Direct sunlight', exposure: 1.0 },
  indoor: { label: 'Indoor diffuse', exposure: 1.05 },
  mixed_light: { label: 'Mixed light', exposure: 1.05 },
};

const fromSource = ([x,y,z]) => new THREE.Vector3(x,z,-y);
const reflectionModes=new WeakMap();
function setAreaReflectionMode(scene,value) {
  scene.traverse(o=>{
    for(const material of (Array.isArray(o.material)?o.material:[o.material])) {
      if(!material?.isMeshStandardMaterial)continue;
      let uniform=reflectionModes.get(material);
      if(uniform){uniform.value=value;continue;}
      if(value===1)continue;
      uniform={value};reflectionModes.set(material,uniform);
      const previous=material.onBeforeCompile,previousKey=material.customProgramCacheKey.bind(material);
      material.onBeforeCompile=function(shader,renderer) {
        previous.call(this,shader,renderer);
        shader.uniforms.paAreaShadowSpecular=uniform;
        const chunk=THREE.ShaderChunk.lights_physical_pars_fragment
          .replace('reflectedLight.directSpecular += irradiance *','reflectedLight.directSpecular += paAreaShadowSpecular * irradiance *')
          .replace('clearcoatSpecularDirect += ccIrradiance *','clearcoatSpecularDirect += paAreaShadowSpecular * ccIrradiance *')
          .replace('sheenSpecularDirect += irradiance *','sheenSpecularDirect += paAreaShadowSpecular * irradiance *');
        shader.fragmentShader='uniform float paAreaShadowSpecular;\n'+shader.fragmentShader.replace('#include <lights_physical_pars_fragment>',chunk);
      };
      material.customProgramCacheKey=()=>previousKey()+'|capture-area-reflections-v1';
      material.needsUpdate=true;
    }
  });
}
// Environment maps reproduce the source emitters' angular size, colour and
// radiance at the tray centre. Near-field transport and wall interreflection
// remain raster approximations, explicitly recorded in the lighting metadata.
function captureEnvironment(record, center) {
  const scene=new THREE.Scene();
  scene.background=new THREE.Color().setRGB(...[record.background_strength,record.background_strength,record.background_strength]);
  for(const light of record.sources) {
    if(light.type!=='area')continue;
    const pos=fromSource(light.position_m).multiplyScalar(1000).sub(center).multiplyScalar(.01);
    const target=fromSource(light.target_m).multiplyScalar(1000).sub(center).multiplyScalar(.01);
    const [w,h]=light.size_m;
    panel(scene,w*10,h*10,pos.toArray(),target.toArray(),light.color,light.power_w/(Math.PI*w*h)*.5);
  }
  return scene;
}

function panel(scene, w, h, pos, look, color, intensity) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(...color).multiplyScalar(intensity), side: THREE.DoubleSide }));
  m.position.set(...pos);
  m.lookAt(...look);
  scene.add(m);
  return m;
}

// Environment room is unit-scaled (metres-ish); only directions matter for PMREM.
function envScene(kind, side = 1) {
  const s = new THREE.Scene();
  const room = (c) => {
    const g = new THREE.SphereGeometry(10, 48, 24);
    const cols = [];
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 10;
      // Ceiling slightly brighter than floor; warm stone bounce from below.
      const t = THREE.MathUtils.smoothstep(y, -1, 1);
      const col = new THREE.Color(...c.floor).lerp(new THREE.Color(...c.ceil), t);
      cols.push(col.r, col.g, col.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    s.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  };
  const O = [0, 0, 0];
  if (kind === 'studio') {
    room({ floor: [.10, .088, .075], ceil: [.06, .06, .065] });
    panel(s, 5.5, 3.6, [-3.2, 5.2, 3.4], O, [1, .96, .9], 5.5);      // large key softbox
    panel(s, 1.0, 6.5, [5.2, 2.2, -2.4], O, [.9, .95, 1], 3.2);       // cool strip rim
    panel(s, 7, 2.2, [0, 7.5, -3.5], O, [1, 1, 1], 1.1);              // top fill
    panel(s, 6, 3, [1.5, 1.2, 7.5], O, [1, .97, .93], .7);            // front bounce card
  } else if (kind === 'chamber_strips' || kind === 'chamber_slit') {
    room({ floor: [.05, .05, .05], ceil: [.035, .036, .04] });
    panel(s, .45, 7, [-6, 2.6, 0], O, [.96, .98, 1], 9);
    panel(s, .45, 7, [6, 2.4, .3], O, [1, .95, .88], 8);
    panel(s, 4, 4, [0, 9, 0], O, [1, 1, 1], .35);
    if (kind === 'chamber_slit') panel(s, 6, .35, [0, 1.2, -8], O, [.77, .88, 1], 12);
  } else if (kind === 'chamber_diffuse') {
    room({ floor: [.07, .07, .07], ceil: [.10, .10, .105] });
    panel(s, 3.5, 7, [-6, 4.5, 0], O, [.96, .98, 1], 3.2);
    panel(s, 3.5, 7, [6, 3.7, .6], O, [1, .96, .89], 2.9);
    panel(s, 6, 2.5, [0, 4.5, 7], O, [.95, .98, 1], 1.4);
  } else if (kind === 'window') {
    room({ floor: [.16, .14, .12], ceil: [.22, .23, .25] });
    panel(s, 6, 8, [side * 7, 6, 4], O, [.91, .96, 1], 5.5);
    panel(s, 6, 4, [-side * 6, 3.5, -3], O, [1, .96, .9], .6);
  } else {
    room({ floor: [.12, .10, .085], ceil: [.2, .18, .16] });
    panel(s, 3, 5, [side * 3, 9, 1.8], O, [1, .9, .78], 4.2);
    panel(s, 6, 5, [-4, 4, -5], O, [.85, .92, 1], .9);
  }
  return s;
}

// The key light is an area emitter sampled by K shadow-casting directional
// lights placed at the centres of K strata of the emitter. Every frame —
// interactive or refined — therefore has the same soft penumbra and the same
// mean light position; progressive refinement only jitters each light inside
// its own stratum (deterministic Halton sequence), so shadows converge without
// pumping between hard and soft or wandering.
function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }

export class LightRig {
  constructor(renderer, { keys = 4, shadowSize = 2048 } = {}) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.cache = new Map();
    this.group = new THREE.Group();
    this.target = new THREE.Object3D();
    this.group.add(this.target);
    this.keys = [];
    for (let i = 0; i < keys; i++) {
      const k = new THREE.DirectionalLight(0xffffff, 1);
      k.castShadow = true;
      k.shadow.bias = -0.00015;
      k.shadow.normalBias = 0.02;
      k.shadow.radius = 3;
      k.shadow.mapSize.set(shadowSize, shadowSize);
      k.target = this.target;
      this.group.add(k);
      this.keys.push(k);
    }
    this.key = this.keys[0];
    this.base = new THREE.Vector3();
    this.right = new THREE.Vector3(1, 0, 0);
    this.up = new THREE.Vector3(0, 1, 0);
    this.areaHalf = [1, 1];
    this.grid = [2, 2];
    this.kind = null;
    this.signature = '';
  }

  env(kind, side = 1, record = null, center = new THREE.Vector3()) {
    const k = record ? JSON.stringify([record,center.toArray()]) : kind + ':' + side;
    if (!this.cache.has(k)) {
      const sc = record ? captureEnvironment(record,center) : envScene(kind, side);
      const rt = this.pmrem.fromScene(sc, .015);
      sc.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      this.cache.set(k, rt);
      // Seeded rigs must not retain one GPU environment per generated scene.
      while(this.cache.size>6) {const old=this.cache.keys().next().value;this.cache.get(old).dispose();this.cache.delete(old);}
    } else {
      const rt=this.cache.get(k);this.cache.delete(k);this.cache.set(k,rt);
    }
    return this.cache.get(k).texture;
  }

  // Configure for a subject of radius `extent` (mm) centred at `center`.
  apply(scene, kind, { center = new THREE.Vector3(), extent = 10, side = 1, shadowSize = 2048, seed = 0, widthMM = extent/.62, depthMM = widthMM*.36 } = {}) {
    this.kind = kind;
    const record=kind==='studio'?null:captureLighting(kind,{seed,widthMM,depthMM});
    // Area emitters already reflect through the PMREM. Their finite shadow
    // strata must not also appear as four/fewer point-like specular sources.
    setAreaReflectionMode(scene,record && kind!=='sunlight'?0:1);
    scene.environment = this.env(kind, side,record,center);
    scene.environmentIntensity = kind === 'studio' ? .62 : 1;
    const dist = extent * 8;
    const dirs = {
      studio: [[-.58, .66, .28], 3.6, [.62, .34]],
      chamber_strips: [[-.88, .42, .05], 1.3, [.05, .5]],
      chamber_slit: [[-.1, .35, -.93], 1.6, [.5, .03]],
      chamber_diffuse: [[-.6, .7, .1], 1.1, [.35, .6]],
      window: [[side * .62, .62, .45], 2.9, [.35, .45]],
      indoor: [[side * .3, .92, .2], 1.9, [.25, .35]],
      chamber_glare: [[-.65, .75, 0], 1.3, [.05,.5]],
      overcast: [[0, 1, 0], 1.0, [1,1]],
      sunlight: [[.4,.8,.4], 2.5, [.02,.02]],
      mixed_light: [[side*.3,.92,.2],1.9,[.25,.35]],
    };
    let [d, intensity, [sw, sh]] = dirs[kind] || dirs.studio;
    const dir = new THREE.Vector3(...d).normalize();
    let warm = { studio: [1, .96, .9], window: [.95, .97, 1], indoor: [1, .9, .8], chamber_strips: [.97, .98, 1], chamber_slit: [.85, .92, 1], chamber_diffuse: [1, .98, .95] }[kind] || [1, 1, 1];
    let primary=null,angularHalf=null;
    if(record) {
      primary=record.sources.find(l=>l.type==='sun') ?? (kind==='overcast'||kind==='chamber_slit'?record.sources.at(-1):record.sources[0]);
      warm=primary.color;
      if(primary.type==='sun') {
        const v=new THREE.Vector3(0,0,1).applyEuler(new THREE.Euler(...primary.rotation_rad,'XYZ'));
        dir.copy(fromSource(v.toArray()));intensity*=primary.strength/.625;
        angularHalf=[Math.tan(primary.angle_rad/2),Math.tan(primary.angle_rad/2)];
      } else {
        const offset=fromSource(primary.position_m).multiplyScalar(1000).sub(center);
        dir.copy(offset).normalize();const distance=offset.length()/1000;
        angularHalf=primary.size_m.map(v=>v/(2*distance));
        const nominal={chamber_diffuse:.31,chamber_strips:.185,chamber_glare:.185,chamber_slit:.24,window:3.25,overcast:1,indoor:2.2,mixed_light:2.2}[kind]??primary.power_w;
        intensity*=primary.power_w/nominal;
      }
      [sw,sh]=angularHalf;
      record.browser_rendering={method:'procedural area-emitter PMREM plus stratified directional shadow approximation',environment_radiance_scale:.5,primary_shadow_source:primary.name,primary_shadow_intensity:intensity,area_shadow_specular:false,sun_specular:primary.type==='sun',additional_sources:'environment illumination/reflections; no separate source shadows',chamber_geometry:'source dimensions recorded; no physical chamber wall bounce',transport:'no path tracing or caustics; not radiometrically equivalent to Cycles'};
    }
    this.record=record;
    this.base.copy(center).addScaledVector(dir, dist);
    this.target.position.copy(center);
    this.right.set(0, 1, 0).cross(dir).normalize();
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    this.up.copy(dir).cross(this.right).normalize();
    // Emitter half-size (world units at the light distance): constant angular size.
    this.areaHalf = angularHalf ? angularHalf.map(v=>v*dist) : [sw * dist * .35, sh * dist * .35];
    const K = this.keys.length, ratio = sw / sh;
    this.grid = K === 1 ? [1, 1] : K === 2 ? (ratio >= 1 ? [2, 1] : [1, 2]) : ratio > 2.2 ? [K, 1] : ratio < 1 / 2.2 ? [1, K] : [2, Math.ceil(K / 2)];
    const half = extent * 1.6;
    // Blur each stratum light over ~half the penumbra step to its neighbour
    // (for a ~3 mm occluder) so the K contributions blend without banding.
    const texelMM = 2 * half / shadowSize;
    const stepRad = 2 * Math.max(this.areaHalf[0] / this.grid[0], this.areaHalf[1] / this.grid[1]) / dist;
    const radius = K === 1 ? 3 : Math.min(28, Math.max(3, .5 * stepRad * 3 / texelMM));
    for (const k of this.keys) {
      k.shadow.radius = radius;
      k.intensity = intensity / K;
      k.color.setRGB(...warm);
      const cam = k.shadow.camera;
      cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
      cam.near = dist * .2; cam.far = dist * 2.2;
      cam.updateProjectionMatrix();
      if (k.shadow.mapSize.x !== shadowSize) {
        k.shadow.mapSize.set(shadowSize, shadowSize);
        if (k.shadow.map) { k.shadow.map.dispose(); k.shadow.map = null; }
      }
    }
    this.jitter(null);
    this.shadowRadius = radius;
    this.signature = [kind, side, seed, extent.toFixed(3), center.toArray().map((v) => v.toFixed(3)).join(','), shadowSize].join('|');
    return { position: this.base.clone(), areaHalf: this.areaHalf };
  }

  // n = null: stratum centres (interactive frame). n >= 1: deterministic
  // jitter inside each light's own stratum.
  jitter(n) {
    const [cols, rows] = this.grid;
    this.keys.forEach((k, i) => {
      const c = i % cols, r = Math.floor(i / cols) % rows;
      let ju = .5, jv = .5;
      if (n) { ju = (halton(n, 2) + i * .618034) % 1; jv = (halton(n, 3) + i * .381966) % 1; }
      const u = ((c + ju) / cols) * 2 - 1, v = ((r + jv) / rows) * 2 - 1;
      k.position.copy(this.base).addScaledVector(this.right, u * this.areaHalf[0]).addScaledVector(this.up, v * this.areaHalf[1]);
    });
  }
}
