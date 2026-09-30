// Appearance priors ported from blender/pill_appearance_v46.py and
// placement_v46.py. RGB values are bounded design priors (linear), not measured
// colorimetry; no colour/shape here identifies any medicine. Names are fictional.
import { RNG, clamp } from '../util/rng.js';
import { SOURCE_FAMILY_WEIGHTS, appearanceSplit, triangular } from './source-priors.js';
export { SOURCE_FAMILY_WEIGHTS, APPEARANCES, appearanceSplit } from './source-priors.js';

export const PALETTE = {
  white: [.94, .93, .90], off_white: [.87, .86, .80], cream: [.90, .82, .59], beige: [.63, .49, .32],
  yellow: [.88, .66, .12], pale_yellow: [.94, .87, .48], peach: [.88, .56, .36], orange: [.77, .27, .07],
  pink: [.85, .45, .48], salmon: [.74, .31, .24], red: [.53, .020, .025], brown_red: [.26, .046, .025],
  burgundy: [.16, .011, .034], brown: [.22, .09, .035], pale_blue: [.40, .63, .79], blue: [.018, .16, .53],
  pale_green: [.53, .68, .40], green: [.022, .23, .078], teal: [.014, .28, .25], lilac: [.54, .41, .64],
  violet: [.19, .065, .30], gray: [.30, .32, .34], near_black: [.023, .021, .019], amber: [.82, .43, .055],
  clear_straw: [.96, .86, .56],
};
export const NEUTRALS = ['white', 'off_white', 'cream', 'beige'];
export const TABLET_COLORS = ['yellow', 'pale_yellow', 'peach', 'orange', 'pink', 'salmon', 'red', 'brown_red', 'brown', 'pale_blue', 'blue', 'pale_green', 'green', 'lilac', 'gray'];
export const CAPSULE_COLORS = [...TABLET_COLORS, 'burgundy', 'teal', 'violet', 'near_black'];

// Softgel optical profiles: [name, opacity, transmission, density range, roughness range, weight]
export const SOFTGEL_PROFILES = [
  ['clear_straw', 'transparent', 1, [20, 75], [.07, .16], 15],
  ['amber', 'transparent', 1, [70, 210], [.08, .19], 16],
  ['red', 'transparent', 1, [80, 220], [.09, .20], 14],
  ['pink', 'transparent', 1, [45, 130], [.09, .19], 7],
  ['green', 'translucent', .82, [60, 180], [.19, .34], 10],
  ['brown', 'translucent', .90, [100, 250], [.12, .25], 5],
  ['off_white', 'opaque', 0, [0, 0], [.17, .30], 12],
  ['pale_yellow', 'milky', .22, [12, 35], [.13, .27], 10],
  ['brown_red', 'opaque', 0, [0, 0], [.15, .29], 11],
];
export const SOFTGEL_STATES = { transparent: 1, translucent: .86, milky: .22, opaque: 0 };

export function shade(rng, name) {
  const gain = rng.uniform(.94, 1.045);
  return PALETTE[name].map((c) => clamp(c * gain + rng.uniform(-.006, .006), .004, .98));
}

