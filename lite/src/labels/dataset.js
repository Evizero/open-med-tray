// Mini dataset export: each scene is rebuilt from a deterministic seed, frozen
// (no animation, no damping, fixed camera/transforms/resolution), rendered as
// beauty RGB and a geometric label pass with the SAME camera, then encoded and
// round-trip verified. Everything runs locally in the browser.
import * as THREE from 'three';
import {GENERATOR_REVISION} from './generator-version.js';
import {datasetReadme} from './dataset-readme.js';
export {collectionZip} from './collection-export.js';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { encodePNG, decodePNG } from '../util/png.js';
import { TrayScene, randomConfig, SEMANTIC } from '../scene/trayscene.js';
import { renderLabels, renderDepth, renderCoverMask, renderPrintInstances, colorize } from './idpass.js';
import { trainingTargets } from './blender-contract.js';
import {CLASSES,isPillId} from './schema.js';
import { applyCameraResponse } from '../render/camera-response.js';
import { encodeFloat32NPY } from '../util/npy.js';
import { STRESS_SCENARIOS } from '../scene/stress.js';

// Yield until the next frame has been painted (rAF, then a task), so progress UI is visible before synchronous GPU work.
const nextFrame = () => new Promise((r) => { let done = false; const f = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(() => setTimeout(f, 0)); setTimeout(f, 60); });

function cameraRecord(cam, width, height) {
  cam.updateMatrixWorld();
  return {
    model: 'pinhole (no lens distortion); depth of field disabled for dataset renders',
    position_mm: cam.position.toArray(),
    quaternion_xyzw: cam.quaternion.toArray(),
    up: cam.up.toArray(),
    vertical_fov_deg: +cam.fov.toFixed(4), aspect: cam.aspect, near_mm: cam.near, far_mm: cam.far,
    resolution_px: [width, height],
    projection_matrix: cam.projectionMatrix.elements.slice(),
    world_to_camera_matrix: cam.matrixWorldInverse.elements.slice(),
    focal_length_px: +(height / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)).toFixed(3),
    world_frame: 'millimetres, +Y up; tray local (x, y, z) = world (x, -z, y)',
    ...cam.userData.record,
  };
}

