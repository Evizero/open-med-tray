// The live 3D stage: studio (specimen) and tray scenes, cameras, controls, the
// render loop with idle stop, crossfades and section-plane transitions.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SpecimenAnnotations } from '../render/annotations.js';
import { Pipeline } from '../render/pipeline.js';
import { LightRig, LIGHTING } from '../render/lighting.js';
import { stoneSweep } from '../render/surfaces.js';
import { Pill } from '../scene/pill.js';
import { TrayScene } from '../scene/trayscene.js';
import { easeInOut, easeOut, clamp } from '../util/rng.js';

const tmpV = new THREE.Vector3();

export class Stage {
  constructor(canvas, { mobile, reducedMotion, legacySampling = false }) {
    this.canvas = canvas;
    this.mobile = mobile;
    this.reducedMotion = reducedMotion;
    this.pipe = new Pipeline(canvas, { mobile });
    this.renderer = this.pipe.renderer;
    this.annotations = new SpecimenAnnotations();
    // legacySampling (QA only, ?legacy-sampling): the pre-fix behaviour — one
    // key light jittered over the whole emitter, no settle interval, no DOF ramp.
    this.rig = new LightRig(this.renderer, { keys: legacySampling ? 1 : mobile ? 2 : 4, shadowSize: mobile ? 1024 : 2048 });
    this.pipe.jitterLights = [this.rig];
    if (legacySampling) { this.pipe.settleMs = 0; this.pipe.dofRamp = false; }
    this.mode = 'specimen';
    this.animations = new Set();
    this.listeners = {};
    this.running = false;
    this.visible = !document.hidden;
    this.last = performance.now();
    this.lastInteraction = 0;
    this.cameraMoving = false;

    // Studio scene
    this.studio = new THREE.Scene();
    this.studio.background = new THREE.Color().setRGB(.2, .185, .165);
    this.sweep = stoneSweep();
    this.studio.add(this.sweep);
    this.studio.add(this.rig.group);
    // A soft pool of light on the stone around the specimen (no shadow; the key casts those).
    this.pool = new THREE.SpotLight(0xfff4e6, 0, 0, THREE.MathUtils.degToRad(16), 1, 0);
    this.pool.position.set(-40, 260, 120);
    this.studio.add(this.pool, this.pool.target);
    this.studioCam = new THREE.PerspectiveCamera(22, 1, 2, 3000);
    this.pill = null;

    // Tray scene (built on demand)
    this.trayWorld = new THREE.Scene();
    this.trayWorld.background = new THREE.Color().setRGB(.12, .115, .105);
    this.trayCam = new THREE.PerspectiveCamera(40, 1, 5, 3000);
    this.tray = null;
    this.trayView = 'capture'; // 'capture' | 'orbit' | 'pill'

    this.controls = new OrbitControls(this.studioCam, canvas);
    this.controls.enableDamping = !reducedMotion;
    this.controls.dampingFactor = .085;
    this.controls.rotateSpeed = .6;
    this.controls.zoomSpeed = .8;
    this.controls.enablePan = false;
    this.controls.addEventListener('start', () => { this.pipe.dof.enabled = false; this.pipe.dof.focus = this.camera.position.distanceTo(this.controls.target); this.cameraMoving = true; this.emit('interact'); this.wake(); });
    this.controls.addEventListener('change', () => { this.pipe.dof.focus = this.camera.position.distanceTo(this.controls.target); this.pipe.reset(); this.wake(); });
    this.controls.addEventListener('end', () => { this.cameraMoving = false; this.wake(); });

    document.addEventListener('visibilitychange', () => { this.visible = !document.hidden; if (this.visible) this.wake(); });
    this.section = null;
  }

  on(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name, ...a) { for (const fn of this.listeners[name] || []) fn(...a); }

  get camera() { return this.mode === 'specimen' ? this.studioCam : this.trayCam; }
  get scene() { return this.mode === 'specimen' ? this.studio : this.trayWorld; }

  // UI insets (css px) on all four sides. The subject is centred in the free
  // area: a positive view offset moves content left/up, so a left inset (rail
  // and panel) shifts by (right - left) / 2 and a bottom inset by (bottom - top) / 2.
  setInsets({ top = 0, right = 0, bottom = 0, left = 0 }) {
    this.insets = { top, right, bottom, left };
    this.pipe.baseShift = [(right - left) / 2 / (this.cssW || 1), (bottom - top) / 2 / (this.cssH || 1)];
    this.pipe.applyBaseShift(this.studioCam); this.pipe.applyBaseShift(this.trayCam);
    this.updateTrayCamera();
    this.pipe.reset(); this.wake();
  }

