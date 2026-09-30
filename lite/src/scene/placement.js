// Constrained visible geometry placement, matching Blender placement_v46's
// projected convex-hull fit and conservative height-supported fallback.
import * as THREE from 'three';
export function convexHull(points) {
  const seen=new Set(),p=[];
  for(const q of points){const k=`${Math.round(q[0]*1e6)},${Math.round(q[1]*1e6)}`;if(!seen.has(k)){seen.add(k);p.push(q);}}
  p.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  if(p.length<3)throw new Error('Degenerate pill footprint');
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const lo=[],hi=[];
  for(const q of p){while(lo.length>=2&&cross(lo.at(-2),lo.at(-1),q)<=0)lo.pop();lo.push(q);}
  for(let i=p.length-1;i>=0;i--){const q=p[i];while(hi.length>=2&&cross(hi.at(-2),hi.at(-1),q)<=0)hi.pop();hi.push(q);}
  lo.pop();hi.pop();return [...lo,...hi];
}
export function separated(a,b,clearance=0) {
  for(const poly of [a,b])for(let i=0;i<poly.length;i++) {
    const p=poly[i],q=poly[(i+1)%poly.length],len=Math.hypot(q[0]-p[0],q[1]-p[1]);
    const nx=(p[1]-q[1])/len,ny=(q[0]-p[0])/len;
    let alo=Infinity,ahi=-Infinity,blo=Infinity,bhi=-Infinity;
    for(const v of a){const d=v[0]*nx+v[1]*ny;alo=Math.min(alo,d);ahi=Math.max(ahi,d);}
    for(const v of b){const d=v[0]*nx+v[1]*ny;blo=Math.min(blo,d);bhi=Math.max(bhi,d);}
    if(ahi+clearance<blo||bhi+clearance<alo)return true;
  }
  return false;
}
export function projectedPill(pill) {
  pill.group.updateMatrixWorld(true);
  const pts=[],v=new THREE.Vector3();let bottom=Infinity,top=-Infinity;
  for(const mesh of pill.meshes) {
    const pos=mesh.geometry.attributes.position;
    for(let i=0;i<pos.count;i++) {
      v.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);
      pts.push([v.x,-v.z]);bottom=Math.min(bottom,v.y);top=Math.max(top,v.y);
    }
  }
  const hull=convexHull(pts);
  return {hull,bottom,top,min:[Math.min(...hull.map(p=>p[0])),Math.min(...hull.map(p=>p[1]))],max:[Math.max(...hull.map(p=>p[0])),Math.max(...hull.map(p=>p[1]))]};
}
export function floorBounds(p,well) {
  if(well.bounds)return well.bounds;
  const draft=well.draft??Math.min(p.draft,well.w*.1,well.h*.1),margin=draft+.5+(p.removable?1.5:0);
  return {cx:well.x,cy:well.y,round:!!p.round,R:well.w/2-margin,x0:well.x-well.w/2+margin,x1:well.x+well.w/2-margin,y0:well.y-well.h/2+margin,y1:well.y+well.h/2-margin,corner:Math.max(0,(p.wellCorner??4)-margin)};
}
export function insidePoint(b,x,y) {
  if(b.round)return Math.hypot(x-b.cx,y-b.cy)<=b.R+1e-8;
  if(x<b.x0-1e-8||x>b.x1+1e-8||y<b.y0-1e-8||y>b.y1+1e-8)return false;
  const r=b.corner??0;if(!r)return true;
  const dx=Math.max(b.x0+r-x,0,x-(b.x1-r)),dy=Math.max(b.y0+r-y,0,y-(b.y1-r));
  return dx*dx+dy*dy<=r*r+1e-8;
}
export function supportRegions(p,tableY,spillFraction=0) {
  const regions=p.cells.map((cell,index)=>({...cell,index,kind:'tray',floor:cell.floorZ??p.floorZ,bounds:floorBounds(p,cell)}));
  if(spillFraction>0) {
    const w=p.width/2,d=p.depth/2,g=5,r=55;
    for(const [x0,x1,y0,y1] of [[-w-r,-w-g,-d,d],[w+g,w+r,-d,d],[-w-r,w+r,d+g,d+r],[-w-r,w+r,-d-r,-d-g]])
      regions.push({index:regions.length,kind:'table',floor:tableY,x:(x0+x1)/2,y:(y0+y1)/2,w:x1-x0,h:y1-y0,bounds:{x0,x1,y0,y1,corner:0}});
  }
  return regions;
}
export function placeProjected(shape,rng,regions,preferred,placed,{clearances=[.02,.1,.35,.8],maxStackHeight=18,allowStack=true}={}) {
  if(shape.top-shape.bottom+.015>maxStackHeight)return null;
  const region=regions[preferred],allowed=regions.filter(r=>r.kind===region.kind).map(r=>r.index);
  for(let i=allowed.length-1;i>0;i--){const j=rng.int(0,i);[allowed[i],allowed[j]]=[allowed[j],allowed[i]];}
  const clearance=rng.pick(clearances),worldAt=(x,y)=>shape.hull.map(p=>[p[0]+x,p[1]+y]);
  for(const slot of [preferred,...allowed.filter(x=>x!==preferred)]) {
    const r=regions[slot],b=r.bounds,a=[b.x0-shape.min[0],b.y0-shape.min[1]],z=[b.x1-shape.max[0],b.y1-shape.max[1]];
    if(a.some((v,i)=>v>z[i]))continue;
    for(let attempt=0;attempt<65;attempt++) {
      const xy=[rng.uniform(a[0],z[0]),rng.uniform(a[1],z[1])];
      if(attempt<8&&rng.chance(.24)){const axis=rng.int(0,1);xy[axis]=rng.pick([a[axis],z[axis]]);}
      const hull=worldAt(...xy);
      if(!hull.every(v=>insidePoint(b,...v)))continue;
      if(placed.some(q=>q.well===slot&&!separated(hull,q.hull,clearance)))continue;
      const y=r.floor+.015-shape.bottom;
      return {well:slot,x:xy[0],y:xy[1],z:y,hull,top:y+shape.top,stacked:false,region_kind:r.kind,clearance_mm:clearance,support:'floor contact'};
    }
  }
  if(allowStack)for(const candidate of placed.filter(q=>q.well===preferred)) {
    const hull=worldAt(candidate.x,candidate.y);
    if(!hull.every(v=>insidePoint(region.bounds,...v)))continue;
    const overlaps=placed.filter(q=>q.well===preferred&&!separated(hull,q.hull));
    const support=Math.max(...overlaps.map(q=>q.top)),z=support+.015-shape.bottom,top=z+shape.top;
    if(top-region.floor>maxStackHeight)continue;
    return {well:preferred,x:candidate.x,y:candidate.y,z,hull,top,stacked:true,region_kind:region.kind,clearance_mm:clearance,support:'conservative bounding-height support',support_instances:overlaps.filter(q=>q.top===support).map(q=>q.instance)};
  }
  return null;
}