const baseTablet = {
  kind: 'tablet', outline: 'round', sides: 6, length: 8.6, width: 8.6, thickness: 3.0,
  crownHeight: .06, crownCurve: 1.6, rimWidth: 0, crownBlend: .06, edgeRadius: .22,
  score: { count: 0, layout: 'single', width: .32, depth: .14, reach: 1, faces: 'top' },
  imprint: { layout: 'none', text: 'P10', font: 'sans', span: 3.6, depth: .11, symbol: 'diamond', rotation: 0, offsetX: 0, offsetY: 0, wear: 0 },
  imprintBack: null,
  finish: 'chalky', color: PALETTE.white, colorName: 'white', powder: .8, speckles: 0, texture: 1, grainScale: 1, mottling: 1, pores: .03,
  pressDefects: 1, breakoutDensity: .035, breakoutSize: .18, breakoutFaces: 'top', wear: 0,
  damage: { chips: 0, chipSize: .16, fracture: false, tilt: 18, waviness: .34, lip: .5, seed: 42 },
  seed: 110,
};
const baseCapsule = {
  kind: 'capsule', length: 21.7, width: 7.34, capWall: .15, capFraction: .54, ovality: .99,
  capColor: PALETTE.orange, capColorName: 'orange', bodyColor: PALETTE.pale_green, bodyColorName: 'pale_green', scuffs: 1,
  print: { text: 'P22', capText: '', font: 'sans' }, seed: 22,
};
const baseSoftgel = {
  kind: 'softgel', shape: 'oval', length: 13.5, width: 8.6, thickness: 7.2, straight: .45,
  color: PALETTE.amber, colorName: 'amber', secondColor: PALETTE.off_white, twoTone: false,
  opacity: 'transparent', transmission: 1, density: 150, roughness: .1, seamWidth: .09, seamRelief: .014, asymmetry: .004, seed: 7,
};
export const BASE = { tablet: baseTablet, capsule: baseCapsule, softgel: baseSoftgel };

const T = (o) => deepMerge(structuredClone(baseTablet), o);
const C = (o) => deepMerge(structuredClone(baseCapsule), o);
const S = (o) => deepMerge(structuredClone(baseSoftgel), o);

export const PRESETS = [
  { id: 'p10', name: 'Scored round', note: 'Chalky, P10 deboss', spec: T({ outline: 'round', length: 8.6, width: 8.6, thickness: 3.0, crownHeight: .08, score: { count: 1, width: .30, depth: .14 }, imprint: { layout: 'text', text: 'P10', span: 3.2, offsetX: 2.05, rotation: 90, depth: .11 } }) },
  { id: 'inset', name: 'Inset-crown caplet', note: 'Flat shoulder land', spec: T({ outline: 'caplet', length: 14, width: 8.5, thickness: 3.1, crownHeight: .42, crownCurve: 1.6, rimWidth: .55, crownBlend: .035, color: PALETTE.peach, colorName: 'peach', score: { count: 1, width: .42, depth: .16 }, seed: 141 }) },
  { id: 'ab125', name: 'Film oval', note: 'Stacked AB/125', spec: T({ outline: 'oval', length: 12, width: 6.6, thickness: 4.2, crownHeight: .9, finish: 'satin_film', color: PALETTE.pale_blue, colorName: 'pale_blue', imprint: { layout: 'stacked', text: 'AB/125', font: 'sans', span: 4.2, depth: .09 }, seed: 125 }) },
  { id: 'hex', name: 'Hexagon, cross score', note: 'Matte film', spec: T({ outline: 'polygon', sides: 6, length: 9.6, width: 9.6, thickness: 3.4, crownHeight: .35, finish: 'matte_film', color: [.72, .73, .72], colorName: 'gray', score: { count: 2, layout: 'cross', width: .26, depth: .12, faces: 'both' }, seed: 606 }) },
  { id: 'boxk', name: 'Boxed mark', note: 'Serif K', spec: T({ outline: 'round', length: 10, width: 10, thickness: 3.6, crownHeight: .55, finish: 'matte_film', color: PALETTE.pale_green, colorName: 'pale_green', imprint: { layout: 'boxed', text: 'K', font: 'serif', span: 5.2, depth: .12 }, seed: 11 }) },
  { id: 'tri', name: 'Triangle', note: 'Emblem + code', spec: T({ outline: 'polygon', sides: 3, length: 10, width: 9.2, thickness: 3.3, crownHeight: .3, color: PALETTE.pale_yellow, colorName: 'pale_yellow', imprint: { layout: 'symbol_code', text: '7Q', symbol: 'diamond', span: 4.6, depth: .1, offsetX: -.6 }, seed: 73 }) },
  { id: 'cross', name: 'Crossed word', note: 'Large wordmark', spec: T({ outline: 'round', length: 11, width: 11, thickness: 3.8, crownHeight: .45, imprint: { layout: 'cross', text: 'ATLAS', font: 'sans', span: 7.4, depth: .11 }, seed: 405 }) },
  { id: 'damaged', name: 'Chipped & split', note: 'Real fracture geometry', spec: T({ outline: 'oval', length: 13, width: 7.4, thickness: 4.4, crownHeight: .8, color: [.86, .83, .76], colorName: 'off_white', score: { count: 1, width: .5, depth: .18 }, damage: { chips: 2, chipSize: .17, fracture: true, tilt: 24, waviness: .32, lip: .5, seed: 34 }, seed: 34 }) },
  { id: 'ring', name: 'Ring tablet', note: 'Open centre, compressed torus', spec: T({outline: 'ring', length: 10, width: 10, thickness: 3.2, color: PALETTE.off_white, colorName: 'off_white', seed: 120}) },
  { id: 'cap22', name: 'Two-piece capsule', note: 'Size 0, printed', spec: C({}) },
  { id: 'capred', name: 'Red / white capsule', note: 'Size 1', spec: C({ length: 19.4, width: 6.63, capColor: PALETTE.red, capColorName: 'red', bodyColor: PALETTE.white, bodyColorName: 'white', print: { text: 'RX 24', capText: '' }, capFraction: .52, seed: 24 }) },
  { id: 'amber', name: 'Amber softgel', note: 'Transparent oval', spec: S({}) },
  { id: 'oblong', name: 'Straw oblong', note: 'Clear, 16.5 mm', spec: S({ shape: 'oblong', length: 16.5, width: 6.6, thickness: 6.2, straight: .46, color: PALETTE.clear_straw, colorName: 'clear_straw', density: 60, roughness: .08, seed: 12 }) },
  { id: 'green', name: 'Green softgel', note: 'Translucent', spec: S({ shape: 'oval', length: 11.5, width: 7.6, thickness: 6.6, color: PALETTE.green, colorName: 'green', opacity: 'translucent', transmission: .86, density: 120, roughness: .24, seed: 44 }) },
  { id: 'twotone', name: 'Two-tone softgel', note: 'Opaque halves', spec: S({ shape: 'oval', length: 12.5, width: 7.4, thickness: 6.4, color: PALETTE.brown_red, colorName: 'brown_red', secondColor: PALETTE.off_white, twoTone: true, opacity: 'opaque', transmission: 0, density: 0, roughness: .2, seed: 9 }) },
  { id: 'milky', name: 'Milky round', note: 'Round softgel', spec: S({ shape: 'round', length: 8.6, width: 8.6, thickness: 8.0, color: PALETTE.pale_yellow, colorName: 'pale_yellow', opacity: 'milky', transmission: .22, density: 25, roughness: .18, seed: 86 }) },
];

