// One class/instance convention shared by the workbench and Blender training.
import classes from '../../../configs/classes.json' with {type:'json'};
export const CLASSES = classes.map(c => c.name);
export const SEMANTIC = Object.fromEntries(classes.map(c => [c.id,c.name]));
export const CLASS_COLORS = classes.map(c => c.id === 0 ? null : c.color);
export const INSTANCE = Object.freeze({background:0,tray:1,pillStart:10,debris:500,stickerStart:1000,printStart:2000});
export const isPillId = id => id >= INSTANCE.pillStart && id < INSTANCE.debris;
export function classFor(spec) {
  if(spec.sourceFamily && CLASSES.indexOf(spec.sourceFamily)>=2 && CLASSES.indexOf(spec.sourceFamily)<=13)return CLASSES.indexOf(spec.sourceFamily);
  if(spec.kind==='capsule')return 6;
  if(spec.kind==='softgel')return 7;
  if(spec.outline==='ring')return 12;
  if(spec.outline==='round')return spec.crownHeight/spec.thickness<.075?2:3;
  if(spec.outline==='oval')return 4;
  if(spec.outline==='caplet')return 5;
  if(spec.outline==='oblong')return 8;
  if(spec.outline==='diamond')return 10;
  if(spec.outline==='polygon'&&spec.sides===3)return 9;
  if(spec.outline==='polygon'&&spec.sides===6)return 11;
  return 13;
}
