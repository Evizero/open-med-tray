// World-space drafting. Drawn AFTER photographic refinement, using a fresh,
// unjittered depth prepass. Never added to the training/export scene.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { easeInOut } from '../util/rng.js';

export class SpecimenAnnotations {
  constructor() {
    this.target = new THREE.WebGLRenderTarget(1,1,{samples:4,depthBuffer:true});
    this.composite = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms:{map:{value:this.target.texture}},transparent:true,depthTest:false,depthWrite:false,toneMapped:false,
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:`uniform sampler2D map; varying vec2 vUv;
        void main(){vec4 c=texture2D(map,vUv);gl_FragColor=vec4(c.rgb/max(c.a,0.00001),c.a);
        #include <colorspace_fragment>
        }`
    }));
    this.scene = new THREE.Scene();
    this.depthScene = new THREE.Scene();
    this.depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
    this.ink = new THREE.LineBasicMaterial({ color: 0x514e48, transparent: true, opacity: .87, depthTest: true, depthWrite: false, toneMapped: false });
    this.extensionInk = this.ink.clone(); this.extensionInk.opacity = .42;
    // Direct-manipulation drafting (ui/handles.js drives stage.dimUI): the hot
    // dimension in accent, grips at its draggable ends, and a dashed guide
    // along the constraint axis while dragging. Same depth-tested MSAA pass.
    this.accentInk = new THREE.LineBasicMaterial({ color: 0x1b64be, transparent: true, opacity: .95, depthTest: true, depthWrite: false, toneMapped: false });
    this.guide = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)), new THREE.LineDashedMaterial({ color: 0x1b64be, transparent: true, opacity: .5, dashSize: 1, gapSize: 1, depthTest: true, depthWrite: false, toneMapped: false }));
    this.guide.frustumCulled = false; this.guide.visible = false;
    this.scene.add(this.guide);
    this.gripMaterials = Object.fromEntries(['idle', 'hot', 'active'].map((state) => [state, new THREE.SpriteMaterial({ map: gripTexture(state), depthTest: true, depthWrite: false, toneMapped: false, transparent: true })]));
    this.grips = [];
    this.slots = [];
    this.occluders = [];
    this.debug = { labels: [], frame: 0 };
    // Placed size dimensions, published for direct manipulation (ui/handles.js):
    // key L/W/H, world endpoints of the dimension line a -> b (b = +axis end).
    this.handles = [];
  }
  slot(index) {
    if (this.slots[index]) return this.slots[index];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(60), 3));
    const lines = new THREE.LineSegments(geometry, this.ink);
    lines.frustumCulled = false;
    const extensions = new THREE.LineSegments(geometry.clone(), this.extensionInk); extensions.frustumCulled = false;
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 64;
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: true, depthWrite: false, toneMapped: false }));
    this.scene.add(extensions, lines, sprite);
    return this.slots[index] = { lines, extensions, sprite, canvas, texture, text: null };
  }
  grip(index) {
    if (index >= 0) return this.grips[index];
    const g = new THREE.Sprite(this.gripMaterials.idle); g.renderOrder = 2; g.frustumCulled = false;
    this.scene.add(g); this.grips.push(g); return g;
  }
  render(stage, enabled = true) {
    this.debug = { labels: [], frame: this.debug.frame + 1 };
    this.handles = [];
    this.grips.forEach((g) => { g.visible = false; }); this.guide.visible = false;
    if (!enabled || stage.mode !== 'specimen' || !stage.pill || stage.section) return;
    const pill = stage.pill, camera = stage.camera, r = stage.renderer;
    pill.group.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const W = stage.cssW, H = stage.cssH, f = stage.free;
    const area = [f.x + 12, f.y + 12, f.x + f.w - 12, f.y + f.h - 24];
    const world = p => new THREE.Vector3(...p).applyMatrix4(pill.frame.matrixWorld);
    const screen = p => { const v = p.clone().project(camera); return [(v.x + 1) * W / 2, (1 - v.y) * H / 2, v.z]; };
    const mmPerPixel = p => 2 * Math.abs(p.clone().applyMatrix4(camera.matrixWorldInverse).z) * Math.tan(camera.fov * Math.PI / 360) / H;
    let d = pill.describe();
    if (pill.morph) { const b = pill.describe(pill.morph.target.dims, pill.morph.to), k = easeInOut(pill.morph.t); d = Object.fromEntries(Object.keys(d).map(key => [key, d[key] + (b[key] - d[key]) * k])); }
    const { L, W: width, H: height } = d;
    const off = Math.max(L, width) * .22, z = -height / 2 + .04;
    const eye = pill.frame.worldToLocal(camera.position.clone());
    // Hysteresis keeps drafting planes stable when the camera crosses an axis.
    if (!this.sx || Math.abs(eye.x) > L * .3) this.sx = eye.x >= 0 ? 1 : -1;
    if (!this.sy || Math.abs(eye.y) > width * .3) this.sy = eye.y >= 0 ? 1 : -1;
    const sx = this.sx, sy = this.sy, fmt = v => `${v.toFixed(v < 10 ? 2 : 1)} mm`;
    const round = pill.spec.kind==='tablet' && ['round','ring'].includes(pill.spec.outline);
    const rightLocal=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0).transformDirection(pill.frame.matrixWorld.clone().invert());
    rightLocal.z=0;rightLocal.normalize();
    const frontLocal=new THREE.Vector3(-rightLocal.y,rightLocal.x,0);
    if(screen(world(frontLocal.toArray()))[1]<screen(world([0,0,0]))[1])frontLocal.negate();
    const entries = [];
    entries.push({ key: 'L', text: (Math.abs(L - width) < .05 ? 'Ø ' : '') + fmt(L), points: [[-L/2,0,z],[L/2,0,z],[-L/2,sy*(width/2+off),z],[L/2,sy*(width/2+off),z]], label: [0,sy*(width/2+off*1.35),z] });
    if (Math.abs(L-width) > .05) entries.push({ key: 'W', text: fmt(width), points: [[0,-width/2,z],[0,width/2,z],[sx*(L/2+off),-width/2,z],[sx*(L/2+off),width/2,z]], label: [sx*(L/2+off*1.4),0,z] });
    if(Math.abs(eye.z)/eye.length()<.94) entries.push({ key: 'H', text: fmt(height), points: [[-sx*L/2,0,-height/2],[-sx*L/2,0,height/2],[-sx*(L/2+off),0,z],[-sx*(L/2+off),0,height/2]], label: [-sx*(L/2+off*1.5),0,0] });
    // Feature leaders live above the surface; hidden rear surfaces are occluded.
    const s = pill.spec, dm = pill.dims;
    if (!pill.morph) {
      const features = [];
      if (s.kind === 'tablet' && s.score?.count) features.push([[0,width*.3,height/2],`score ${s.score.width.toFixed(2)} × ${s.score.depth.toFixed(3)} mm`]);
      if (s.kind === 'tablet' && s.rimWidth > .05) features.push([[-L/2+dm.bevel+s.rimWidth/2,0,dm.zLand],`land ${s.rimWidth.toFixed(2)} mm`]);
      if (s.kind === 'capsule') features.push([[dm.xRim,0,dm.rc],`cap step ${dm.wall.toFixed(3)} mm`]);
      if (s.kind === 'softgel') features.push([[0,0,height/2],`seam ${s.seamWidth.toFixed(3)} mm`]);
      features.slice(0,2).forEach(([anchor,text],i) => { const tip = [(i ? -1 : 1)*L*.45,0,height/2+off*(i ? 2.6 : 1.5)]; entries.push({ text, points: [anchor,tip], label: tip, feature:true }); });
    }
    this.slots.forEach(q => { q.lines.visible = q.extensions.visible = q.sprite.visible = false; });
    const occupied = [];
    const projected=[];
    for(const x of [-L/2,L/2])for(const y of [-width/2,width/2])for(const z of [-height/2,height/2])projected.push(screen(world([x,y,z])));
    const pillBox=[Math.min(...projected.map(q=>q[0])),Math.min(...projected.map(q=>q[1])),Math.max(...projected.map(q=>q[0])),Math.max(...projected.map(q=>q[1]))];
    entries.forEach((entry, index) => {
      const slot = this.slot(index);
      const map = p => index===0 && round ? world([rightLocal.x*p[0]+frontLocal.x*p[1]*sy,rightLocal.y*p[0]+frontLocal.y*p[1]*sy,p[2]]) : world(p);
      let pts = entry.points.map(map), lp = map(entry.label), q = screen(lp), angle = 0;
      const unproject = (x,y,depth) => new THREE.Vector3(x/W*2-1,1-y/H*2,depth).unproject(camera);
      const ctx = slot.canvas.getContext('2d'); ctx.font = '500 26px "IBM Plex Mono", monospace';
      const labelWidth = (ctx.measureText(entry.text).width + 16)/2, labelHeight = 18;
      const textBox = (t,rotation=0) => {
        const a=Math.abs(Math.cos(rotation)),b=Math.abs(Math.sin(rotation));
        const hw=(labelWidth*a+labelHeight*b)/2,hh=(labelWidth*b+labelHeight*a)/2;
        return [t[0]-hw,t[1]-hh,t[0]+hw,t[1]+hh];
      };
      if(!entry.feature) {
        // Compact the drafting offset before dropping a dimension. Round
        // diameters have no preferred azimuth, so stay horizontal on screen.
        let fit=false;
        for(const factor of [1,.55,.18,0]) {
          const compact=p=>p.map((v,i)=>{const edge=[L/2,width/2,height/2][i];return Math.abs(v)>edge?Math.sign(v)*(edge+(Math.abs(v)-edge)*factor):v;});
          const candidate=entry.points.map(p=>map(compact(p))),hint=screen(map(compact(entry.label)));
          const a=screen(candidate[2]),b=screen(candidate[3]),dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
          if(len<16)continue;
          const mid=[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2];
          let nx=-dy/len,ny=dx/len;
          if(nx*(hint[0]-mid[0])+ny*(hint[1]-mid[1])<0){nx=-nx;ny=-ny;}
          const t=[mid[0]+nx*12,mid[1]+ny*12,mid[2]],label=unproject(...t);
          let rotation=Math.atan2(dy,dx);
          if(rotation>Math.PI/2)rotation-=Math.PI;if(rotation< -Math.PI/2)rotation+=Math.PI;
          const bounds=textBox(t,rotation);
          if(bounds[0]<area[0]||bounds[2]>area[2]||bounds[1]<area[1]||bounds[3]>area[3])continue;
          if(candidate.slice(2).some(p=>{const v=screen(p);return v[0]<area[0]||v[0]>area[2]||v[1]<area[1]||v[1]>area[3];}))continue;
          pts=candidate;lp=label;q=t;angle=rotation;fit=true;break;
        }
        if(!fit)return;
      }
      if(entry.feature) {
        // Leaders attach to geometry; billboard endpoints are laid out outside
        // its projected bounds, then unprojected onto the anchor's depth plane.
        const mid=(pillBox[0]+pillBox[2])/2;
        const candidates=[[mid,pillBox[1]-24],[pillBox[2]+labelWidth/2+18,(pillBox[1]+pillBox[3])/2],[pillBox[0]-labelWidth/2-18,(pillBox[1]+pillBox[3])/2],[mid,pillBox[3]+28],[mid,pillBox[1]-52]];
        const hit=candidates.find(([x,y])=>x-labelWidth/2>=area[0]&&x+labelWidth/2<=area[2]&&y-11>=area[1]&&y+11<=area[3]&&!occupied.some(b=>x-labelWidth/2<b[2]+8&&x+labelWidth/2>b[0]-8&&y-11<b[3]+8&&y+11>b[1]-8));
        if(!hit)return;
        const depth=screen(pts[0])[2];lp=new THREE.Vector3(hit[0]/W*2-1,1-hit[1]/H*2,depth).unproject(camera);pts[1]=lp;q=screen(lp);
      }
      const box = textBox(q,angle);
      const inBounds = box[0]>=area[0] && box[1]>=area[1] && box[2]<=area[2] && box[3]<=area[3] && q[2]>-1 && q[2]<1;
      const collision = occupied.some(b => box[0]<b[2]+8 && box[2]>b[0]-8 && box[1]<b[3]+8 && box[3]>b[1]-8);
      if (!inBounds || collision) return;
      if (!entry.feature && pts.slice(2).some(p => { const t=screen(p);return t[0]<area[0]||t[0]>area[2]||t[1]<area[1]||t[1]>area[3]||t[2]<-1||t[2]>1; })) return;
      if (!entry.feature && screen(pts[2]).slice(0,2).every((v,i)=>Math.abs(v-screen(pts[3])[i])<12)) return;
      occupied.push(box);
      if (slot.text !== entry.text) {
        ctx.clearRect(0,0,640,64);
        ctx.textAlign='center';ctx.textBaseline='middle';
        // A narrow paper-colored halo keeps lettering legible without a plate.
        ctx.strokeStyle='rgba(248,246,239,.7)';ctx.lineWidth=2;ctx.lineJoin='round';
        ctx.strokeText(entry.text,320,32);ctx.fillStyle='#353a3b';ctx.fillText(entry.text,320,32);
        slot.texture.needsUpdate=true;slot.text=entry.text;
      }
      const scale = mmPerPixel(lp);slot.sprite.position.copy(lp);slot.sprite.scale.set(320*scale,32*scale,1);
      slot.sprite.material.rotation = -angle;
      slot.sprite.visible = true;
      const ui = stage.dimUI, hot = !entry.feature && ui?.enabled?.() && (ui.active?.key ?? ui.hot) === entry.key;
      slot.lines.material = hot ? this.accentInk : this.ink;
      const segments = [],extensions = [];
      if(entry.feature) {
        // Short horizontal landing and an elbow, ending beside the lettering.
        const anchor=screen(pts[0]), side=anchor[0]<q[0] ? -1 : 1;
        const end=unproject(q[0]+side*(labelWidth/2+5),q[1],q[2]);
        const elbow=unproject(q[0]+side*(labelWidth/2+17),q[1],q[2]);
        segments.push(pts[0],elbow,elbow,end);
      } else {
        segments.push(pts[2],pts[3]);
        const sa=screen(pts[2]),sb=screen(pts[3]);
        const dx=sb[0]-sa[0],dy=sb[1]-sa[1],len=Math.hypot(dx,dy);
        const ux=dx/len,uy=dy/len;
        // Hot dimension: a second pass one pixel across reads as a 2 px accent line.
        if(hot)segments.push(unproject(sa[0]-uy,sa[1]+ux,sa[2]),unproject(sb[0]-uy,sb[1]+ux,sb[2]));
        // Oblique 45-degree architectural ticks, constant in screen pixels.
        const tx=(ux-uy)*2.8,ty=(uy+ux)*2.8;
        for(const p of pts.slice(2)) {
          const a=screen(p);
          segments.push(unproject(a[0]-tx,a[1]-ty,a[2]),unproject(a[0]+tx,a[1]+ty,a[2]));
        }
        for(let i=0;i<2;i++) {
          const a=screen(pts[i]),b=screen(pts[i+2]),dist=Math.hypot(b[0]-a[0],b[1]-a[1]);
          if(dist<4)continue;
          // Gapped witness lines stop beyond the dimension, without touching
          // the pill silhouette. Projective interpolation keeps them in 3D.
          const along=pixels=>{const t=pixels/dist;return unproject(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t);};
          extensions.push(along(4),along(dist+5));
        }
      }
      for(const [mesh,vertices] of [[slot.lines,segments],[slot.extensions,extensions]]) {
        const a=mesh.geometry.attributes.position;vertices.forEach((p,i)=>a.setXYZ(i,p.x,p.y,p.z));
        a.needsUpdate=true;mesh.geometry.setDrawRange(0,vertices.length);mesh.visible=vertices.length>0;
      }
      this.debug.labels.push({ text:entry.text, box, world:lp.toArray(), feature:!!entry.feature, angle });
      if (!entry.feature) {
        // Usable for dragging only if the axis is not seen nearly end-on.
        const sa=screen(pts[2]),sb=screen(pts[3]),span=pts[2].distanceTo(pts[3]);
        const ratio=Math.hypot(sb[0]-sa[0],sb[1]-sa[1])*mmPerPixel(pts[3])/Math.max(span,1e-6);
        const handle={ key: entry.key, a: pts[2].clone(), b: pts[3].clone(), box, usable: ratio>=.3, ends: entry.key==='H'?[1]:[-1,1] };
        this.handles.push(handle);
        const ui = stage.dimUI;
        if (handle.usable && ui?.enabled?.()) for (const end of handle.ends) {
          const active = ui.active?.key === entry.key && ui.active.end === end;
          const state = active ? 'active' : (ui.active?.key ?? ui.hot) === entry.key ? 'hot' : 'idle';
          const g = this.grip(this.grips.findIndex((x) => !x.visible)), p = end > 0 ? pts[3] : pts[2], px = state === 'idle' ? 8 : 11, k = mmPerPixel(p) * px;
          g.material = this.gripMaterials[state]; g.position.copy(p); g.scale.set(k, k, 1); g.visible = true;
        }
        if (ui?.enabled?.() && ui.active?.key === entry.key) {
          // Constraint guide: the drag axis, extended past both ends, dashes constant on screen.
          const A=pts[3].clone().sub(pts[2]).normalize(), ext=Math.max(L,width)*.7, g=this.guide, a=g.geometry.attributes.position;
          const p0=pts[2].clone().addScaledVector(A,-ext), p1=pts[3].clone().addScaledVector(A,ext);
          a.setXYZ(0,p0.x,p0.y,p0.z);a.setXYZ(1,p1.x,p1.y,p1.z);a.needsUpdate=true;g.computeLineDistances();
          const u=mmPerPixel(pts[3]);g.material.dashSize=u*3;g.material.gapSize=u*4;g.visible=true;
        }
      }
    });
    // Reuse proxy meshes; borrow live geometry without taking ownership.
    pill.meshes.forEach((mesh,i)=>{
      if(!this.occluders[i]) { this.occluders[i]=new THREE.Mesh(mesh.geometry,this.depthMaterial);this.occluders[i].matrixAutoUpdate=false;this.depthScene.add(this.occluders[i]); }
      const proxy=this.occluders[i];proxy.geometry=mesh.geometry;proxy.matrix.copy(mesh.matrixWorld);proxy.visible=mesh.visible;
    });
    this.occluders.forEach((m,i)=>{if(i>=pill.meshes.length)m.visible=false;});
    const saved={auto:r.autoClear,target:r.getRenderTarget(),shadow:r.shadowMap.enabled,color:r.getClearColor(new THREE.Color()),alpha:r.getClearAlpha()};
    if(this.target.width!==stage.pipe.width||this.target.height!==stage.pipe.height)this.target.setSize(stage.pipe.width,stage.pipe.height);
    try {
      r.setRenderTarget(this.target);r.autoClear=false;r.shadowMap.enabled=false;r.setClearColor(0x000000,0);r.clear();
      r.render(this.depthScene,camera);r.render(this.scene,camera);
      r.setRenderTarget(null);this.composite.render(r);
    } finally {r.autoClear=saved.auto;r.shadowMap.enabled=saved.shadow;r.setRenderTarget(saved.target);r.setClearColor(saved.color,saved.alpha);}
  }
}

// Grip: a small paper disc with an ink ring (idle), accent ring (hot) or an
// accent disc (active). Drawn at a constant screen size by the caller.
function gripTexture(state) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const ring = state === 'idle' ? 9 : 8.5;
  x.beginPath(); x.arc(32, 32, 30 - ring / 2, 0, Math.PI * 2);
  x.fillStyle = state === 'active' ? '#1b64be' : '#fbfaf6'; x.fill();
  x.lineWidth = ring; x.strokeStyle = state === 'idle' ? '#514e48' : '#1b64be'; x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
