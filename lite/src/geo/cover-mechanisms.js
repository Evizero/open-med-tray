import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Tray-local x/y plane, +z height, mm. Clear surfaces are excluded from pinhole ID labels.
export function mechanicalCover(p,c,rng,material,bodyMaterial) {
  const group=new THREE.Group(),panels=[],hinges=[];
  const thick=rng.uniform(.7,1.3);
  function panel(cx,cy,w,d,z,angle,side=1,hinged=true) {
    const pivot=new THREE.Group();pivot.position.set(cx,cy+side*d/2,z);
    pivot.rotation.x=-side*angle*Math.PI/180;
    const shell=new THREE.Mesh(new RoundedBoxGeometry(w,d,thick,2,Math.min(thick*.4,.5)),material);
    shell.position.set(0,-side*d/2,-thick/2);shell.renderOrder=2;shell.userData.noLabel=true;pivot.add(shell);
    // A molded edge and moving latch, not a rectangular reflection from disconnected walls.
    for(const sign of [-1,1]) {
      const edge=new THREE.Mesh(new RoundedBoxGeometry(w-.6,.85,.8,2,.25),material);
      edge.position.set(0,-side*d/2+sign*(d/2-.45),.35);edge.renderOrder=2;edge.userData.noLabel=true;pivot.add(edge);
    }
    const latch=new THREE.Mesh(new RoundedBoxGeometry(Math.min(12,w*.25),3.5,1.4,2,.5),material);
    latch.position.set(0,-side*(d+1.4),-.1);latch.renderOrder=2;latch.userData.noLabel=true;pivot.add(latch);
    group.add(pivot);
    if(hinged)for(const sign of [-1,1]) {
      const barrel=new THREE.Mesh(new THREE.CylinderGeometry(1.5,1.5,Math.min(8,w*.18),20),bodyMaterial);
      barrel.rotation.z=Math.PI/2;barrel.position.set(cx+sign*w*.32,cy+side*d/2,z-.5);
      barrel.castShadow=true;barrel.userData.label={instance:1,semantic:1,object:'stationary hinge'};hinges.push(barrel);
    }
    panels.push({center_mm:[cx,cy,z],size_mm:[w,d],angle_deg:angle,side,hinged});
  }
  if(c.cover==='individual_hinged') {
    for(const cell of p.cells)panel(cell.x,cell.y,cell.w+.7,cell.h+.7,p.height+1,c.lidAngle ?? (rng.chance(.42)?0:rng.uniform(115,172)),cell.row===0?1:-1);
  } else if(c.cover==='detached_lid') panel(rng.uniform(-18,18),p.depth+rng.uniform(4,14),p.width-1,p.depth-1,.7,rng.uniform(-5,5),1,false);
  else if(c.cover==='peeled_film') {
    const nx=130,ny=48,frac=c.peelFraction ?? rng.uniform(.12,.30),lift=c.peelLift ?? rng.uniform(6,22);
    const pos=[],uv=[],idx=[];
    for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++) {
      const u=i/nx,v=j/ny,t=Math.max(0,(u-(1-frac))/frac);
      pos.push((u-.5)*p.width,(v-.5)*(p.depth-.8),p.height+.4+lift*t*t+.35*Math.sin(u*28+v*7)*Math.sin(Math.PI*v)**2);uv.push(u,v);
    }
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const a=j*(nx+1)+i;idx.push(a,a+1,a+nx+2,a,a+nx+2,a+nx+1);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();
    const mesh=new THREE.Mesh(g,material);mesh.renderOrder=2;mesh.userData.noLabel=true;group.add(mesh);
    return {group,hinges,record:{kind:c.cover,peel_fraction:frac,peel_lift_mm:lift,thickness_mm:rng.uniform(.04,.07),label_policy:'transparent cover excluded from pinhole labels'}};
  } else {
    const angle=c.lidAngle ?? (c.cover==='hinged_closed'?0:c.cover==='hinged_partly'?rng.uniform(28,55):rng.uniform(112,160));
    panel(0,0,p.width-1,p.depth-1,p.height+1,angle);
  }
  return {group,hinges,record:{kind:c.cover,panels,thickness_mm:thick,label_policy:'transparent cover excluded from pinhole labels'}};
}
