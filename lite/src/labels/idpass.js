// Geometric label pass: pinhole, 1 sample per pixel, no tone mapping, blending,
// lighting, textures, environment or antialiasing. Encodes instance (16 bit)
// in R/G and semantic class in B. Transparent covers are excluded; opaque
// objects (tray, stickers, debris) occlude pills exactly as geometry does.
import * as THREE from 'three';
import {CLASS_COLORS,isPillId} from './schema.js';
import { flipRows } from '../render/pipeline.js';

const VS = /* glsl */`
#include <common>
#include <batching_pars_vertex>
#include <morphtarget_pars_vertex>
void main() {
  #include <begin_vertex>
  #include <project_vertex>
}`;
const FS = /* glsl */`
uniform vec3 uId;
void main() { gl_FragColor = vec4(uId / 255.0, 1.0); }`;

const cache = new Map();
function idMaterial(instance, semantic, side) {
  const key = `${instance}:${semantic}:${side}`;
  if (!cache.has(key)) {
    cache.set(key, new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, side, toneMapped: false, transparent: false, blending: THREE.NoBlending, dithering: false, fog: false,
      uniforms: { uId: { value: new THREE.Vector3(instance & 255, (instance >> 8) & 255, semantic) } },
    }));
  }
  return cache.get(key);
}