  // Free viewport area (css px) not covered by UI.
  get free() { const i = this.insets || { top: 0, right: 0, bottom: 0, left: 0 }; return { x: i.left || 0, y: i.top, w: this.cssW - (i.left || 0) - i.right, h: this.cssH - i.top - i.bottom }; }

  resize(w, h) {
    this.cssW = w; this.cssH = h;
    this.pipe.resize(w, h);
    if (this.insets) this.pipe.baseShift = [(this.insets.right - (this.insets.left || 0)) / 2 / w, (this.insets.bottom - this.insets.top) / 2 / h];
    this.studioCam.aspect = w / h; this.studioCam.updateProjectionMatrix();
    this.updateTrayCamera();
    this.wake();
  }

  // ------------------------------------------------------------ loop
  wake() {
    if (this.running || !this.visible || this.busyExport) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // Redraw only the drafting overlay (hover feedback) over the current
  // accumulated image: no new sample, no accumulation restart. If the loop is
  // running, its next frame draws it anyway.
  requestOverlay() {
    if (this.running || this._overlayQueued || !this.visible || this.busyExport) return;
    this._overlayQueued = true;
    requestAnimationFrame(() => {
      this._overlayQueued = false;
      if (this.running || !this.pipe.samples || this.busyExport) return;
      this.pipe._output(null, this.pipe.width, this.pipe.height, this.pipe.accum[this.pipe.accumIndex]);
      this.annotations.render(this, this.annotationsEnabled?.() ?? true);
    });
  }

  animate(fn) {
    // fn(dt) -> true while running
    this.animations.add(fn);
    this.pipe.reset();
    this.wake();
    return () => this.animations.delete(fn);
  }

  frame(t) {
    if (!this.visible || this.busyExport) { this.running = false; return; }
    const dt = Math.max(0, Math.min(.05, (t - this.last) / 1000));
    this.last = t;
    let active = false;
    for (const fn of [...this.animations]) { if (fn(dt)) active = true; else this.animations.delete(fn); }
    if (this.pill && this.pill.update(dt)) active = true;
    if (this.mode === 'tray' && this.tray && this.tray.update(dt)) active = true;
    const damping = this.controls.enabled && this.controls.update();
    if (damping) active = true;
    if (this.section) active = true;
    const busy = active || this.cameraMoving || this.pipe.fade < 1;
    if (busy) this.pipe.reset();
    // Interactive frame after every change; refinement only once input is quiet.
    if (this.pipe.samples === 0 || (this.pipe.canRefine && !this.pipe.converged)) {
      this.pipe.setSceneIfNeeded(this.scene, this.camera);
      this.pipe.renderSample();
      this.annotations.render(this, this.annotationsEnabled?.() ?? true);
      this.emit('frame', { busy, samples: this.pipe.samples });
    }
    if (busy || !this.pipe.converged) requestAnimationFrame((tt) => this.frame(tt));
    else { this.running = false; this.emit('idle'); }
  }

  // ------------------------------------------------------------ specimen
  // Frame the specimen (its morph target while morphing) in the free area.
  // `keepDirection` keeps the user's orbit direction and only refits the
  // distance; the default direction is the studio three-quarter view. If an
  // annotation fit hook is installed (main.js), the distance is widened so
  // the dimension lines and callouts fit too.
  specimenFrame(pill, { instant = false, macro = false, keepDirection = false, hold = false, resume = false } = {}) {
    const tg = pill.target;
    const d = pill.describe(tg.dims, tg.spec), rest = pill.restHeightOf(tg.dims, tg.spec);
    const size = Math.max(d.L, d.W, d.H * 1.45);
    const target = new THREE.Vector3(0, rest * .55, 0);
    // Fit the specimen into the free area using both FOVs (portrait phones are
    // limited by the narrow horizontal FOV); it spans ~55% of the free width.
    const f = this.free, cam = this.studioCam;
    const tv = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2), th = tv * this.cssW / this.cssH;
    const distV = size * 1.25 / (2 * tv * (f.h / this.cssH));
    const distH = size * 1.8 / (2 * th * (f.w / this.cssW));
    let dist = Math.max(distV, distH);
    const az = THREE.MathUtils.degToRad(-28), el = THREE.MathUtils.degToRad(27);
    let dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    if (keepDirection && this._framed) { const cur = this.studioCam.position.clone().sub(this.controls.target); if (cur.lengthSq() > 1e-6) dir = cur.normalize(); }
    this.controls.minDistance = size * 1.4;
    this.controls.maxDistance = size * 12;
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
    this.controls.minPolarAngle = THREE.MathUtils.degToRad(4);
    if (this.annotationFit) {
      // Measure the projected specimen + annotation extents at the candidate
      // pose and widen the distance until they fit (two passes; the second
      // corrects perspective residuals). The camera is restored afterwards.
      const savePos = cam.position.clone(), saveQ = cam.quaternion.clone();
      for (let i = 0; i < 2; i++) {
        cam.position.copy(target).addScaledVector(dir, dist); cam.lookAt(target); cam.updateMatrixWorld(true);
        const k = this.annotationFit(pill, tg, rest);
        if (!(k > 1.001)) break;
        dist = Math.min(dist * k, this.controls.maxDistance);
      }
      cam.position.copy(savePos); cam.quaternion.copy(saveQ); cam.updateMatrixWorld(true);
    }
    const end = target.clone().addScaledVector(dir, dist);
    this.pipe.dof.focus = dist;
    this.pipe.dof.aperture = size * .018;
    this._framed = true;
    if (instant || this.reducedMotion) {
      this.studioCam.position.copy(end); this.controls.target.copy(target); this.controls.update();
      return Promise.resolve();
    }
    // Keep the entire near plane outside a conservative specimen sphere.
    // A modest orbit/pullback starts with a readable object, never inside it.
    const clearance = Math.hypot(d.L,d.W,d.H)/2 + rest + cam.near + size*.2;
    const introDistance = Math.max(dist*.78, clearance);
    const introDir = new THREE.Vector3(Math.sin(az+.35)*Math.cos(el+.08),Math.sin(el+.08),Math.cos(az+.35)*Math.cos(el+.08));
    // `resume` flies the macro curve from wherever the camera is now.
    const start = macro && !resume ? target.clone().addScaledVector(introDir,introDistance) : this.studioCam.position.clone();
    const t0 = macro && !resume ? target.clone() : this.controls.target.clone();
    // `hold` parks the camera on the pull-back's first pose (main.js keeps it
    // there under the introduction sheet, then resumes from wherever it is).
    if (hold && macro) {
      this.studioCam.position.copy(start); this.controls.target.copy(t0); this.studioCam.lookAt(t0);
      this.pipe.dof.focus = start.distanceTo(t0); this.pipe.reset(); this.wake();
      return Promise.resolve();
    }
    return this.flyCamera(this.studioCam, start, t0, end, target, macro ? 3.4 : 1.1, macro ? 'macro' : 'ease');
  }

