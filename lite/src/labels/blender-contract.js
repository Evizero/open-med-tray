// Training metadata for the same IDs used directly by the scene label pass.
import {CLASSES, classFor, isPillId} from './schema.js';
export function trainingTargets(labels,pills,trayMeta,camera,{split='train',index=0}={}) {
  const ids=new Uint16Array(labels.instance.length),semantic=new Uint8Array(ids.length);
  const objects=pills.map(p=>{
    const s=p.parameters,classId=classFor(s),pos=p.pose.position_mm;
    return {instance_id:p.instance_id,class_id:classId,family:CLASSES[classId],
      product_key:s.productKey??`browser-${trayMeta.seed}-${p.product_index}`,appearance_reference:s.appearanceReference??null,product_sampling:s.sampling??null,
      length_mm:p.dimensions_mm?.L ?? s.length,width_mm:p.dimensions_mm?.W ?? s.width,height_mm:p.dimensions_mm?.H ?? s.thickness ?? s.width,
      color:s.color ?? s.capColor,secondary_color:s.kind==='capsule'?s.bodyColor:s.secondColor ?? s.color,
      finish:s.kind==='capsule'?'gelatin_shell':s.kind==='softgel'?'softgel_shell':s.finish==='chalky'?'chalky_uncoated':s.finish,chip:!!s.damage?.chips,score:s.score?.count ?? 0,
      two_tone:s.kind==='capsule'?JSON.stringify(s.capColor)!==JSON.stringify(s.bodyColor):!!s.twoTone,
      score_faces:s.score?.count?(s.score.faces ?? 'top'):'none',score_layout:s.score?.count?s.score.layout:'none',
      score_width_mm:s.score?.count?s.score.width:0,score_depth_mm:s.score?.count?s.score.depth:0,
      face_rim_width_mm:s.rimWidth ?? 0,crown_height_mm:s.crownHeight ?? 0,crown_curve:s.crownCurve ?? 0,crown_edge_blend_mm:s.crownBlend ?? 0,
      dose_fraction:p.damage?.remaining_fraction ?? 1,damage_parameters:p.damage,
      physical_relief:p.physical_relief ?? null,surface_parameters:p.surface_parameters ?? null,
      imprint:s.imprint?.text ?? s.print?.text ?? '',imprint_rendered:s.kind==='capsule'?!!s.print?.text:!!s.imprint && s.imprint.layout!=='none',
      imprint_style:s.kind==='capsule'?'ink':'deboss',imprint_parameters:s.imprint ?? s.print ?? null,
      compartment:p.well,stacked:!!p.pose.stacked,position_m:[pos[0]/1000,-pos[2]/1000,pos[1]/1000],
      pose:{...p.pose,roll_deg:p.pose.flip_or_roll_deg ?? 0},face_up:p.pose.face!=='down',visible_pixels:0,bbox_xyxy:null,drug_identity:null,
      parameters:s,class_assignment:s.sourceFamily?'explicit source family':'procedural shape; round split at crown/thickness 0.075'};
  });
  const byId=new Map(objects.map(o=>[o.instance_id,o]));
  const lookup={0:0,1:1,500:14,1000:1};
  for(const o of objects)lookup[o.instance_id]=o.class_id;
  for(let i=0;i<ids.length;i++) {
    const source=labels.instance[i],oldClass=labels.semantic[i];
    ids[i]=source;semantic[i]=oldClass;
    if(isPillId(source)) {
      const ob=byId.get(source);if(!ob)throw new Error(`Unmapped pill ID ${source}`);
      if(oldClass!==ob.class_id)throw new Error(`Class mismatch for pill ${source}`);
      ob.visible_pixels++;
      const x=i%labels.width,y=Math.floor(i/labels.width);
      if(!ob.bbox_xyxy)ob.bbox_xyxy=[x,y,x+1,y+1];
      else {const b=ob.bbox_xyxy;b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x+1);b[3]=Math.max(b[3],y+1);}
    }
    lookup[source]=oldClass;
  }
  return {instance:ids,semantic,meta:{schema_version:3,label_schema:'medtray/classes-v1',renderer:'three_raster_parity_development_v3',seed:trayMeta.seed,split,index,
    width_mm:trayMeta.container.width_mm,depth_mm:trayMeta.container.depth_mm,
    camera_height_mm:camera.position_mm?.[1],camera_clearance_above_rim_mm:camera.clearance_above_rim_mm,
    container_material:trayMeta.container.material,background_material:trayMeta.surface,lighting:trayMeta.lighting,lighting_parameters:trayMeta.lighting_parameters??null,
    compartments:trayMeta.container.wells.length,objects,instance_to_class:lookup,transparent_film:trayMeta.cover.kind!=='none',
    synthetic:true,drug_identity_verified:false,config:trayMeta.config,camera,
    browser_scene:trayMeta,printed_graphics:[],patient_stickers:trayMeta.stickers??(trayMeta.sticker?[trayMeta.sticker]:[]),
    labels_contract:'Pinhole visible surfaces, transparent covers excluded; class IDs follow configs/classes.json. Capsule halves share one object. Broken retained pill keeps its shape class, loose debris is 14.',
    unavailable_targets:['depth','beauty_cover_mask','exact_print_ink_instances','glare_diagnostic'],
    quality:{pill_pixels:objects.reduce((a,o)=>a+o.visible_pixels,0),invisible_objects:objects.filter(o=>!o.visible_pixels).length}}};
}