const depthMaterial = new THREE.ShaderMaterial({
  side:THREE.DoubleSide, toneMapped:false, blending:THREE.NoBlending,
  vertexShader:`varying vec3 vCamera; void main(){vec4 p=vec4(position,1.);
#ifdef USE_INSTANCING
 p=instanceMatrix*p;
#endif
 vec4 v=modelViewMatrix*p; vCamera=v.xyz; gl_Position=projectionMatrix*v;}`,
  fragmentShader:`varying vec3 vCamera; void main(){
    float d=clamp(floor(length(vCamera)*1000.+.5),1.,16777215.);
    gl_FragColor=vec4(mod(d,256.),mod(floor(d/256.),256.),floor(d/65536.),255.)/255.;}`,
});
// One exception-safe pass. Depth is camera-ray distance, quantized to 1 µm,
// matching Blender's metric Z pass meaning rather than normalized device depth.
export function renderRawTarget(renderer,scene,camera,width,height,{kind='labels',keepView=false}={}) {
  const printMaterials=new Map();
  const saved=[], env=scene.environment, bg=scene.background, override=scene.overrideMaterial;
  const oldView=camera.view?{...camera.view}:null, projection=camera.projectionMatrix.clone();
  const projectionInverse=camera.projectionMatrixInverse.clone();
  const prevTarget=renderer.getRenderTarget(),prevClear=renderer.getClearColor(new THREE.Color()),prevAlpha=renderer.getClearAlpha();
  const prevShadow=renderer.shadowMap.enabled,prevClipping=renderer.localClippingEnabled;
  const rt=new THREE.WebGLRenderTarget(width,height,{type:THREE.UnsignedByteType,samples:0,depthBuffer:true,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,generateMipmaps:false});
  rt.texture.colorSpace=THREE.NoColorSpace;
  const px=new Uint8Array(width*height*4);
  try {
    scene.traverse(o=>{
      if(!(o.isMesh||o.isLine||o.isPoints||o.isSprite))return;
      saved.push([o,o.material,o.visible]);
      if(!o.visible)return;
      const lab=o.userData.label,cover=o.userData.coverTarget;
      if(!o.isMesh || (!lab && !(kind==='cover'&&cover)) || (o.userData.noLabel && !(kind==='cover'&&cover))) {o.visible=false;return;}
      const side=Array.isArray(o.material)?o.material[0].side:o.material.side;
      const source=Array.isArray(o.material)?o.material[0]:o.material;
      const atlas=source.map?.userData.printTarget;
      if((kind==='print'||kind==='labels')&&atlas) {
        if(!printMaterials.has(atlas))printMaterials.set(atlas,new THREE.ShaderMaterial({
          side,toneMapped:false,blending:THREE.NoBlending,
          uniforms:{uInk:{value:atlas.texture},uPaper:{value:new THREE.Vector2((source.userData.paperInstance??(kind==='labels'?lab.instance:0))&255,(source.userData.paperInstance??(kind==='labels'?lab.instance:0))>>8)},uClass:{value:kind==='labels'?lab.semantic/255:0}},
          vertexShader:'varying vec2 vPrintUV; void main(){vPrintUV=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
          fragmentShader:'uniform sampler2D uInk; uniform vec2 uPaper; uniform float uClass; varying vec2 vPrintUV; void main(){vec4 ink=texture2D(uInk,vPrintUV);if(ink.r+ink.g<.001)ink.rg=uPaper/255.;ink.b=uClass;gl_FragColor=ink;}',
        }));
        o.material=printMaterials.get(atlas);
      } else o.material=kind==='print'?idMaterial(0,0,side):kind==='depth'?depthMaterial:kind==='cover'?idMaterial(cover?255:0,0,side):idMaterial(lab.instance,lab.semantic,side);
    });
    scene.environment=null;scene.background=null;scene.overrideMaterial=null;
    renderer.shadowMap.enabled=false;renderer.localClippingEnabled=false;
    if(!keepView){const s=camera.userData.captureShift??[0,0];if(s[0]||s[1])camera.setViewOffset(width,height,s[0]*width,s[1]*height,width,height);else camera.clearViewOffset();}
    renderer.setRenderTarget(rt);renderer.setClearColor(0x000000,1);renderer.clear();renderer.render(scene,camera);
    renderer.readRenderTargetPixels(rt,0,0,width,height,px);
  } finally {
    for(const [o,m,v] of saved){o.material=m;o.visible=v;}
    scene.environment=env;scene.background=bg;scene.overrideMaterial=override;
    camera.view=oldView;camera.projectionMatrix.copy(projection);camera.projectionMatrixInverse.copy(projectionInverse);
    renderer.setRenderTarget(prevTarget);renderer.setClearColor(prevClear,prevAlpha);
    renderer.shadowMap.enabled=prevShadow;renderer.localClippingEnabled=prevClipping;rt.dispose();
    for(const mat of printMaterials.values())mat.dispose();
  }
  return flipRows(px,width,height,4);
}
export function renderDepth(renderer,scene,camera,width,height) {
  const raw=renderRawTarget(renderer,scene,camera,width,height,{kind:'depth'}),out=new Float32Array(width*height);
  for(let i=0;i<out.length;i++){const v=raw[i*4]+256*raw[i*4+1]+65536*raw[i*4+2];out[i]=v?v/1e6:1e10;}
  return out;
}
export function renderCoverMask(renderer,scene,camera,width,height) {
  const raw=renderRawTarget(renderer,scene,camera,width,height,{kind:'cover'});
  return Uint8Array.from({length:width*height},(_,i)=>raw[i*4]);
}
export function renderPrintInstances(renderer,scene,camera,width,height) {
  const raw=renderRawTarget(renderer,scene,camera,width,height,{kind:'print'});
  return Uint16Array.from({length:width*height},(_,i)=>raw[i*4]+256*raw[i*4+1]);
}
// Returns { width, height, instance: Uint16Array, semantic: Uint8Array, boxes }.
export function renderLabels(renderer, scene, camera, width, height, { keepView = false } = {}) {
  const top=renderRawTarget(renderer,scene,camera,width,height,{keepView});
  const instance = new Uint16Array(width * height), semantic = new Uint8Array(width * height);
  const boxes = new Map();
  for (let i = 0; i < width * height; i++) {
    const id = top[i * 4] | (top[i * 4 + 1] << 8);
    instance[i] = id; semantic[i] = top[i * 4 + 2];
    if (isPillId(id)) {
      const x = i % width, y = (i / width) | 0;
      let b = boxes.get(id);
      if (!b) { b = { id, x0: x, y0: y, x1: x, y1: y, pixels: 0, semantic: top[i * 4 + 2] }; boxes.set(id, b); }
      if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
      b.pixels++;
    }
  }
  return { width, height, instance, semantic, boxes: [...boxes.values()].sort((a, b) => a.id - b.id), raw: top };
}

// Distinct preview colours for visualisation only (never the raw IDs).
export function colorize(labels, mode = 'instance') {
  const { width, height, instance, semantic } = labels;
  const out = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    let c;
    if (mode === 'semantic') c = semantic[i]===0 ? [0,0,0,0] : [...(CLASS_COLORS[semantic[i]] ?? [255,0,255]),255];
    else {
      const id = instance[i];
      if (!id) c = [0,0,0,0];
      else if(id===1)c=[104,102,97,140];
      else if(id===500)c=[238,235,226,230];
      else if(id>=1000&&id<2000&&id%2===0)c=[226,212,172,220];
      else { const h = (id * 0.61803398875) % 1; c = hsl(h, .68, .58); c.push(255); }
    }
    out.set(c, i * 4);
  }
  return new ImageData(out, width, height);
}
function hsl(h, s, l) {
  const f = (n) => { const k = (n + h * 12) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
