import {stressConfig,frameStressCamera,STRESS_SCENARIOS} from './stress.js';
import {projectedPill,placeProjected,supportRegions,floorBounds} from './placement.js';
// Deterministic tray scenes: container + cover + sticker + products + debris +
// worktop + lighting + capture camera, all from one integer seed and a config.
// Tray local frame (x width, y depth, z up) maps to world (x, z, -y).
import * as THREE from 'three';
import { containerAssembly } from '../geo/container-assembly.js';
import { mechanicalCover } from '../geo/cover-mechanisms.js';
import { RNG, clamp } from '../util/rng.js';
import { trayParams, buildTraySkin, trayPrintTexture, CONTAINER_COLORS, TRAY_STYLES, coverSheet, smudgeTexture, makeFilmMaterial, stickerTexture } from '../geo/tray.js';
import {sampleIntrinsics,intrinsics} from './camera-intrinsics.js';
import { worktop, SURFACES } from '../render/surfaces.js';
import { LIGHTING } from '../render/lighting.js';
import { sampleLightingKind } from '../render/lighting-priors.js';
import { randomProduct, instanceVariant, familyOf } from './catalog.js';
import { Pill } from './pill.js';
import {buildDebris} from './debris.js';

import {SEMANTIC, classFor as semanticFor, INSTANCE} from '../labels/schema.js';
export {SEMANTIC, semanticFor};

const w2 = (x, y, z) => new THREE.Vector3(x, z, -y); // tray local -> world

export function randomConfig(seed, {stressProbability=.06,scenario=null,split='train',appearanceProbability=.35}={}) {
  const rng = new RNG(seed ^ 0x5bd1e995);
  const style = rng.weighted(Object.keys(TRAY_STYLES), Object.values(TRAY_STYLES).map(s => s.weight));
  const container = style === 'rigid_organizer' ? rng.pick(['clear_plastic', 'milky_polypropylene', 'tinted_clear']) : rng.weighted(Object.keys(CONTAINER_COLORS), [19, 15, 20, 6, 6, 4, 10, 12, 8]);
  const covers = TRAY_STYLES[style].covers;
  const config = {
    seed, style, container, productSplit:split, appearanceProbability, cover: rng.pick(covers), surface: rng.pick(Object.keys(SURFACES)),
    lighting: sampleLightingKind(rng),
    count: rng.int(4, 11), products: rng.int(3, 6), damage: rng.uniform(0, .25), debris: rng.chance(.45), sticker: rng.chance(.5),
    language: rng.weighted(['de', 'en', 'fr', 'it'], [6, 3, 1.5, 1.5]),
    camera: { ...sampleIntrinsics(seed), clearance: rng.uniform(100, 150), tilt: rng.uniform(-6, 6), roll: rng.uniform(-4, 4), offsetX: rng.uniform(-8, 8), offsetY: rng.uniform(-5, 5) },
  };
  // Preserve the historical draw sequence for unrelated scene settings; the
  // source now samples debris per eligible tablet, not with a scene-wide gate.
  config.debris=true;
  const srng=new RNG(seed+902193);
  return scenario || srng.chance(stressProbability) ? stressConfig(config,scenario??srng.pick(STRESS_SCENARIOS),Math.abs(seed)%72) : config;
}

export class TrayScene {
  constructor(config, { lod = 'tray', animate = true, productsOverride = null } = {}) {
    this.config = structuredClone(config);
    this.group = new THREE.Group();
    this.pills = [];
    this.disposables = [];
    this.meta = {};
    this.animate = animate;
    this.drops = [];
    this.build(lod, productsOverride);
  }

