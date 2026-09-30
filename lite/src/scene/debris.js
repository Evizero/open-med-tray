// Source: blender/tray_details.py scatter and configs/photoreal-v46.json.
// Millimetres throughout. JS random draws are independent of Python's sequence.
import * as THREE from 'three';
import {ConvexGeometry} from 'three/addons/geometries/ConvexGeometry.js';
import defaults from '../../../configs/photoreal-v46.json' with {type:'json'};
import {placeDebris} from './debris-placement.js';
import {makeTabletMaterial} from '../render/materials.js';
export const DEBRIS_PRIORS={damagedProbability:defaults.debris_probability,intactProbability:defaults.intact_debris_probability,chunkProbability:defaults.fragment_probability,maxSources:4,powderRadiusMM:[.020,.170,.045],crumbDiameterMM:[.22,.80],chunkDiameterMM:[1,2.7],heightRatio:[.28,.62],grainCountDamaged:[12,55],grainCountIntact:[4,18],pieceCountDamaged:[2,6],pieceCountIntact:[1,3],grainMM:.085,reliefMM:.016,floorClearanceMM:.007};
const triangular=(rng,a,b,mode)=>{const u=rng.random(),f=(mode-a)/(b-a);return u<f?a+Math.sqrt(u*(b-a)*(mode-a)):b-Math.sqrt((1-u)*(b-a)*(b-mode));};
export function debrisCohorts(sources,rng,config={}) {
 if(config.debris===false)return [];
 const eligible=sources.filter(p=>p.spec.kind==='tablet'&&p.spec.outline!=='ring');
 for(let i=eligible.length-1;i>0;i--){const j=rng.int(0,i);[eligible[i],eligible[j]]=[eligible[j],eligible[i]];}
 const cohorts=[];
 for(const source of eligible.slice(0,DEBRIS_PRIORS.maxSources)){
  const s=source.spec,damaged=!!(s.damage?.chips||s.damage?.fracture);
  if(!rng.chance(damaged?(config.debrisProbability??DEBRIS_PRIORS.damagedProbability):(config.intactDebrisProbability??DEBRIS_PRIORS.intactProbability)))continue;
  const color=s.color.map(v=>.72*v+.28*.83),seed=rng.int(0,99999),angle=rng.uniform(0,Math.PI*2);
  const centre=[source.placement.x+s.length*.48*Math.cos(angle),source.placement.y+s.width*.52*Math.sin(angle)];
  const radii=Array.from({length:rng.int(...(damaged?DEBRIS_PRIORS.grainCountDamaged:DEBRIS_PRIORS.grainCountIntact))},()=>triangular(rng,...DEBRIS_PRIORS.powderRadiusMM));
  const pieces=Array.from({length:rng.int(...(damaged?DEBRIS_PRIORS.pieceCountDamaged:DEBRIS_PRIORS.pieceCountIntact))},(_,j)=>{
   const chunk=damaged&&j===0&&rng.chance(config.fragmentProbability??DEBRIS_PRIORS.chunkProbability),diameter=rng.uniform(...(chunk?DEBRIS_PRIORS.chunkDiameterMM:DEBRIS_PRIORS.crumbDiameterMM));
   return {kind:chunk?'loose_chunk':'crumb',diameter_mm:diameter,height_mm:diameter*rng.uniform(...DEBRIS_PRIORS.heightRatio)};
  });
  cohorts.push({source,damaged,color,seed,centre,radii,pieces});
 }
 return cohorts;
}
export function angularChip(rng,diameter,height) {
 const points=[],n=rng.int(5,8);
 for(const z of [0,height])for(let j=0;j<n;j++){
  const a=j*Math.PI*2/n+rng.uniform(-.12,.12),r=diameter*.5*rng.uniform(.58,1),x=Math.cos(a)*r,y=Math.sin(a)*r*rng.uniform(.6,1),h=z*rng.uniform(.75,1);
  points.push(new THREE.Vector3(x,h,-y));
 }
 // Convex fractured faces; the source's 8 µm bevel is not simulated here.
 return new ConvexGeometry(points);
}
function powderGeometry(){
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([-1,0,.5,.8,0,.4,.2,0,-1,-.12,.8,0],3));g.setIndex([0,2,1,0,1,3,1,2,3,2,0,3]);g.computeVertexNormals();const flat=g.toNonIndexed();g.dispose();return flat;
}
export function buildDebris(sources,regions,rng,config,occupied) {
 const meshes=[],records=[],disposables=[],clouds=debrisCohorts(sources,rng,config),q=new THREE.Quaternion(),scale=new THREE.Vector3(1,1,1);
 let rejected=0;
 for(const c of clouds){
  const region=regions[c.source.placement.well],mat=makeTabletMaterial({finish:'chalky',color:c.color,seed:c.seed},null,{core:true});
  mat.userData.uniforms.uGrain.value.x=DEBRIS_PRIORS.grainMM;mat.userData.uniforms.uGrain.value.y=DEBRIS_PRIORS.reliefMM;mat.userData.uniforms.uRoughBase.value=.86;disposables.push(mat);
  const shared={source_instance_id:c.source.label.instance,well:region.index,color:c.color,material_seed:c.seed,damaged_source:c.damaged,counts_as_pill:false,support:'floor',clearance_mm:.007};
  const powder=powderGeometry(),positions=[],particles=[];
  for(const radius of c.radii){
   const fit=placeDebris(powder,q,scale.setScalar(radius),region,rng,c.centre,occupied,{spread:3.4});
   if(!fit){rejected++;continue;}
   occupied.push(fit);const v=new THREE.Vector3();
   for(let i=0;i<powder.attributes.position.count;i++){v.fromBufferAttribute(powder.attributes.position,i).applyMatrix4(fit.matrix);positions.push(v.x,v.y,v.z);}
   particles.push({radius_mm:radius,position_mm:fit.position_mm});
  }
  powder.dispose();
  if(positions.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();const mesh=new THREE.Mesh(g,mat);meshes.push(mesh);disposables.push(g);records.push({...shared,kind:'powder_cloud',requested:c.radii.length,count:particles.length,particles});}
  for(const piece of c.pieces){
   const g=angularChip(rng,piece.diameter_mm,piece.height_mm);q.setFromAxisAngle(new THREE.Vector3(0,1,0),rng.uniform(0,Math.PI*2));
   const fit=placeDebris(g,q,scale.setScalar(1),region,rng,c.centre,occupied,{spread:4});
   if(!fit){rejected++;g.dispose();continue;}
   const mesh=new THREE.Mesh(g,mat);mesh.position.fromArray(fit.position_mm);mesh.quaternion.copy(q);meshes.push(mesh);occupied.push(fit);disposables.push(g);
   records.push({...shared,...piece,position_mm:fit.position_mm});
  }
  q.identity();
 }
 for(const mesh of meshes){mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.label={instance:500,semantic:14,object:'tablet debris'};}
 return {meshes,records,disposables,placement:{rejected,source_cohorts:clouds.length,revision:'source_scatter_v46',priors:DEBRIS_PRIORS,method:'source cohorts and particle sizes; constrained actual-vertex floor placement, no rigid-body settling or mass conservation',source_differences:['one grouped debris instance ID 500','occluding floor footprints avoided','8 micrometre angular-piece edge bevel not simulated']}};
}