export async function generateDataset(stage, { count = 8, baseSeed = 1000, width = 1024, height = 512, samples = 12, cameraProfile = 'auto', cameraStrength = 1, stressProbability = .06, sampling = 'mixed', scenarioOffset = 0, startIndex = 0, collect = true, onProgress, onScene, signal }) {
  if(!['mixed','ordinary','stress_sweep'].includes(sampling))throw new Error(`Unknown sampling schedule: ${sampling}`);
  let files = {};
  const root = 'pill-atelier-dataset/';
  const manifest = { generator_revision:GENERATOR_REVISION, label_schema:'medtray/classes-v1', generator: 'Pill Atelier (browser, three.js raster)', created: new Date().toISOString(), scenes: [], resolution: [width, height], beauty_samples_per_pixel: samples, base_seed: baseSeed, stress_probability:stressProbability, sampling, scenario_offset:scenarioOffset, semantic_classes: SEMANTIC, verification: [] };
  const scene = new THREE.Scene();
  scene.background = new THREE.Color().setRGB(.12, .115, .105);
  const pipe = stage.pipe;
  const saved = { mode: stage.mode, camera: stage.camera.clone(), controlsEnabled: stage.controls.enabled,
    controlTarget: stage.controls.target.clone(), exposure: pipe.exposure, ao: {...pipe._aoParams}, dof: {...pipe.dof} };
  stage.controls.enabled = false;
  stage.busyExport = true;
  scene.add(stage.rig.group);
  let cancelled = false;
  let activeTray = null;
  try {
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) { cancelled = true; break; }
      const seed = baseSeed + i;
      const globalIndex = startIndex + i;
      const config = randomConfig(seed,{stressProbability:sampling==='ordinary'?0:stressProbability,scenario:sampling==='stress_sweep'?STRESS_SCENARIOS[(scenarioOffset+i)%STRESS_SCENARIOS.length]:null});
      onProgress?.({ index: i, count, stage: 'building', seed, globalIndex, scenario: config.edgeScenario ?? 'ordinary' });
      await nextFrame();
      const tray = new TrayScene(config, { animate: false });
      activeTray = tray;
      scene.add(tray.group);
      const side = (config.seed & 1) ? 1 : -1;
      stage.rig.apply(scene, config.lighting, { center: new THREE.Vector3(0, tray.params.height * .5, 0), extent: tray.params.width * .62, side, seed:config.seed, widthMM:tray.params.width, depthMM:tray.params.depth, shadowSize: stage.mobile ? 1024 : 2048 });
      tray.meta.lighting_parameters=structuredClone(stage.rig.record);
      const cam = tray.captureCamera(width / height);
      scene.updateMatrixWorld(true);
      // Freeze: labels first, beauty second, labels again — identical state required.
      const labelsA = renderLabels(pipe.renderer, scene, cam, width, height);
      if (signal?.aborted) { cancelled = true; break; }
      onProgress?.({ index: i, count, stage: 'rendering', seed, globalIndex });
      await nextFrame();
      pipe.setScene(scene, cam);
      pipe.setAO({ radius: 5, intensity: .7 });
      pipe.exposure = 1;
      const rgba = pipe.renderStill(width, height, samples);
      const labels = renderLabels(pipe.renderer, scene, cam, width, height);
      const depth = renderDepth(pipe.renderer, scene, cam, width, height);
      const filmMask = renderCoverMask(pipe.renderer, scene, cam, width, height);
      const graphicInstances = renderPrintInstances(pipe.renderer, scene, cam, width, height);
      // Progress only (backwards-compatible): GPU passes are done; CPU encode/verify follows.
      onProgress?.({ index: i, count, stage: 'encoding', seed, globalIndex });
      await nextFrame();
      let frozen = labelsA.raw.length === labels.raw.length;
      for (let k = 0; frozen && k < labels.raw.length; k++) if (labelsA.raw[k] !== labels.raw[k]) frozen = false;
      // Encode + exact round trip.
      let rgb = new Uint8Array(width * height * 3);
      for (let k = 0; k < width * height; k++) { rgb[k * 3] = rgba[k * 4]; rgb[k * 3 + 1] = rgba[k * 4 + 1]; rgb[k * 3 + 2] = rgba[k * 4 + 2]; }
      const response = await applyCameraResponse(rgb,width,height,seed,cameraProfile,cameraStrength);
      rgb = response.pixels;
      const glare = Uint8Array.from(filmMask,(v,i)=>v && (rgb[i*3]+rgb[i*3+1]+rgb[i*3+2])/3>242?255:0);
      const paperIds=new Set(tray.printedGraphics.filter(g=>g.kind==='sticker_paper').map(g=>g.instance_id));
      const printInstances=Uint16Array.from(graphicInstances,id=>paperIds.has(id)?0:id);
      const stickerMask = Uint8Array.from(labels.instance,v=>v>=1000&&v<2000?255:0);
      const rgbPng = encodePNG({ width, height, data: rgb, colorType: 2 });
      const instPng = encodePNG({ width, height, data: labels.instance, colorType: 0, bitDepth: 16 });
      const semPng = encodePNG({ width, height, data: labels.semantic, colorType: 0, bitDepth: 8 });
      const di = decodePNG(instPng), ds = decodePNG(semPng), dr = decodePNG(rgbPng);
      let instOK = di.data.length === labels.instance.length, semOK = ds.data.length === labels.semantic.length, rgbOK = dr.data.length === rgb.length;
      for (let k = 0; instOK && k < labels.instance.length; k++) if (di.data[k] !== labels.instance[k]) instOK = false;
      for (let k = 0; semOK && k < labels.semantic.length; k++) if (ds.data[k] !== labels.semantic[k]) semOK = false;
      for (let k = 0; rgbOK && k < rgb.length; k += 97) if (dr.data[k] !== rgb[k]) rgbOK = false;
      // Colourised preview (visualisation only), blended over RGB.
      const vis = colorize(labels, 'instance');
      const prev = new Uint8Array(width * height * 3);
      for (let k = 0; k < width * height; k++) {
        const a = vis.data[k * 4 + 3] / 255 * .72;
        for (let c = 0; c < 3; c++) prev[k * 3 + c] = Math.round(rgb[k * 3 + c] * (1 - a) + vis.data[k * 4 + c] * a);
      }
      for (const b of labels.boxes) drawBox(prev, width, height, b);
      const prevPng = encodePNG({ width, height, data: prev, colorType: 2 });
      const pills = tray.pillRecords();
      const boxById = new Map(labels.boxes.map((b) => [b.id, b]));
      for (const p of pills) {
        const b = boxById.get(p.instance_id);
        p.visible_pixels = b ? b.pixels : 0;
        p.bbox_xyxy_px = b ? [b.x0, b.y0, b.x1 + 1, b.y1 + 1] : null;
        p.fully_hidden = !b;
      }
      const semCounts = {};
      for (let k = 0; k < labels.semantic.length; k++) semCounts[labels.semantic[k]] = (semCounts[labels.semantic[k]] || 0) + 1;
      const name = `scene_${String(globalIndex + 1).padStart(4, '0')}`;
      const meta = {
        scene: name, seed, generator_revision:GENERATOR_REVISION, label_schema:'medtray/classes-v1', ...tray.meta,
        camera: cameraRecord(cam, width, height),
        camera_response: response.record,
        pills,
        non_pill_objects: [
          { object: 'tray', semantic_id: 1 }, ...tray.meta.stickers.map(s=>({object:'sticker',semantic_id:1,...s})),
          ...tray.meta.debris.map((d) => ({ object: d.kind, semantic_id: 14, ...d })),
          ...(tray.cover ? [{ object: 'cover', semantic_id: null, note: 'transparent; excluded from label passes' }] : []),
        ],
        label_pixel_counts_by_semantic: semCounts,
        files: { rgb: `${name}/rgb.png`, instance_ids: `${name}/instance_ids.png`, semantic_ids: `${name}/semantic_ids.png`, label_preview: `${name}/label_preview.png` },
        verification: { instance_png_roundtrip_exact: instOK, semantic_png_roundtrip_exact: semOK, rgb_png_roundtrip_sampled: rgbOK, state_frozen_between_label_passes: frozen, same_camera_for_rgb_and_labels: true },
      };
      // Also provide the prepared-data naming/class contract used by our training loaders.
      // Missing diagnostics are declared, never silently replaced with blank ground truth.
      const bridge=trainingTargets(labels,pills,tray.meta,meta.camera,{split:'train',index:globalIndex});
      bridge.meta.generator_revision=GENERATOR_REVISION;
      bridge.meta.camera_response = response.record;
      bridge.meta.unavailable_targets = [];
      bridge.meta.printed_graphics = structuredClone(tray.printedGraphics);
      const graphicById=new Map(bridge.meta.printed_graphics.map(g=>[g.instance_id,g]));
      for(const g of graphicById.values()){g.visible_pixels=0;g.bbox_xyxy=null;bridge.meta.instance_to_class[g.instance_id]=1;}
      for(let k=0;k<graphicInstances.length;k++) {
        const id=graphicInstances[k];
        if(id){if(!graphicById.has(id))throw new Error(`Unknown printed graphic ID ${id}`);if(isPillId(labels.instance[k]))throw new Error('Printed ink target overlaps a pill surface');bridge.instance[k]=id;bridge.semantic[k]=1;}
        const g=graphicById.get(bridge.instance[k]);if(!g)continue;
        g.visible_pixels++;const x=k%width,y=Math.floor(k/width),b=g.bbox_xyxy;
        if(!b)g.bbox_xyxy=[x,y,x+1,y+1];else{b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x+1);b[3]=Math.max(b[3],y+1);}
      }
      meta.instance_to_class = {...bridge.meta.instance_to_class};
      bridge.meta.print_target_contract = 'Exact authored texture ink with 50% texel coverage threshold, nearest sampling at the geometric pixel centre; modal occlusion. This raster print representation differs from Blender text meshes.';
      bridge.meta.depth_contract = {units:'metres',meaning:'Euclidean camera-ray distance to first geometric surface with cover removed',quantization_metres:1e-6,background:1e10};
      bridge.meta.glare_diagnostic = {method:'Mean processed RGB > 242 on geometric first cover surface; brightness heuristic, not optical visibility',cover_bright_pixel_fraction:glare.reduce((a,v)=>a+(v>0),0)/Math.max(1,filmMask.reduce((a,v)=>a+(v>0),0))};
      bridge.meta.quality.film_coverage = filmMask.reduce((a,v)=>a+(v>0),0)/filmMask.length;
      for(const object of bridge.meta.objects) {
        let pixels=0,bright=0;
        for(let k=0;k<labels.instance.length;k++)if(labels.instance[k]===object.instance_id){pixels++;if(glare[k])bright++;}
        object.glare_pixel_fraction=pixels?bright/pixels:null;
      }
      const stem=`blender/train/${String(globalIndex).padStart(6,'0')}`;
      files[root+stem+'.png']=[rgbPng,{level:0}];
      files[root+stem+'_instance.png']=[encodePNG({width,height,data:bridge.instance,colorType:0,bitDepth:16}),{level:0}];
      files[root+stem+'_semantic.png']=[encodePNG({width,height,data:bridge.semantic,colorType:0,bitDepth:8}),{level:0}];
      files[root+stem+'_depth.npy']=[encodeFloat32NPY(depth,width,height),{level:1}];
      for(const [suffix,data] of [['film',filmMask],['glare',glare],['sticker',stickerMask]])
        files[root+stem+`_${suffix}.png`]=[encodePNG({width,height,data,colorType:0,bitDepth:8}),{level:0}];
      files[root+stem+'_print_instance.png']=[encodePNG({width,height,data:printInstances,colorType:0,bitDepth:16}),{level:0}];
      files[root+stem+'_print.png']=[encodePNG({width,height,data:Uint8Array.from(printInstances,v=>v?255:0),colorType:0,bitDepth:8}),{level:0}];
      files[root+stem+'.json']=strToU8(JSON.stringify(bridge.meta,null,1));
      files[root+'blender/classes.json']=strToU8(JSON.stringify(CLASSES.map((name,id)=>({id,name})),null,1));
      files[root + meta.files.rgb] = [rgbPng, { level: 0 }];
      files[root + meta.files.instance_ids] = [instPng, { level: 0 }];
      files[root + meta.files.semantic_ids] = [semPng, { level: 0 }];
      files[root + meta.files.label_preview] = [prevPng, { level: 0 }];
      files[root + `${name}/metadata.json`] = strToU8(JSON.stringify(meta, null, 1));
      manifest.scenes.push({ scene: name, seed, scenario:config.edgeScenario??'ordinary', stacked:tray.meta.placement.stacked, spilled:tray.meta.placement.spilled, style: config.style, cover: config.cover, lighting: config.lighting, surface: config.surface, pills: pills.length, visible_pills: pills.filter((p) => !p.fully_hidden).length });
      manifest.verification.push({ scene: name, ...meta.verification });
      const thumb = thumbnail(rgb, width, height, 320);
      const thumbL = thumbnailRGBA(vis, 320, prev, width, height);
      const sceneRecord = { ...manifest, scenes: [manifest.scenes.at(-1)], verification: [manifest.verification.at(-1)] };
      // Collection mode releases raw scene files before building the next one.
      // Await the consumer so persistence can exert backpressure.
      let archive = null;
      if (!collect) {
        files[root + 'manifest.json'] = strToU8(JSON.stringify(sceneRecord,null,1));
        files[root + 'README.md'] = strToU8(datasetReadme(sceneRecord));
        archive = zipSync(files); files = {};
      }
      await onScene?.({ index: i, globalIndex, name, seed, thumb, thumbLabels: thumbL, meta, archive, manifest: sceneRecord });
      tray.dispose();
      scene.remove(tray.group);
      activeTray = null;
    }
  } finally {
    activeTray?.dispose();
    scene.remove(stage.rig.group);
    stage.busyExport = false;
    // Restore the user's scene, lighting, camera and controls.
    pipe.scene = null;
    if (saved.mode === 'tray' && stage.tray) { stage.trayWorld.add(stage.rig.group); stage.applyTrayLighting(); }
    else { stage.studio.add(stage.rig.group); stage.lightStudio(); }
    stage.camera.copy(saved.camera);
    stage.controls.target.copy(saved.controlTarget);
    stage.controls.enabled = saved.controlsEnabled;
    pipe.exposure = saved.exposure; pipe.setAO(saved.ao); Object.assign(pipe.dof,saved.dof);
    pipe.reset(); stage.wake();
  }
  if (!collect || !manifest.scenes.length) return { cancelled, zip: null, manifest };
  manifest.cancelled_after = cancelled ? manifest.scenes.length : null;
  files[root + 'manifest.json'] = strToU8(JSON.stringify(manifest, null, 1));
  files[root + 'README.md'] = strToU8(datasetReadme(manifest));
  const zip = zipSync(files);
  return { cancelled, zip, manifest };
}

