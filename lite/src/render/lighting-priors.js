// Port of blender/lighting_v46.py and generate.py's v46 rig probabilities.
// SI records retain the Blender coordinate frame (X right, Y back, Z up).
// These are procedural priors, not measurements of a real capture chamber.
import { RNG } from '../util/rng.js';
export const LIGHTING_WEIGHTS = { chamber_diffuse: .48*.55, chamber_strips: .48*.23, chamber_slit: .48*.15, chamber_glare: .48*.07, window: .18, overcast: .10, sunlight: .06, indoor: .12, mixed_light: .06 };
export function sampleLightingKind(rng) { return rng.weighted(Object.keys(LIGHTING_WEIGHTS),Object.values(LIGHTING_WEIGHTS)); }
export function captureLighting(kind,{seed=0,widthMM=200,depthMM=75,rng=new RNG(seed).fork('capture-light-v46')}={}) {
  const width=widthMM/1000,depth=depthMM/1000;
  let rig=kind==='window'?'window_daylight':kind;
  if(rig==='chamber')rig=rng.weighted(['chamber_diffuse','chamber_strips','chamber_slit','chamber_glare'],[55,23,15,7]);
  if(!['chamber_diffuse','chamber_strips','chamber_slit','chamber_glare','window_daylight','overcast','sunlight','indoor','mixed_light'].includes(rig))throw new Error(`Unknown capture lighting: ${kind}`);
  const sources=[];let background=.12,chamber=null;
  const area=(name,position_m,target_m,power_w,w,h,color)=>sources.push({type:'area',name,position_m,target_m,power_w,size_m:[w,h],color});
  if(rig.startsWith('chamber')) {
    const span=Math.max(.30,width*1.45,depth*2.4);background=.025;
    chamber={span_m:span,roof_height_m:.205,wall_thickness_m:.003,wall_color:[.65,.66,.64],wall_roughness:.87,insertion_baffle_center_z_m:.145,insertion_baffle_height_m:.12};
    if(rig==='chamber_diffuse') {
      area('left diffuse panel',[-span*.44,0,.092],[0,0,.008],rng.uniform(.22,.4),.070,depth*1.7,[.96,.98,1]);
      area('right diffuse panel',[span*.44,.025,.075],[0,0,.008],rng.uniform(.18,.36),.080,depth*1.8,[1,.96,.89]);
      area('front diffuse fill',[0,-span*.43,.095],[0,0,0],.08,width*.8,.055,[.95,.98,1]);
    } else {
      const glare=rig==='chamber_glare',x=width*(glare?.45:.63),z=glare?.095:.045;
      area('left off-axis strip',[-x,0,z],[0,0,0],rng.uniform(.12,.25),.012,depth*1.3,[.96,.98,1]);
      area('right off-axis strip',[x,0,z],[0,0,0],rng.uniform(.10,.23),.012,depth*1.3,[1,.95,.88]);
      if(rig==='chamber_slit')area('daylight entering insertion slit',[0,-span*.65,.035],[0,0,0],.24,width,.035,[.77,.88,1]);
    }
  } else if(['window_daylight','sunlight','overcast'].includes(rig)) {
    const side=rng.pick([-1,1]);background=rng.uniform(.12,.23);
    area('off-axis window',[side*.4,-.32,.38],[0,0,0],rng.uniform(2.3,4.2),.30,.48,[.91,.96,1]);
    area('soft wall return',[-side*.32,.15,.22],[0,0,0],.40,.40,.30,[1,.96,.9]);
    if(rig==='overcast')area('broad overhead diffuse sky',[0,0,.7],[0,0,0],1,1.2,1.2,[.96,.98,1]);
    if(rig==='sunlight')sources.push({type:'sun',name:'angled direct sun',rotation_rad:[rng.uniform(.55,.95),rng.uniform(-.8,.8),rng.uniform(0,Math.PI*2)],strength:rng.uniform(.35,.9),angle_rad:rng.uniform(.01,.04),color:[1,.90,.75]});
  } else {
    background=.10;
    area('soft ceiling panel',[rng.pick([-1,1])*.24,.13,.40],[0,0,0],rng.uniform(1.6,2.8),.20,.34,[1,.90,.78]);
    area('diffuse room return',[-.25,-.18,.27],[0,0,0],rng.uniform(.4,.8),.35,.30,[.85,.92,1]);
    if(rig==='mixed_light')area('cool light at insertion side',[.02,-.4,.25],[0,0,0],1.3,.28,.35,[.73,.85,1]);
  }
  return {revision:'capture_rigs_v46',rig,seed,background_strength:background,sources,chamber,polarization_simulated:false,calibrated:false,coordinate_frame:'metres; X right, Y back, Z up',random_sequence:'independent JS RNG; same priors, not seed-identical to Python'};
}