export function deepMerge(a, b) {
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) deepMerge(a[k], v);
    else a[k] = Array.isArray(v) ? [...v] : v;
  }
  return a;
}

// Family-specific valid ranges (mm). UI sliders read these; validate() enforces them.
export const RANGES = {
  tablet: {
    length: [4.5, 24], width: [4, 16], thickness: [1.4, 7], crownHeight: [0, 1.6], crownCurve: [1, 4], rimWidth: [0, 1.2], crownBlend: [0, .3], edgeRadius: [.05, .4],
    scoreWidth: [.12, .8], scoreDepth: [.04, .3], scoreReach: [.55, 1], imprintSpan: [1.5, 9], imprintDepth: [.03, .2],
    powder: [0, 1.5], texture: [0, 2], speckles: [0, 1], pores: [0, .25], pressDefects: [0, 2], chipSize: [.08, .3], tilt: [-45, 45],
  },
  capsule: { length: [9, 24], width: [3, 14], capFraction: [.42, .6], capWall: [.06, .3], scuffs: [0, 2] },
  softgel: { length: [5.5, 24], width: [3, 16], thickness: [2.5, 14], straight: [.2, .6], density: [0, 260], roughness: [.04, .4], seamWidth: [.05, .2], seamRelief: [0, .03] },
};