  flyCamera(cam, p0, t0, p1, t1, duration, curve = 'ease') {
    this.cancelFlight?.();
    return new Promise((resolve) => {
      let t = 0;
      this.controls.enabled = false;
      const pa = p0.clone(), ta = t0.clone();
      const cancel = this.animate((dt) => {
        t = Math.min(1, t + dt / duration);
        const k = curve === 'macro' ? easeInOut(Math.pow(t, .85)) : easeInOut(t);
        // Arc slightly upward: a crane, not a zoom.
        cam.position.lerpVectors(pa, p1, k);
        cam.position.y += Math.sin(k * Math.PI) * p1.distanceTo(pa) * .08;
        this.controls.target.lerpVectors(ta, t1, k);
        cam.lookAt(this.controls.target);
        if (this.mode === 'specimen') this.pipe.dof.focus = cam.position.distanceTo(this.controls.target);
        if (t >= 1) { this.cancelFlight = null; this.controls.enabled = true; this.controls.update(); resolve(); return false; }
        return true;
      });
      this.cancelFlight = () => { cancel(); this.cancelFlight = null; resolve(); };
    });
  }

  setSpecimen(spec, { transition = 'auto', frame = true } = {}) {
    // A newer preset or sample can arrive before the section sweep finishes.
    // Complete that swap and release its resources before starting another.
    this.section?.finish();
    if (!this.pill) {
      this.pill = new Pill(spec, { lod: 'hero', instance: 1, semantic: 3 });
      this.placeHero(this.pill);
      this.studio.add(this.pill.group);
      this.lightStudio();
      this.emit('pill', this.pill);
      return Promise.resolve();
    }
    if (transition !== 'section' && this.pill.morphTo(spec, this.reducedMotion ? .01 : .75)) {
      this.pipe.reset(); this.wake();
      const p = this.pill, morph = p.morph;
      morph.endPosition = new THREE.Vector3(0, p.restHeightOf(morph.target.dims, morph.to), 0);
      // Refit the distance for the morph target (orbit direction kept) so a
      // larger preset never lands outside the frame.
      if (frame) this.specimenFrame(p, { keepDirection: true });
      return new Promise((res) => { const check = () => { if (p.morph !== morph) { if (!p.morph) this.emit('pill', p); res(); return false; } return true; }; this.animate(check); });
    }
    return this.sectionSwap(spec, frame);
  }