  build(lod, productsOverride) {
    const c = this.config;
    const rng = new RNG(c.seed);
    const p = trayParams(rng.fork('tray'), c.style, { ...(c.containerParams ?? {}), language: c.language, brand: c.brand, logo: c.logo, brandPlacement: c.brandPlacement });
    this.params = p;
    const cc = CONTAINER_COLORS[c.container] || CONTAINER_COLORS.blue_polypropylene;
    const mrng = rng.fork('mat');
    const base = cc.color.map((v) => clamp(v * mrng.uniform(.93, 1.07), .008, .98));
    const lightInk = cc.kind === 'opaque' && base.reduce((a, b) => a + b) / 3 < .2;
    const print = trayPrintTexture(p, cc.kind === 'opaque' ? base : [.94, .96, .97], { lightInk });
    this.disposables.push(print,print.userData.printTarget.texture);
    this.printedGraphics = structuredClone(print.userData.printTarget.records);
    let mat;
    if (cc.kind === 'opaque') mat = new THREE.MeshPhysicalMaterial({ map: print, roughness: mrng.uniform(.3, .45), clearcoat: mrng.uniform(.03, .1), clearcoatRoughness: .27, ior: 1.48, specularIntensity: .9 });
    else {
      const clear = cc.kind === 'clear';
      mat = new THREE.MeshPhysicalMaterial({ map: print, roughness: clear ? mrng.uniform(.03, .07) : mrng.uniform(.16, .3), transmission: clear ? 1 : .6, thickness: p.thickness * 1.2, ior: clear ? 1.57 : 1.49, attenuationColor: new THREE.Color().setRGB(...base), attenuationDistance: c.container === 'tinted_clear' ? 4 : 40, specularIntensity: 1 });
      if (!clear) mat.color.setRGB(...base.map((v) => Math.min(1, v * 1.05)));
    }
    this.disposables.push(mat);
    const assembly = containerAssembly(p,mat);
    const frame = new THREE.Group();frame.rotation.x=-Math.PI/2;
    frame.add(assembly.group);this.group.add(frame);
    this.frame=frame;this.tray=assembly.group;this.assembly=assembly.record;
    for(const part of assembly.parts) {
      this.disposables.push(part.geometry);
      if(part.material!==mat)this.disposables.push(part.material);
    }

    // Worktop just below the tray base.
    const top = worktop(c.surface, [6000,6000], c.seed);
    const baseZ = p.skirt === 'full' ? p.floorZ - p.thickness : Math.min(p.floorZ - p.thickness, p.height - 1.2 - p.skirt);
    top.position.y = Math.min(baseZ, p.floorZ - p.thickness) - .02;
    this.group.add(top);
    this.worktop = top;
    this.disposables.push(top.geometry,top.material);

    // ------------------------------------------------ products and placement
    const prng = rng.fork('products');
    const products = productsOverride ?? Array.from({ length: c.products }, (_, i) => randomProduct(prng, i, {split:c.productSplit??'train',appearanceProbability:c.appearanceProbability??.35}));
    this.products = products;
    const placed = [];
    const drng = rng.fork('place');
    const wells = supportRegions(p,top.position.y,c.spillFraction??0);
    this.regions=wells;
    const trayWells=wells.filter(w=>w.kind==='tray'),tableWells=wells.filter(w=>w.kind==='table');
    const weights=trayWells.map(()=>-Math.log(Math.max(1e-6,drng.random()))+.2);
    const spillCount=tableWells.length?Math.min(c.count,Math.max(1,Math.round(c.count*c.spillFraction))):0;
    const order=Array.from({length:c.count},(_,i)=>i);
    for(let i=order.length-1;i>0;i--){const j=drng.int(0,i);[order[i],order[j]]=[order[j],order[i]];}
    const spilled=new Set(order.slice(0,spillCount));
    let rejected=0,instance=INSTANCE.pillStart;
    for(let k=0;k<c.count;k++) {
      const pi=k<products.length?k:drng.int(0,products.length-1);
      const spec=instanceVariant(products[pi],drng,c.damage);
      const pill=new Pill(spec,{lod,instance,semantic:semanticFor(spec)});
      const yaw=drng.uniform(0,Math.PI*2),curved=spec.kind!=='tablet';
      const flip=curved?drng.uniform(-Math.PI,Math.PI):drng.chance(.38)?Math.PI:0;
      const tilt=curved?drng.uniform(-.07,.07):0;
      pill.group.rotation.set(flip,yaw,tilt,'YXZ');
      const shape=projectedPill(pill);
      const preferred=spilled.has(k)?drng.pick(tableWells).index:drng.weighted(trayWells,weights).index;
      const closed=['rigid_sliding','partly_open_sliding','flexible_film','hinged_closed','individual_hinged'].includes(c.cover);
      const maxHeight=Math.min(c.maxStackHeight??18,closed&&wells[preferred].kind==='tray'?p.height-p.floorZ-.15:Infinity);
      const fit=placeProjected(shape,drng,wells,preferred,placed,{maxStackHeight:maxHeight,allowStack:c.allowStack??true});
      if(!fit){pill.dispose();rejected++;continue;}
      const pl={...fit,spec,product:pi,yaw,flip,tilt,instance:instance++};placed.push(pl);
      const pos=w2(pl.x,pl.y,pl.z);pill.group.position.copy(pos);
      pill.placement=pl;pill.rest=pos.clone();this.group.add(pill.group);this.pills.push(pill);
      if(this.animate){pill.group.position.y+=26+k*1.5;this.drops.push({pill,delay:.12+k*.065,t:0});}
    }

    // ------------------------------------------------ debris (not pills)
    const occupied=this.pills.map(q=>({...q.placement,bottom:projectedPill(q).bottom-q.group.position.y+q.placement.z}));
    const scattered=buildDebris(this.pills,wells,rng.fork('debris'),c,occupied);
    this.debris=scattered.meshes;const debrisRecords=scattered.records;
    this.disposables.push(...scattered.disposables);for(const mesh of this.debris)this.group.add(mesh);
    this.debrisPlacement=scattered.placement;

    // ------------------------------------------------ cover
    const crng = rng.fork('cover');
    this.cover = null;
    let coverRec = { kind: 'none' };
    const smudge = smudgeTexture(crng.int(1, 1e6), p.width, p.depth);
    this.disposables.push(smudge.texture);
    const film = makeFilmMaterial(smudge.texture, { roughness: crng.uniform(.02, .06), haze: crng.uniform(.35, .7) });
    this.disposables.push(film);
    let stickerSurface = null;
    if (c.cover === 'rigid_sliding' || c.cover === 'partly_open_sliding' || c.cover === 'flexible_film') {
      const filmKind = c.cover === 'flexible_film';
      const shift = c.cover === 'partly_open_sliding' ? p.width * (c.coverShift ?? crng.uniform(.18, .55)) : 0;
      const sheet = coverSheet(p, crng, { film: filmKind, shift });
      const mesh = new THREE.Mesh(sheet.geometry, film);
      mesh.renderOrder = 2;
      mesh.userData.noLabel = true;
      frame.add(mesh);
      this.cover = mesh;
      this.disposables.push(sheet.geometry);
      if (!filmKind) {
        const railMat = mat;
        for (const s of [-1, 1]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(p.width, 1.1, 1.2), railMat);
          rail.position.set(0, s * (p.depth / 2 - .55), p.height + .6);
          rail.castShadow = true; rail.userData.label = { instance: INSTANCE.tray, semantic: 1, object: 'cover rail' };
          frame.add(rail); this.disposables.push(rail.geometry);
        }
      }
      coverRec = { kind: c.cover, ...sheet.record, smudge_prints: smudge.prints, scratches: smudge.scratches, material: 'clear PET/PP thin sheet', label_policy: 'excluded from geometric labels' };
      if (!filmKind || c.stickerForceCover) stickerSurface = { z: (x, y) => sheet.heightAt(x, y) + .06, bounds: [shift-p.width*.47,shift+p.width*.47,-p.depth*.45,p.depth*.45] };
    } else if (c.cover.startsWith('hinged') || ['individual_hinged','detached_lid','peeled_film'].includes(c.cover)) {
      const assembly=mechanicalCover(p,c,crng,film,mat);
      frame.add(assembly.group);for(const hinge of assembly.hinges)frame.add(hinge);
      this.cover=assembly.group;
      coverRec={...assembly.record,smudge_prints:smudge.prints,scratches:smudge.scratches};
      if(assembly.record.panels?.length){
        const panel=assembly.record.panels[0], [w,d]=panel.size_mm, cy=-panel.side*d/2;
        stickerSurface={parent:assembly.group.children[0],panel:0,z:()=>.07,bounds:[-w*.47,w*.47,cy-d*.45,cy+d*.45]};
      }
    }

