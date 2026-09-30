// Physical design priors ported from blender/container_geometry.py + container_v46.py.
// Length units: mm. Source family names and weights are preserved; RNG sequence is JS-specific.
export const TRAY_STYLES = {
  moulded_daily: { label: 'Daily moulded tray', weight: 25, covers: ['none', 'rigid_sliding', 'partly_open_sliding', 'flexible_film'] },
  thin_blister: { label: 'Thermoformed blister', weight: 12, covers: ['peeled_film', 'flexible_film', 'none'] },
  compact_daily: { label: 'Compact daily tray', weight: 10, covers: ['none', 'rigid_sliding', 'partly_open_sliding'] },
  adjustable: { label: 'Unequal compartments', weight: 8, covers: ['none', 'rigid_sliding', 'partly_open_sliding'] },
  removable_inserts: { label: 'Removable inserts', weight: 8, covers: ['none', 'detached_lid', 'rigid_sliding'] },
  four_pods: { label: 'Four-pod tray', weight: 4, covers: ['none', 'flexible_film', 'rigid_sliding'] },
  rigid_organizer: { label: 'Hinged organizer', weight: 13, covers: ['none', 'hinged_closed', 'hinged_open', 'hinged_partly', 'detached_lid'] },
  weekly_2x7: { label: 'Weekly AM / PM', weight: 10, covers: ['individual_hinged', 'none'] },
  twin_compact: { label: 'Twin compact', weight: 7, covers: ['none', 'hinged_closed', 'hinged_open', 'hinged_partly', 'partly_open_sliding'] },
  round_cups: { label: 'Removable round cups', weight: 3, covers: ['none', 'detached_lid', 'rigid_sliding'] },
};
export const DAYS = {
  de: ['MO', 'DI', 'MI', 'DO', 'FR', 'SA', 'SO'], en: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
  fr: ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'], it: ['LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB', 'DOM'],
};
export function containerParameters(rng, style, o = {}) {
  if (!TRAY_STYLES[style]) throw new Error(`Unknown container family: ${style}`);
  const u = (a, b) => rng.uniform(a, b);
  const p = { style, language: o.language ?? rng.weighted(['de','en','fr','it'], [6,2,1,1]),
    width:u(180,255), depth:u(48,72), height:u(9,19), cols:4, rows:1,
    rim:u(4.5,7.5), web:u(2.5,6.5), thickness:u(.7,1.3), corner:u(2.5,5.5), draft:u(2,3.6), floorZ:.15,
    skirt:0, bodyKind:'moulded_shell', removable:false };
  if (!DAYS[p.language]) throw new Error(`Unsupported print language: ${p.language}`);
  if (style === 'compact_daily') Object.assign(p,{width:u(110,150),depth:u(39,52),height:u(10,18),cols:rng.pick([3,4,5]),web:u(1.2,3.5)});
  if (style === 'adjustable') Object.assign(p,{cols:rng.pick([3,4,4,5,6]),web:u(1.2,3.5)});
  if (style === 'four_pods') Object.assign(p,{width:u(90,120),depth:u(55,75),height:u(10,18),cols:2,rows:2,web:u(1.2,3.5)});
  if (style === 'thin_blister') Object.assign(p,{thickness:u(.35,.65),bodyKind:'thermoformed_shell',paperBacking:o.paperBacking ?? rng.chance(.7)});
  if (style === 'rigid_organizer') Object.assign(p,{width:u(180,230),depth:u(60,78),height:u(14,23),cols:rng.pick([5,6,7]),rim:u(3.5,5.5),web:u(1.4,2.4),thickness:u(.9,1.6),draft:1.5});
  if (style === 'weekly_2x7') Object.assign(p,{width:u(170,205),depth:u(80,100),height:u(12,19),cols:7,rows:2,rim:u(4,6),web:u(2,3.2),thickness:u(.8,1.4),draft:1.4});
  if (style === 'twin_compact') Object.assign(p,{width:u(95,135),depth:u(46,62),height:u(12,18),cols:2,rim:u(3.5,5.5),web:u(2,3.2),thickness:u(.9,1.5)});
  if (style === 'round_cups') Object.assign(p,{width:u(160,200),depth:u(43,53),height:u(13,21),cols:4,rim:4,web:2,thickness:.6,round:true,removable:true,floorZ:.95});
  if (style === 'removable_inserts') Object.assign(p,{removable:true,floorZ:.95});
  if (['rigid_organizer','weekly_2x7','twin_compact'].includes(style)) { p.bodyKind='rigid_compartment_body';p.skirt='full'; }
  if (o.compartments != null && !['weekly_2x7','four_pods'].includes(style)) {
    if (!Number.isInteger(o.compartments) || o.compartments < 2 || o.compartments > 7) throw new Error('Compartment count must be an integer from 2 to 7');
    p.cols=o.compartments;
  }
  // Scaling is explicit, recorded, and keeps wall/rim thickness unchanged.
  for (const key of ['width','depth','height']) if (o[key] != null) {
    if (!Number.isFinite(o[key]) || o[key] <= 0) throw new Error(`Invalid ${key}`);
    p[key]=o[key];
  }
  const modern=['rigid_organizer','weekly_2x7','twin_compact','round_cups'].includes(style);
  p.branded=o.branded ?? rng.chance(.92);
  p.brandPlacement=o.brandPlacement ?? rng.pick(modern ? ['top','bottom'] : ['left','right','top','bottom']);
  if (!['left','right','top','bottom'].includes(p.brandPlacement)) throw new Error('Invalid brand placement');
  if (['weekly_2x7','twin_compact','round_cups'].includes(style) && ['left','right'].includes(p.brandPlacement)) p.brandPlacement='bottom';
  if (p.branded && !modern && ['top','bottom'].includes(p.brandPlacement)) p.rim=Math.max(6,p.rim);
  let x0=-p.width/2+p.rim,x1=p.width/2-p.rim,y0=-p.depth/2+p.rim,y1=p.depth/2-p.rim;
  p.brandPanel=null;
  if (p.branded) {
    if (['left','right'].includes(p.brandPlacement)) {
      const panel=p.width*u(.12,modern?.17:.20),left=p.brandPlacement==='left';
      p.brandPanel={x:left?x0+panel/2:x1-panel/2,y:0,w:panel*.9,h:p.depth-2*p.rim};
      if (left)x0+=panel+p.web;else x1-=panel+p.web;
    } else p.brandPanel={x:p.width*u(-.15,.15),y:(p.brandPlacement==='top'?1:-1)*(p.depth/2-p.rim*.50),w:p.width*u(.35,.55),h:p.rim*.76};
  }
  // Two-row layouts label both outer well edges. Reserve a second print strip
  // on the branded edge so weekday headers and the wordmark cannot coincide.
  if (p.rows > 1 && p.brandPanel && ['top','bottom'].includes(p.brandPlacement)) {
    const reserve = p.brandPanel.h + 1;
    if (p.brandPlacement === 'top') y1 -= reserve; else y0 += reserve;
  }
  p.region=[x0,y0,x1,y1];p.wellCorner=p.corner;
  const avail=x1-x0-(p.cols-1)*p.web,ch=(y1-y0-(p.rows-1)*p.web)/p.rows;
  if (avail/p.cols < 8 || ch < 10 || p.height < 3) throw new Error('Container dimensions leave no usable well area');
  const weights=Array.from({length:p.cols},()=>p.rows>1?1:u(style==='adjustable'?.65:.84,style==='adjustable'?1.4:1.16));
  const sum=weights.reduce((a,b)=>a+b,0);p.cells=[];
  for (let row=0;row<p.rows;row++) {
    let x=x0;
    for (let col=0;col<p.cols;col++) {
      const cw=avail*weights[col]/sum;
      const cell={x:x+cw/2,y:y1-ch/2-row*(ch+p.web),w:cw,h:ch,row,col};
      if (p.round) cell.w=cell.h=Math.min(cw,ch)*.94;
      cell.draft=Math.min(p.draft,cell.w*.10,cell.h*.10);
      cell.floorZ=p.floorZ;
      if(style==='weekly_2x7')cell.name=DAYS[p.language][col]+(row===0?' AM':' PM');
      p.cells.push(cell);x+=cw+p.web;
    }
  }
  p.revision='browser-container-parity-v3';
  return p;
}