  placeHero(pill) {
    pill.group.position.set(0, pill.restHeight, 0);
    pill.group.rotation.set(0, THREE.MathUtils.degToRad(-32), 0, 'YXZ');
    pill.group.updateMatrixWorld(true);
  }

  groundHero(pill = this.pill) {
    // Ground the rendered vertices, including asymmetric shells and damage.
    // Editing changes shape around its centre; update translation in that frame.
    pill.group.updateMatrixWorld(true);
    let bottom = Infinity;
    for (const mesh of pill.meshes) {
      const a=mesh.geometry.attributes.position, e=mesh.matrixWorld.elements;
      for(let i=0;i<a.count;i++) bottom=Math.min(bottom,e[1]*a.getX(i)+e[5]*a.getY(i)+e[9]*a.getZ(i)+e[13]);
    }
    if(Number.isFinite(bottom))pill.group.position.y-=bottom;
    pill.group.updateMatrixWorld(true);
  }

  lightStudio() {
    // One studio rig for the supported specimen range: changing presets must
    // not refit the shadow map or resize the light pool on the final frame.
    const ext = 24;
    this.rig.apply(this.studio, 'studio', { center: new THREE.Vector3(0, 0, 0), extent: ext, shadowSize: this.mobile ? 1024 : 2048 });
    this.pipe.setAO({ radius: 6, intensity: .75 });
    this.pipe.exposure = LIGHTING.studio.exposure;
    this.pool.intensity = 1.4;
    this.pool.angle = Math.min(.6, Math.atan(ext * 3.2 / 290));
  }