    this.cover?.traverse(o=>{if(o.isMesh && o.userData.noLabel)o.userData.coverTarget=true;});

    // ------------------------------------------------ sticker (opaque paper)
    this.sticker = null; this.stickers=[];
    const stickerRecords=[]; let stickerRec=null;
    for(let si=0;si<(c.sticker?Math.min(6,c.stickerCount??1):0);si++) {
      const srng = rng.fork('sticker-'+si),paperId=1000+si*2;
      let sw = srng.uniform(34,48)*(c.stickerLarge?1.35:1), sh = srng.uniform(12,17)*(c.stickerLarge?1.3:1);
      let sx, sy, sz, ang = srng.gauss(0, .08);
      if (stickerSurface) {
        const [x0, x1, y0, y1] = stickerSurface.bounds;
        const scale=Math.min(1,(x1-x0)*.8/sw,(y1-y0)*.8/sh);sw*=scale;sh*=scale;
        const rx=Math.abs(Math.cos(ang))*sw/2+Math.abs(Math.sin(ang))*sh/2,ry=Math.abs(Math.sin(ang))*sw/2+Math.abs(Math.cos(ang))*sh/2;
        sx=srng.uniform(x0+rx,x1-rx);sy=srng.uniform(y0+ry,y1-ry);
        if(c.stickerCentral){sx=(sx+(x0+x1)/2)/2;sy=(sy+(y0+y1)/2)/2;}
        sz = stickerSurface.z(sx, sy)+si*.025;
      } else {
        // Actual solid panel bounds, including left/right branding panels.
        // A label may cover branding, but must not float across a recessed well.
        const bp = p.brandPanel ?? {x:0, y:-p.depth/2+p.rim/2, w:p.width-2*p.rim, h:p.rim};
        ang = srng.uniform(-.025,.025);
        sh = Math.min(sh, bp.h * .78); sw = Math.min(sw, bp.w * .85, sh * 3.4);
        const rx = Math.abs(Math.cos(ang))*sw/2 + Math.abs(Math.sin(ang))*sh/2;
        const ry = Math.abs(Math.sin(ang))*sw/2 + Math.abs(Math.cos(ang))*sh/2;
        sx = bp.x + srng.uniform(-1,1)*Math.max(0,bp.w/2-rx-.2);
        sy = bp.y + srng.uniform(-1,1)*Math.max(0,bp.h/2-ry-.2);
        sz = p.height + .05;
      }
      const st = stickerTexture(srng, { w: sw, h: sh, firstId:paperId+1 });
      const sm = new THREE.MeshPhysicalMaterial({ map: st.texture, roughness: .85, specularIntensity: .4, side:THREE.DoubleSide });
      sm.userData.paperInstance=paperId;
      const sg = new THREE.PlaneGeometry(sw, sh, 8, 3);
      if (stickerSurface) {
        const pos = sg.attributes.position;
        for (let v=0; v<pos.count; v++) {
          const x=pos.getX(v), y=pos.getY(v);
          const px=sx+x*Math.cos(ang)-y*Math.sin(ang), py=sy+x*Math.sin(ang)+y*Math.cos(ang);
          pos.setZ(v,stickerSurface.z(px,py)+si*.025-sz);
        }
        sg.computeVertexNormals();
      }
      const mesh = new THREE.Mesh(sg, sm);
      mesh.position.set(sx, sy, sz); mesh.rotation.z = ang;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.label = { instance: paperId, semantic: 1, object: 'sticker' };
      (stickerSurface?.parent??frame).add(mesh);
      this.sticker ??= mesh;this.stickers.push(mesh);mesh.userData.onCover=!!stickerSurface;
      this.disposables.push(st.texture,st.texture.userData.printTarget.texture,sm,sg);
      this.printedGraphics.push({instance_id:paperId,kind:'sticker_paper'},...st.texture.userData.printTarget.records);
      stickerRec = { ...st.record, instance_id:paperId, ink_instance_id:paperId+1, attachment_panel:stickerSurface?.panel??null, coordinate_frame:stickerSurface?.parent?'cover hinge local':'tray local', on: stickerSurface ? 'cover' : 'tray flange', position_mm: [+sx.toFixed(2), +sy.toFixed(2), +sz.toFixed(2)], angle_deg: +(ang * 180 / Math.PI).toFixed(2) };
      stickerRecords.push(stickerRec);
    }

