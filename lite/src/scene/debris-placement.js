// Position the actual rotated/scaled chip, not just its centre. The returned
// matrix seats its lowest vertex on the floor and keeps every projected vertex
// inside curved well boundaries. Rejected pieces are counted, never clipped.
import * as THREE from 'three';
import {convexHull,insidePoint,separated} from './placement.js';
export function placeDebris(geometry,quaternion,scale,region,rng,origin,obstacles=[],{spread=3,attempts=48,clearance=.007}={}) {
  const transform=new THREE.Matrix4().compose(new THREE.Vector3(),quaternion,scale),v=new THREE.Vector3(),points=[];
  let low=Infinity,high=-Infinity;
  const a=geometry.attributes.position;
  for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i).applyMatrix4(transform);points.push([v.x,-v.z]);low=Math.min(low,v.y);high=Math.max(high,v.y);}
  const hull=convexHull(points),b=region.bounds;
  const min=[Math.min(...hull.map(p=>p[0])),Math.min(...hull.map(p=>p[1]))],max=[Math.max(...hull.map(p=>p[0])),Math.max(...hull.map(p=>p[1]))];
  const cx=(min[0]+max[0])/2,cy=(min[1]+max[1])/2;
  const x0=b.x0-min[0]+cx,x1=b.x1-max[0]+cx,y0=b.y0-min[1]+cy,y1=b.y1-max[1]+cy;
  if(x0>x1||y0>y1)return null;
  for(let n=0;n<attempts;n++){
    const x=n<attempts*.75?Math.max(x0,Math.min(x1,origin[0]+rng.gauss(0,spread))):rng.uniform(x0,x1);
    const y=n<attempts*.75?Math.max(y0,Math.min(y1,origin[1]+rng.gauss(0,spread))):rng.uniform(y0,y1);
    const worldHull=hull.map(p=>[p[0]+x-cx,p[1]+y-cy]);
    if(!worldHull.every(p=>insidePoint(b,...p)))continue;
    const z=region.floor+clearance-low,top=z+high;
    if(obstacles.some(o=>o.well===region.index&&(o.bottom??region.floor)<top&&!separated(worldHull,o.hull)))continue;
    transform.setPosition(x-cx,z,-y+cy);
    return {matrix:transform,hull:worldHull,well:region.index,bottom:region.floor+clearance,top,position_mm:[x-cx,z,-y+cy],support:'floor',clearance_mm:clearance};
  }
  return null;
}