  // Topology change: a technical section plane sweeps through the specimen.
  sectionSwap(spec, frame) {
    const old = this.pill;
    const next = new Pill(spec, { lod: 'hero', instance: 1, semantic: 3 });
    this.placeHero(next);
    this.studio.add(next.group);
    const cam = this.studioCam;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0); right.y = 0; right.normalize();
    const R = Math.max(old.describe().L, next.describe().L) * .62 + 1;
    const pOld = new THREE.Plane(right.clone(), 0), pNew = new THREE.Plane(right.clone().negate(), 0);
    old.setClipping([pOld], true, old.spec.kind === 'tablet' ? [.83, .81, .76] : [.7, .66, .6]);
    next.setClipping([pNew], true, next.spec.kind === 'tablet' ? [.83, .81, .76] : [.7, .66, .6]);
    // Section frame: thin accent rectangle in the cutting plane.
    const h = Math.max(old.describe().H, next.describe().H) * 1.6 + 2, w = Math.max(old.describe().W, next.describe().W) * 1.3 + 2;
    const pts = [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h], [-w / 2, 0]].map(([a, b]) => new THREE.Vector3(0, b, a));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: new THREE.Color(0x1b64be), transparent: true, opacity: .9 }));
    line.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), right);
    this.studio.add(line);
    const dur = this.reducedMotion ? .01 : 1.05;
    let t = 0;
    // Reframe during the sweep so a larger specimen never overflows the view.
    if (frame) this.specimenFrame(next, { keepDirection: true });
    return new Promise((resolve) => {
      let cancel;
      const finish = () => {
        cancel?.();
        old.dispose();
        next.setClipping(null);
        this.studio.remove(line); line.geometry.dispose(); line.material.dispose();
        this.pill = next;
        this.section = null;
        this.lightStudio();
        this.emit('pill', next);
        resolve();
      };
      this.section = { old, next, finish };
      cancel = this.animate((dt) => {
        t = Math.min(1, t + dt / dur);
        const k = easeInOut(t);
        const s = -R + 2 * R * k;
        pOld.constant = -s; pNew.constant = s;
        line.position.copy(right).multiplyScalar(s);
        line.material.opacity = Math.sin(Math.PI * Math.min(1, t * 1.1)) * .9;
        if (t >= 1) {
          finish();
          return false;
        }
        return true;
      });
    });
  }

  // ------------------------------------------------------------ tray
  buildTray(config, { animate = true, products = null } = {}) {
    if (this.tray) this.tray.dispose();
    this.tray = new TrayScene(config, { animate: animate && !this.reducedMotion, productsOverride: products });
    this.trayWorld.add(this.tray.group);
    if (!this.trayWorld.children.includes(this.rig.group)) this.trayWorld.add(this.rig.group);
    this.applyTrayLighting();
    this.updateTrayCamera();
    this.pipe.reset(); this.wake();
    return this.tray;
  }

  applyTrayLighting() {
    const t = this.tray, p = t.params;
    const side = (t.config.seed & 1) ? 1 : -1;
    this.rig.apply(this.trayWorld, t.config.lighting, { center: new THREE.Vector3(0, p.height * .5, 0), extent: p.width * .62, side, seed:t.config.seed, widthMM:p.width, depthMM:p.depth, shadowSize: this.mobile ? 1024 : 2048 });
    t.meta.lighting_parameters=structuredClone(this.rig.record);
    this.pipe.setAO({ radius: 5, intensity: .7 });
    this.pipe.exposure = LIGHTING[t.config.lighting]?.exposure ?? 1;
  }

  // The 2:1 capture frame is letterboxed inside the viewport (never stretched).
  captureFrameRect() {
    const f = this.free, a = f.w / f.h, A = 2;
    const pad = this.cssW < 700 ? .96 : .88;
    let fw, fh;
    if (a > A) { fh = f.h * pad; fw = fh * A; } else { fw = f.w * pad; fh = fw / A; }
    return { x: f.x + (f.w - fw) / 2, y: f.y + (f.h - fh) / 2, w: fw, h: fh };
  }

  updateTrayCamera() {
    if (!this.tray || this.trayView !== 'capture') return;
    const cap = this.tray.captureCamera(2);
    this.capture = cap;
    const rect = this.captureFrameRect();
    const captureShift=cap.userData.captureShift??[0,0];
    this.trayCam.userData.captureShift=[captureShift[0]*rect.w/this.cssW,captureShift[1]*rect.h/this.cssH];
    // Same pose; widen the frustum so the capture frame maps exactly to `rect`.
    const tanV = Math.tan(THREE.MathUtils.degToRad(cap.fov) / 2);
    const tanVView = tanV * this.cssH / rect.h;
    this.trayCam.position.copy(cap.position); this.trayCam.quaternion.copy(cap.quaternion); this.trayCam.up.copy(cap.up);
    this.trayCam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanVView));
    this.trayCam.aspect = this.cssW / this.cssH;
    this.trayCam.updateProjectionMatrix();
    this.trayCam.updateMatrixWorld();
    this.pipe.dof.enabled = false;
    this.pipe.reset(); this.wake();
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.cancelFlight?.();
    this.pipe.beginCrossfade(this.reducedMotion ? 0 : .7);
    this.mode = mode;
    this.controls.object = this.camera;
    if (mode === 'specimen') {
      if (!this.studio.children.includes(this.rig.group)) this.studio.add(this.rig.group);
      this.controls.enabled = true;
      this.controls.enableRotate = true; this.controls.enableZoom = true;
      this.pipe.dof.enabled = false;
      this.lightStudio();
      this.specimenFrame(this.pill, { instant: true });
    } else {
      if (!this.trayWorld.children.includes(this.rig.group)) this.trayWorld.add(this.rig.group);
      this.pipe.dof.enabled = false;
      if (this.tray) this.applyTrayLighting();
      this.setTrayView('capture');
    }
    this.pipe.reset(); this.wake();
    this.emit('mode', mode);
  }

  setTrayView(view, pill = null) {
    this.cancelFlight?.();
    const cam=this.trayCam, from=cam.clone();
    this.trayView=view;
    if(this.tray)this.tray.setInspecting(view==='pill');
    this.controls.enabled=false;
    this.pipe.dof.enabled=false;
    let to,target=null;
    if(view==='capture') {
      this.updateTrayCamera();to=cam.clone();cam.copy(from);
    } else {
      target=pill?pill.group.position.clone():new THREE.Vector3(0,this.tray.params.height*.4,0);
      const size=pill?Math.max(...pill.footprint):this.tray.params.width;
      const dist=pill?size*5:size*1.25;
      to=from.clone();to.userData.captureShift=[0,0];to.fov=pill?24:34;to.aspect=this.cssW/this.cssH;to.up.set(0,1,0);
      to.position.copy(target).addScaledVector(new THREE.Vector3(.18,1.05,.82).normalize(),dist);to.lookAt(target);to.updateProjectionMatrix();
      this.controls.object=cam;
      // Flush residual orbit damping without exposing the temporary pose.
      const damping=this.controls.enableDamping;this.controls.enableDamping=false;this.controls.update();this.controls.enableDamping=damping;cam.copy(from);
      this.controls.minDistance=pill?size*1.6:size*.5;this.controls.maxDistance=pill?size*14:size*3;
      this.controls.maxPolarAngle=THREE.MathUtils.degToRad(80);this.controls.minPolarAngle=0;
      this.pipe.dof.aperture=pill?size*.02:0;this.pipe.dof.focus=dist;
    }
    const finish=()=>{
      cam.copy(to);this.pipe.applyBaseShift(cam);cam.updateMatrixWorld(true);
      this.controls.enabled=view!=='capture';
      if(target){this.controls.target.copy(target);this.controls.update();}
      this.cancelFlight=null;
    };
    if(this.reducedMotion || (view==='capture'&&!this._trayViewInit))finish();
    else {
      const shift0=from.userData.captureShift??[0,0],shift1=to.userData.captureShift??[0,0];
      let t=0;
      const cancel=this.animate(dt=>{
        t=Math.min(1,t+dt/(view==='capture'?.9:1.1));const k=easeInOut(t);
        cam.position.lerpVectors(from.position,to.position,k);
        cam.quaternion.slerpQuaternions(from.quaternion,to.quaternion,k);
        cam.up.lerpVectors(from.up,to.up,k).normalize();
        cam.fov=from.fov+(to.fov-from.fov)*k;
        cam.userData.captureShift=shift0.map((v,i)=>v+(shift1[i]-v)*k);
        cam.updateProjectionMatrix();this.pipe.applyBaseShift(cam);cam.updateMatrixWorld(true);
        if(target)this.pipe.dof.focus=cam.position.distanceTo(target);
        if(t>=1){finish();return false;}return true;
      });
      this.cancelFlight=()=>{cancel();this.cancelFlight=null;};
      // Keep pose AND projection identical until the first animation tick.
      cam.copy(from);this.pipe.applyBaseShift(cam);cam.updateMatrixWorld(true);
    }
    this._trayViewInit=true;
    this.pipe.reset();this.wake();this.emit('trayview',view,pill);
  }

  pick(clientX, clientY) {
    if (this.mode !== 'tray' || !this.tray) return null;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2((clientX - r.left) / r.width * 2 - 1, -(clientY - r.top) / r.height * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.trayCam);
    const meshes = this.tray.pills.flatMap((p) => p.meshes);
    const hit = ray.intersectObjects(meshes, false)[0];
    return hit ? hit.object.userData.pill : null;
  }

  project(v) {
    tmpV.copy(v).project(this.camera);
    return [(tmpV.x * .5 + .5) * this.cssW, (-tmpV.y * .5 + .5) * this.cssH, tmpV.z];
  }
}

// Pipeline helpers that need scene awareness.
Pipeline.prototype.setSceneIfNeeded = function (scene, camera) {
  if (this.scene !== scene) this.setScene(scene, camera);
  else if (this.camera !== camera) { this.camera = camera; if (this.gtao) this.gtao.camera = camera; }
};
Pipeline.prototype.fade = 1;
Pipeline.prototype.beginCrossfade = function (duration) {
  if (duration <= 0) { this.fade = 1; return; }
  if (!this.fadeRT) this.fadeRT = new THREE.WebGLRenderTarget(this.width, this.height, { type: THREE.HalfFloatType, depthBuffer: false });
  this.fadeRT.setSize(this.width, this.height);
  const src = this.accum[this.accumIndex];
  this.accumMat.uniforms.tNew.value = src.texture; this.accumMat.uniforms.tOld.value = src.texture; this.accumMat.uniforms.uWeight.value = 1;
  this.quad.material = this.accumMat;
  this.renderer.setRenderTarget(this.fadeRT); this.quad.render(this.renderer);
  this.fade = 0; this.fadeDuration = duration; this.fadeStart = performance.now();
};
