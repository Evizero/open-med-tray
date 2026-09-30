import * as THREE from 'three';
import {RNG} from '../util/rng.js';
export const STRESS_SCENARIOS=['sparse_frame','dense_wells','table_spill','table_scatter','heavy_labels','lid_occlusion','cropped_frame','mixed_overload'];
export function stressConfig(config,kind,index=0) {
 if(kind==='ordinary'||!kind)return {...config,edgeScenario:null,spillFraction:0,stickerCount:1};
 if(!STRESS_SCENARIOS.includes(kind))throw new Error(`Unknown stress scenario: ${kind}`);
 const c=structuredClone(config),rng=new RNG(c.seed+55687+index);
 Object.assign(c,{edgeScenario:kind,edgeAnchor:index%9,frameFill:rng.uniform(.62,.9),maxStackHeight:14,spillFraction:0,intentionalCrop:false,stickerCount:1});
 c.camera.roll=(index*137.507764+rng.uniform(-12,12)+540)%360-180;
 c.lighting=rng.pick(['window','indoor','chamber_diffuse']);
 if(kind==='sparse_frame'){c.count=rng.int(1,3);c.frameFill=rng.uniform(.45,.65);}
 if(kind==='dense_wells')Object.assign(c,{count:rng.int(32,48),style:'moulded_daily',cover:'none'});
 if(kind==='table_spill')Object.assign(c,{count:rng.int(10,20),spillFraction:.45,cover:'none'});
 if(kind==='table_scatter')Object.assign(c,{count:rng.int(22,36),spillFraction:.8,cover:'none',frameFill:rng.uniform(.68,.89)});
 if(kind==='heavy_labels')Object.assign(c,{count:rng.int(12,22),style:'moulded_daily',cover:'rigid_sliding',sticker:true,stickerCount:3,stickerLarge:true,stickerCentral:true});
 if(kind==='lid_occlusion')Object.assign(c,{count:rng.int(14,26),style:'rigid_organizer',cover:'hinged_partly',lidAngle:rng.uniform(8,50),container:'tinted_clear',sticker:true,stickerCount:2,stickerLarge:true,stickerForceCover:true});
 if(kind==='cropped_frame')Object.assign(c,{count:rng.int(8,18),frameFill:.96,intentionalCrop:true});
 if(kind==='mixed_overload')Object.assign(c,{count:rng.int(40,58),spillFraction:.35,style:'moulded_daily',cover:'rigid_sliding',sticker:true,stickerCount:2,stickerLarge:true,debris:true,damage:.45});
 return c;
}
export function frameStressCamera(cam,points,c) {
 if(!c.edgeScenario)return null;
 const box=()=>{let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const p of points){const q=p.clone().project(cam);x0=Math.min(x0,q.x*.5+.5);x1=Math.max(x1,q.x*.5+.5);y0=Math.min(y0,q.y*.5+.5);y1=Math.max(y1,q.y*.5+.5);}return [x0,y0,x1,y1];};
 let b=box(),span=Math.max(b[2]-b[0],b[3]-b[1]);
 cam.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov)/2)*span/c.frameFill));cam.updateProjectionMatrix();
 b=box();const center=[(b[0]+b[2])/2,(b[1]+b[3])/2],anchor=[c.edgeAnchor%3-1,Math.floor(c.edgeAnchor/3)-1];
 const margin=[Math.max(0,(1-(b[2]-b[0]))/2-.025),Math.max(0,(1-(b[3]-b[1]))/2-.025)];
 const desired=[.5+anchor[0]*margin[0],.5+anchor[1]*margin[1]];
 if(c.intentionalCrop){const axis=b[2]-b[0]>=b[3]-b[1]?0:1;desired[axis]=.5+(c.edgeAnchor%2?-1:1)*(.07+margin[axis]);}
 cam.userData.captureShift=[center[0]-desired[0],desired[1]-center[1]];
 const [sx,sy]=cam.userData.captureShift;
 cam.setViewOffset(cam.aspect,1,sx*cam.aspect,sy,cam.aspect,1);
 return {scenario:c.edgeScenario,anchor_grid_index:c.edgeAnchor,requested_extent:c.frameFill,roll_deg:c.camera.roll,intentional_crop:!!c.intentionalCrop,projected_bounds_xyxy_bottom_up:box(),sensor_shift:cam.userData.captureShift};
}