function drawBox(img, w, h, b) {
  const col = [255, 255, 255];
  for (let x = b.x0; x <= b.x1; x++) for (const y of [b.y0, b.y1]) img.set(col, (y * w + x) * 3);
  for (let y = b.y0; y <= b.y1; y++) for (const x of [b.x0, b.x1]) img.set(col, (y * w + x) * 3);
}

function thumbnail(rgb, w, h, tw) {
  const th = Math.round(tw * h / w);
  const cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
  const src = document.createElement('canvas'); src.width = w; src.height = h;
  const id = new ImageData(w, h);
  for (let k = 0; k < w * h; k++) { id.data[k * 4] = rgb[k * 3]; id.data[k * 4 + 1] = rgb[k * 3 + 1]; id.data[k * 4 + 2] = rgb[k * 3 + 2]; id.data[k * 4 + 3] = 255; }
  src.getContext('2d').putImageData(id, 0, 0);
  const ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, 0, tw, th);
  return cv.toDataURL('image/jpeg', .86);
}
function thumbnailRGBA(vis, tw, prev, w, h) {
  const th = Math.round(tw * h / w);
  const src = document.createElement('canvas'); src.width = w; src.height = h;
  const id = new ImageData(w, h);
  for (let k = 0; k < w * h; k++) { id.data[k * 4] = prev[k * 3]; id.data[k * 4 + 1] = prev[k * 3 + 1]; id.data[k * 4 + 2] = prev[k * 3 + 2]; id.data[k * 4 + 3] = 255; }
  src.getContext('2d').putImageData(id, 0, 0);
  const cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
  const ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, 0, tw, th);
  return cv.toDataURL('image/jpeg', .86);
}