// Clamp to valid, physically consistent values (never self-intersecting).
export function validate(spec) {
  const s = spec;
  if (s.kind === 'tablet') {
    const R = RANGES.tablet;
    s.length = clamp(s.length, ...R.length);
    s.width = clamp(s.width, ...R.width);
    if (['round', 'ring'].includes(s.outline)) s.width = s.length = clamp(s.length, 4.5, 16);
    if (s.outline === 'polygon' || s.outline === 'heart' || s.outline === 'diamond' || s.outline === 'lobed') { s.length = clamp(s.length, 4.5, 16); s.width = clamp(s.width, 4, 16); }
    if (['oval', 'caplet', 'oblong'].includes(s.outline)) s.width = Math.min(s.width, s.length * .92);
    if (s.outline === 'ring') {
      s.sourceFamily = 'ring_tablet';
      s.score = {...s.score, count: 0}; s.imprint = {...s.imprint, layout: 'none'}; s.imprintBack = null;
      s.damage = {...s.damage, chips: 0, fracture: false};
    } else if (s.sourceFamily === 'ring_tablet') delete s.sourceFamily;
    s.thickness = clamp(s.thickness, R.thickness[0], Math.min(R.thickness[1], Math.min(s.length, s.width) * .98));
    s.crownHeight = clamp(s.crownHeight, 0, s.thickness * .36);
    s.rimWidth = clamp(s.rimWidth, 0, Math.min(R.rimWidth[1], Math.min(s.length, s.width) * .2));
    if (s.imprint) s.imprint.span = clamp(s.imprint.span, 1, Math.min(s.length, s.width) * .95 + (s.imprint.layout === 'text' || s.imprint.layout === 'stacked' ? Math.max(0, s.length - s.width) : 0));
    if (s.score) { s.score.width = clamp(s.score.width, ...R.scoreWidth); s.score.depth = clamp(s.score.depth, ...R.scoreDepth); }
  } else if (s.kind === 'capsule') {
    const R = RANGES.capsule;
    s.length = clamp(s.length, ...R.length);
    s.width = clamp(s.width, R.width[0], Math.min(R.width[1], s.length * .66));
    s.capWall = clamp(s.capWall ?? .15,...R.capWall);
    s.capFraction = clamp(s.capFraction ?? .54,...R.capFraction);
  } else {
    const R = RANGES.softgel;
    s.length = clamp(s.length, ...R.length);
    if (s.shape === 'round') { s.length = clamp(s.length, 5.5, 11); s.width = s.length * clamp(s.width / s.length, .94, 1); }
    else if (s.shape === 'oval') s.width = clamp(s.width, s.length * .5, s.length * .8);
    else s.width = clamp(s.width, s.length * .3, s.length * .5);
    s.thickness = clamp(s.thickness, s.width * .5, s.width);
    s.transmission = s.opacity === 'opaque' ? 0 : clamp(s.transmission ?? SOFTGEL_STATES[s.opacity] ?? 1, 0, 1);
  }
  return s;
}

