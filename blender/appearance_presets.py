"""Curated source descriptions mapped to explicit, unverified appearance priors."""
import json, random
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
DEFAULT_PATH=ROOT/'configs/appearance-presets.json'
if not DEFAULT_PATH.exists():DEFAULT_PATH=Path(__file__).resolve().parent/'appearance-presets.json'
def load_presets(path=None):
    source = Path(path) if path else DEFAULT_PATH
    if not source.is_absolute():
        source = ROOT / source
    return json.loads(source.read_text())
def make_appearance(preset_or_id, idx=10, with_marking=True, marking_options=None):
    import generate as G
    from pill_surface import pill_material,PRESETS
    if isinstance(preset_or_id,str):
        row=next(r for r in load_presets() if r['id']==preset_or_id)
    else:row=preset_or_id
    p=row['parameters'];finish=p['finish'];seed=p['seed']
    kw=dict(seed=seed,grain_um=PRESETS[finish]['grain_um']*p['grain_multiplier'],speckles=p.get('speckles',0))
    m=pill_material(row['id']+' body',p['color'],finish,**kw)
    cap=pill_material(row['id']+' cap',p['secondary_color'],finish,seed=seed+1)
    l,w,h=[p[k]/1000 for k in ['length_mm','width_mm','height_mm']]
    obj=G.make_pill(p['family'],l,w,h,m,cap,idx,random.Random(seed),score=p['score'],outline_variant=p['outline_variant'],score_layout=p['score_layout'],score_faces=p['score_faces'],press_defects=p['press_defects'],face_rim_width_mm=p.get('face_rim_width_mm',0),crown_height_mm=p.get('crown_height_mm'),crown_curve=p.get('crown_curve',1.6),crown_edge_blend_mm=p.get('crown_edge_blend_mm',.06))
    obj.name=row['id']+' appearance prior';obj['appearance_preset']=row['id'];obj['appearance_source_url']=row['source_url'];obj['appearance_assumptions_json']=json.dumps(row['assumptions']);obj['nominal_dimensions_mm']=[l*1000,w*1000,h*1000];obj['class_id']=G.FAMILIES.index(p['family'])+2
    obj['drug_identity_verified']=False;obj['synthetic_marking']=p['synthetic_marking'] if with_marking else ''
    if with_marking and p['family'] not in ['hard_capsule','softgel','ring_tablet']:
        # Keep markings fictional. Single-score tablet marking sits away from groove.
        xy=(l*.22,0) if p['score']==1 else (0,w*.20 if p['score']==2 else 0)
        if marking_options:
            from imprint_geometry import imprint
            options=dict(marking_options);text=options.pop('text',p['synthetic_marking']);rendered=imprint(obj,text,**options);obj['synthetic_marking']=text if rendered else ''
        else:rendered=G.deboss(obj,p['synthetic_marking'],min(l*.11,w*.19,.0018),xy=xy,depth_mm=.09)
        if not rendered:obj['synthetic_marking']=''
    elif with_marking and p['family']=='hard_capsule':
        ink=G.material('fictional shell ink',(.025,.03,.035),.58,noise=0)
        mark=G.text_obj(p['synthetic_marking'],(-l*.16,0,h/2+.000012),min(w*.21,.0015),ink,idx)
        mark.parent=obj;mark['synthetic_marking']=True
    return obj