    this.meta = {
      generator: 'pill-atelier browser parity v3',
      seed: c.seed,
      config: structuredClone(c),
      container: { style: c.style, style_label: TRAY_STYLES[c.style].label, material: c.container, base_color_linear: base.map((v) => +v.toFixed(4)), width_mm: +p.width.toFixed(2), depth_mm: +p.depth.toFixed(2), height_mm: +p.height.toFixed(2), wall_mm: +p.thickness.toFixed(2), rim_mm: +p.rim.toFixed(2), web_mm: +p.web.toFixed(2), wells: p.cells.map((w, i) => ({ index: i, center_mm: [+w.x.toFixed(2), +w.y.toFixed(2)], size_mm: [+w.w.toFixed(2), +w.h.toFixed(2)], round: !!p.round })), language: p.language, brand: p.brand, logo: p.logo, brand_placement: p.brandPlacement, one_piece_skin: this.assembly.one_piece_skin, assembly: this.assembly, parameters: structuredClone(p) },
      cover: coverRec,
      sticker: stickerRecords[0]??null,stickers:stickerRecords,
      surface: c.surface, surface_pose: structuredClone(top.userData.surfacePose),
      lighting: c.lighting,
      requested_pills: c.count, placed_pills: placed.length, rejected_placements: rejected,
      placement: {revision:'convex_projected_fit_browser_v3',regions:wells.map(({index,kind,floor,bounds})=>({index,kind,floor_mm:floor,bounds_mm:bounds})),stacked:placed.filter(x=>x.stacked).length,spilled:placed.filter(x=>x.region_kind==='table').length,requested_spill:spillCount,scope:'Projected mesh hull fit; conservative bounding-height stack fallback, not rigid-body settling'},
      debris: debrisRecords, debris_placement:this.debrisPlacement,
    };
  }

  // Capture camera: pinhole above the tray at clearance above the rim, 2:1 frame.
  captureCamera(aspect = 2) {
    const c = this.config.camera, p = this.params, lens=intrinsics(c);
    const cam = new THREE.PerspectiveCamera(40, aspect, 1, 3000);
    if(c.captureLock) {
      const lock=c.captureLock;
      cam.position.fromArray(lock.position);cam.quaternion.fromArray(lock.quaternion);cam.up.fromArray(lock.up);
      cam.fov=aspect===lock.aspect?lock.fov:2*Math.atan(Math.tan(lock.fov*Math.PI/360)*lock.aspect/aspect)*180/Math.PI;
      cam.userData.captureShift=lock.shift.slice();cam.userData.record=structuredClone(lock.record);
      cam.userData.record.fit='Preserved user capture camera across content edits';delete cam.userData.record.bounds_world_mm;
      cam.updateProjectionMatrix();cam.updateMatrixWorld(true);return cam;
    }
    const height = p.height + c.clearance;
    const tilt = THREE.MathUtils.degToRad(c.tilt), roll = THREE.MathUtils.degToRad(c.roll);
    const target = w2(c.offsetX, c.offsetY, p.height * .5);
    // Tilt toward the front (+y local = away) keeping the tray centred.
    const eye = target.clone().add(new THREE.Vector3(0, height - p.height * .5, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), tilt));
    cam.position.copy(eye);
    cam.up.set(Math.sin(roll), 0, -Math.cos(roll));
    cam.lookAt(target);
    // Fit actual mechanism bounds, including open lids and detached covers. The
    // worktop is excluded. Fixed-lens capture keeps the requested position;
    // automatic fit may dolly back to avoid extreme near-lid magnification.
    this.group.updateMatrixWorld(true);
    const bounds = new THREE.Box3(),corners=[];
    cam.updateMatrixWorld();
    const view = cam.matrixWorldInverse, q=new THREE.Vector3();
    let halfTan=0;
    const include=(root, offset=null)=>root.traverseVisible(o=>{
      if(!o.isMesh || !o.geometry)return;
      o.geometry.computeBoundingBox();const b=o.geometry.boundingBox;
      // Fit each part in its own frame; one global AABB falsely places the full
      // tray width at the height of its tallest lid and over-zooms the camera.
      for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]) {
        q.set(x,y,z).applyMatrix4(o.matrixWorld);
        if(offset)q.add(offset);
        bounds.expandByPoint(q);corners.push(q.clone());q.applyMatrix4(view);

      }
    });
    include(this.frame);
    for(const pill of this.pills) {
      // The drop is presentation only. Fit the acquisition camera to the
      // settled pill pose so enabling labels cannot silently refit the lens.
      const offset=pill.rest.clone().applyMatrix4(pill.group.parent.matrixWorld)
        .sub(pill.group.getWorldPosition(new THREE.Vector3()));
      include(pill.group,offset);
    }
    const requestedDistance=cam.position.distanceTo(target);
    const rimDepth=-w2(0,0,p.height).applyMatrix4(view).z;
    const nearestDepth=Math.min(...corners.map(p=>-p.clone().applyMatrix4(view).z));
    // Perspective is set by viewpoint, not focal length. Simply widening the
    // frustum made a lifted lid 2–4 times larger than the body. Bound the near
    // surface's magnification relative to the rim by moving the camera back.
    const maxMagnification=1.5;
    const pullback=lens.framing==='fit'?Math.max(0,(rimDepth-maxMagnification*nearestDepth)/(maxMagnification-1)):0;
    if(pullback>0){cam.position.addScaledVector(cam.position.clone().sub(target).normalize(),pullback);cam.updateMatrixWorld(true);}
    for(const point of corners){
      q.copy(point).applyMatrix4(cam.matrixWorldInverse);
      if(q.z>=-1)throw new Error('Capture camera intersects the mechanism; increase camera clearance');
      halfTan=Math.max(halfTan,Math.abs(q.x)/(-q.z*aspect),Math.abs(q.y)/-q.z);
    }
    halfTan*=1.10;
    const requestedTan=lens.sensorWidth/(2*lens.focalLength*aspect);
    // Compensate the dolly with a longer effective lens so the object does not
    // shrink away. Actual camera pose/intrinsics are retained in every export.
    const naturalTan=requestedTan*requestedDistance/(requestedDistance+pullback);
    halfTan=lens.framing==='lens'?requestedTan:Math.max(halfTan,naturalTan);
    cam.fov=THREE.MathUtils.radToDeg(2*Math.atan(halfTan));cam.updateProjectionMatrix();cam.updateMatrixWorld();
    const stress=lens.framing==='lens'?null:frameStressCamera(cam,corners,this.config);
    const acquisitionShift=cam.userData.captureShift??[0,0];
    // Principal point is expressed as a fraction of output width/height.
    cam.userData.captureShift=[acquisitionShift[0]-lens.principalX,acquisitionShift[1]-lens.principalY];
    const tx=Math.tan(THREE.MathUtils.degToRad(cam.fov)/2)*aspect,sensorW=36;
    cam.userData.record={clearance_above_rim_mm:+(cam.position.y-p.height).toFixed(2),requested_clearance_above_rim_mm:+c.clearance.toFixed(2),auto_fit_pullback_mm:+pullback.toFixed(3),near_surface_magnification:+((rimDepth+pullback)/(nearestDepth+pullback)).toFixed(4),tilt_deg:c.tilt,roll_deg:c.roll,offset_mm:[c.offsetX,c.offsetY],
      hfov_deg:+(2*Math.atan(tx)*180/Math.PI).toFixed(3),vfov_deg:+cam.fov.toFixed(3),focal_length_35mm_equiv:+(sensorW/2/tx).toFixed(2),aspect,
      intrinsics:{sensor_width_mm:lens.sensorWidth,sensor_height_mm:lens.sensorWidth/aspect,requested_focal_length_mm:lens.focalLength,effective_focal_length_mm:lens.sensorWidth/(2*tx),principal_point_fraction:[.5+lens.principalX,.5+lens.principalY],framing:lens.framing,fit_widened:halfTan>requestedTan+1e-9,pixel_aspect:1,skew:0,distortion:'none; geometric pinhole'},
      stress,fit:stress?'stress extent and acquisition shift; see stress metadata':lens.framing==='lens'?'fixed physical lens; cropping allowed':'natural perspective fit: pull back if near-surface magnification exceeds 1.5x; fit body + lids + pills with 10% margin',bounds_world_mm:[bounds.min.toArray(),bounds.max.toArray()]};
    return cam;
  }

  update(dt) {
    let active = false;
    for (const d of this.drops) {
      if (d.done) continue;
      d.t += dt;
      const t = (d.t - d.delay) / .55;
      if (t < 0) { active = true; continue; }
      const tt = Math.min(1, t);
      // Fall with a small damped settle (no bouncing across wells).
      const fall = 1 - tt * tt;
      const settle = tt >= 1 ? 0 : Math.max(0, Math.sin(tt * Math.PI * 3.2) * Math.exp(-tt * 5) * .06) * (tt > .55 ? 1 : 0);
      d.pill.group.position.y = d.pill.rest.y + (26 + 0) * Math.max(0, fall) * (tt < 1 ? 1 : 0) + settle * 8;
      if (tt >= 1) { d.pill.group.position.copy(d.pill.rest); d.done = true; } else active = true;
    }
    for (const p of this.pills) active = p.update(dt) || active;
    return active;
  }

  setInspecting(on) {
    if (this.cover) this.cover.visible = !on;
    for(const sticker of this.stickers)if(sticker.userData.onCover)sticker.visible=!on;
  }

  finishAnimation() { for (const d of this.drops) { d.pill.group.position.copy(d.pill.rest); d.done = true; } }

  pillRecords() {
    return this.pills.map((pill) => {
      const s = pill.spec, pl = pill.placement;
      return {
        instance_id: pill.label.instance, semantic_id: pill.label.semantic, semantic: SEMANTIC[pill.label.semantic], family: familyOf(s), product_index: pl.product, well: pl.well,
        pose: { position_mm: pill.group.position.toArray().map((v) => +v.toFixed(3)), yaw_deg: +(pl.yaw * 180 / Math.PI).toFixed(2), flip_or_roll_deg: +(pl.flip * 180 / Math.PI).toFixed(2), face: s.kind === 'tablet' ? (pl.flip ? 'down' : 'up') : null, tilt_deg: +(pl.tilt*180/Math.PI).toFixed(2), stacked:pl.stacked, support:pl.support, region_kind:pl.region_kind, support_instances:pl.support_instances??[], clearance_mm:pl.clearance_mm },
        dimensions_mm: Object.fromEntries(Object.entries(pill.describe()).map(([k, v]) => [k, +v.toFixed(3)])),
        parameters: s,
        damage: pill.record.damage ?? null,
        physical_relief: pill.record.physicalRelief ?? null,
        surface_parameters: pill.record.surfaceParameters ?? null,
        optics: pill.record.optics ? { beer_lambert_coefficients_per_mm: pill.record.optics.coefficientsPerMm.map((v) => +v.toFixed(5)), reference_path_mm: 8 } : null,
      };
    });
  }

  dispose() {
    for (const p of this.pills) p.dispose();
    for (const d of this.disposables) d.dispose?.();
    this.group.traverse((o) => { if (o.isMesh && o.geometry && !o.userData.pill) o.geometry.dispose?.(); });
    this.group.parent?.remove(this.group);
  }
}