// Source prototype mixture, including split-disjoint curated descriptions.
// These are coverage priors, not prescribing frequencies or identity labels.
export function randomProduct(rng, index, { split='train', appearanceProbability=.35, familyWeights=SOURCE_FAMILY_WEIGHTS, family=null, appearanceId=null }={}) {
  let fam=family ?? rng.weighted(familyWeights.map(v=>v[0]),familyWeights.map(v=>v[1]));
  const rows=appearanceSplit(split);
  const appearance=appearanceId ? rows.find(r=>r.id===appearanceId) : rng.chance(appearanceProbability)?rng.pick(rows):null;
  if(appearanceId&&!appearance)throw new Error(`Appearance ${appearanceId} is not in split ${split}`);
  const ap=appearance?.parameters;
  if(ap)fam=ap.family;
  if(!SOURCE_FAMILY_WEIGHTS.some(v=>v[0]===fam))throw new Error(`Unknown source family ${fam}`);
  const elong=['oval_tablet','caplet','hard_capsule','softgel','oblong_tablet'].includes(fam);
  const seed=rng.int(1,1e6);
  let length=elong?rng.uniform(9,21):rng.uniform(4.5,12.5),width=elong?length*rng.uniform(.37,.63):length;
  let thickness=rng.uniform(1.9,4.3)*(fam==='round_flat'?.75:1);
  if(['hard_capsule','softgel'].includes(fam))thickness=width*rng.uniform(.88,1);
  const finish=ap?(ap.finish==='chalky_uncoated'?'chalky':ap.finish):rng.weighted(['chalky','matte_film','satin_film'],[45,40,15]);
  let colorName=rng.pick(rng.chance(finish==='chalky'?.83:.58)?NEUTRALS:TABLET_COLORS);
  let color=shade(rng,colorName),second=color.slice();
  if(ap){length=ap.length_mm;width=ap.width_mm;thickness=ap.height_mm;color=ap.color.slice();second=ap.secondary_color.slice();colorName=appearance.declared.color;}
  const marking=ap?.synthetic_marking ?? rng.pick(['P12','A25','M50','R3','C3','','']);
  const reference=appearance?Object.fromEntries(['id','source_url','source_pdf_sha256','declared','assumptions'].map(k=>[k,structuredClone(appearance[k])])):null;
  const common={sourceFamily:fam,seed,appearanceReference:reference,sampling:{revision:'source_product_priors_v46',split,curated:!!appearance,appearanceProbability,productIndex:index},productKey:`${split}:${appearance?.id ?? 'procedural'}:${seed}:${index}`};
  if(fam==='hard_capsule') {
    let capName=colorName,bodyName=colorName;
    if(!ap){capName=rng.pick(rng.chance(.35)?NEUTRALS.slice(0,3):CAPSULE_COLORS);bodyName=rng.chance(.65)?rng.pick(['white','cream',...CAPSULE_COLORS]):capName;color=shade(rng,capName);second=bodyName===capName?color.slice():shade(rng,bodyName);}
    return validate(C({...common,length,width,ovality:thickness/width,capColor:color,capColorName:capName,bodyColor:second,bodyColorName:bodyName,capFraction:.5,capWall:width*.0175,print:{text:marking},scuffs:rng.uniform(.15,1.3)}));
  }
  if(fam==='softgel') {
    const prof=rng.weighted(SOFTGEL_PROFILES,SOFTGEL_PROFILES.map(p=>p[5]));
    let [name,opacity,transmission,dens,rough]=prof,shape=rng.weighted(['round','oval','oblong'],[23,49,28]),straight=0;
    if(shape==='round'){length=rng.uniform(5.5,9.5);width=length*rng.uniform(.94,1);thickness=width*rng.uniform(.88,1);}
    else if(shape==='oval'){length=rng.uniform(9,18);width=length*rng.uniform(.53,.76);thickness=width*rng.uniform(.78,.97);}
    else{length=rng.uniform(12,22);width=length*rng.uniform(.32,.47);thickness=width*rng.uniform(.83,1);straight=rng.uniform(.34,.55);}
    let twoTone=name==='brown_red'&&rng.chance(.52);color=shade(rng,name);second=twoTone?shade(rng,'off_white'):color.slice();
    if(twoTone){opacity='opaque';transmission=0;dens=[0,0];}
    if(ap){length=ap.length_mm;width=ap.width_mm;thickness=ap.height_mm;color=ap.color.slice();second=ap.secondary_color.slice();name=appearance.declared.color;twoTone=JSON.stringify(color)!==JSON.stringify(second);shape=length/width<1.15?'round':'oval';straight=0;opacity=/opaque|undurchsichtig/i.test(JSON.stringify(appearance.declared))?'opaque':'transparent';transmission=opacity==='opaque'?0:1;dens=transmission?[70,210]:[0,0];}
    return validate(S({...common,shape,length,width,thickness,straight,color,colorName:name,secondColor:second,twoTone,opacity,transmission,density:rng.uniform(...dens),roughness:rng.uniform(...rough),seamWidth:rng.uniform(.055,.16),seamRelief:rng.uniform(.005,.024),asymmetry:rng.uniform(.001,.012),print:{text:marking}}));
  }
  const shapeMap={round_flat:'round',round_biconvex:'round',oval_tablet:'oval',caplet:'caplet',oblong_tablet:'oblong',triangular_tablet:'polygon',diamond_tablet:'diamond',hexagonal_tablet:'polygon',ring_tablet:'ring',unknown_shape:'lobed'};
  const outline=ap?.outline_variant==='heart'?'heart':shapeMap[fam];
  const score=['ring_tablet'].includes(fam)?0:ap?.score ?? rng.weighted([0,1,2],[42,50,8]);
  const scoreLayout=ap?.score_layout==='auto'||!ap?.score_layout?(score===2?'cross':'single'):ap.score_layout;
  const imprintLayout=rng.pick(['text','text','cross','stacked','boxed','symbol_code']);
  const hasImprint=marking&& !['ring_tablet','unknown_shape'].includes(fam)&&rng.chance(.7);
  const layout=hasImprint?(rng.chance(.7)?imprintLayout:'text'):'none';
  let text=marking;if(layout==='cross')text=rng.pick(['MED','METER','TAT']);else if(layout==='stacked')text=rng.pick(['AB/125','M/25','RX/50']);else if(layout==='boxed')text=rng.pick(['M','A','8']);else if(layout==='symbol_code')text=rng.pick(['25','50','AB']);
  return validate(T({...common,outline,outlineProfile:'source_v46',sides:fam==='triangular_tablet'?3:6,length,width,thickness,
    crownHeight:thickness*({round_flat:.018,round_biconvex:.13,oval_tablet:.13}[fam]??.075),rimWidth:0,
    finish,color,colorName,speckles:ap?.speckles??0,
    score:{count:score,layout:scoreLayout,width:rng.uniform(.14,.70),depth:rng.uniform(.06,.24),reach:1,faces:ap?.score_faces??'top'},
    imprint:{layout,text,font:rng.pick(['sans','serif','mono']),span:score?Math.min(length*.29,width*.56):Math.min(length,width)*rng.uniform(.55,.78),depth:rng.uniform(.07,.17),offsetX:score?length*.22:0,offsetY:score===2?width*.18:0,rotation:0,symbol:rng.pick(['diamond','shield','triangle','circle']),wear:rng.uniform(0,.4)},
    pores:null,pressDefects:finish==='chalky'?rng.uniform(.4,1.3):rng.uniform(.1,.5),breakoutDensity:rng.uniform(.008,.065),breakoutSize:rng.uniform(.11,.22),
  }));
}

