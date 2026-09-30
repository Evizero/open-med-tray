import appearances from '../../../configs/appearance-presets.json' with {type:'json'};
export const SOURCE_FAMILY_WEIGHTS = [['round_flat',12],['round_biconvex',26],['oval_tablet',14],['caplet',10],['hard_capsule',18],['softgel',5],['oblong_tablet',9],['triangular_tablet',1.5],['diamond_tablet',1.3],['hexagonal_tablet',1.2],['ring_tablet',1],['unknown_shape',.9]];
export const APPEARANCES = appearances;
export function appearanceSplit(split='train') {
  const ordered=[...appearances].sort((a,b)=>a.id.localeCompare(b.id));
  const a=Math.max(1,Math.floor(ordered.length*.68)),b=Math.max(a+1,Math.floor(ordered.length*.84));
  if(['train','preview'].includes(split))return ordered.slice(0,a);
  if(split==='val')return ordered.slice(a,b);
  if(['test','stress','comparison'].includes(split))return ordered.slice(b);
  throw new Error(`Unknown product split: ${split}`);
}
export function triangular(rng,lo,hi,mode) {
  const u=rng.random(),c=(mode-lo)/(hi-lo);
  return u<c?lo+Math.sqrt(u*(hi-lo)*(mode-lo)):hi-Math.sqrt((1-u)*(hi-lo)*(hi-mode));
}