// Per-instance microvariation: same product, different chips/seeds.
export function instanceVariant(spec, rng, damageProb) {
  const s = structuredClone(spec);
  s.seed = rng.int(1, 1e6);
  if(s.sampling?.revision==='source_product_priors_v46') {
    s.texture=rng.uniform(.65,1.4);s.grainScale=rng.uniform(.7,1.5);s.powder=rng.uniform(.15,1.1);
    if(s.kind==='tablet'){
      s.roughness=rng.uniform(...({chalky:[.75,.94],matte_film:[.58,.77],satin_film:[.42,.6]}[s.finish]));
      if(s.outline!=='ring'&&rng.chance(.35)){s.rimWidth=triangular(rng,.08,.55,.16);s.crownHeight=s.thickness*triangular(rng,.025,.18,.065);s.crownCurve=rng.uniform(1.2,2);s.crownBlend=rng.uniform(.02,.18);}
    }
  }
  if (s.kind === 'tablet' && s.outline !== 'ring') {
    s.damage = { ...s.damage, seed: rng.int(1, 1e6), chips: 0, fracture: false };
    if (rng.chance(damageProb)) {
      if (rng.chance(.55)) s.damage.chips = rng.int(1, 2);
      else s.damage.fracture = true;
      s.damage.chipSize = rng.uniform(.1, .2);
      s.damage.tilt = rng.uniform(-30, 30);
    }
  }
  return s;
}

export function familyOf(spec) {
  if (spec.kind === 'capsule') return 'hard_capsule';
  if (spec.kind === 'softgel') return 'softgel_' + spec.shape;
  return spec.outline === 'polygon' ? `polygon_${spec.sides}` : spec.outline + '_tablet';
}
