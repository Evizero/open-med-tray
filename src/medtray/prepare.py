"""Convert Blender multipart EXRs to RGB and exact integer labels, and audit splits."""
import argparse
import json
from pathlib import Path
import numpy as np
import OpenEXR
from PIL import Image

ROOT=Path(__file__).resolve().parents[2]
CLASSES=json.loads((ROOT/'configs/classes.json').read_text())
PALETTE=np.array([c['color'] for c in CLASSES],dtype=np.uint8)


def channels(path):
    f=OpenEXR.File(str(path))
    return {k:v.pixels for p in f.parts for k,v in p.channels.items()}


def convert(path):
    meta=json.loads(path.with_suffix('.json').read_text());c=channels(path)
    if 'Beauty.Combined' not in c:c.update(channels(path.with_suffix('.beauty.exr')))
    rgb=c['Beauty.Combined'][...,:3]
    # Filmic compression retains highlights; camera augmentations are added during training.
    rgb=np.maximum(rgb,0)
    if meta.get('schema_version',1)>=2:
        # Simulated metering prevents white plastic from clipping under direct sunlight.
        luminance=rgb@np.array([.2126,.7152,.0722]);exposure=.72/max(float(np.quantile(luminance,.95)),.05);rgb*=exposure
        meta['camera_exposure_multiplier']=exposure
    rgb=(rgb*(2.51*rgb+.03))/(rgb*(2.43*rgb+.59)+.14)
    rgb=np.where(rgb<=.0031308,12.92*rgb,1.055*rgb**(1/2.4)-.055)
    rgb=np.round(np.clip(rgb,0,1)*255).astype(np.uint8)
    camera_response=None
    if meta.get('config',{}).get('revision',45)>=46:
        from .camera_response import apply_camera_response
        rgb,camera_response=apply_camera_response(rgb,meta['seed'],meta.get('config',{}).get('camera_profile'))
        meta['camera_response']=camera_response
    raw=c['Labels.Object Index.X'];ids=np.rint(raw).astype(np.uint16)
    assert np.allclose(ids,raw,atol=1e-5), 'Nonintegral instance labels'
    lookup={int(k):v for k,v in meta['instance_to_class'].items()}
    missing=set(np.unique(ids).tolist())-set(lookup)
    if missing:raise ValueError(f'Unmapped object IDs {missing}')
    sem=np.zeros(ids.shape,dtype=np.uint8)
    for iid,cls in lookup.items():sem[ids==iid]=cls
    beauty_ids=np.rint(c['Beauty.Object Index.X']).astype(np.uint16)
    film=(beauty_ids==2).astype(np.uint8)
    depth=c['Labels.Depth.Z'].astype(np.float32)
    if camera_response is not None:
        glare=((rgb.astype(float).mean(-1)>242)&(film>0)).astype(np.uint8)
        Image.fromarray(glare*255).save(path.with_name(path.stem+'_glare.png'))
        meta['glare_diagnostic']={'cover_bright_pixel_fraction':float(glare.sum()/max(film.sum(),1)),'method':'Mean tone-mapped RGB > 242 on Beauty cover ID; brightness heuristic, not optical visibility'}
    Image.fromarray(rgb).save(path.with_suffix('.png'))
    Image.fromarray(sem).save(path.with_name(path.stem+'_semantic.png'))
    Image.fromarray(ids).save(path.with_name(path.stem+'_instance.png'))
    Image.fromarray(film*255).save(path.with_name(path.stem+'_film.png'))
    Image.fromarray(PALETTE[sem]).save(path.with_name(path.stem+'_colors.png'))
    np.save(path.with_name(path.stem+'_depth.npy'),depth)
    if meta.get('printed_graphics'):
        print_ids=[o['instance_id'] for o in meta['printed_graphics'] if o['kind']!='sticker_paper']
        sticker_ids=[o['instance_id'] for o in meta['printed_graphics'] if o['kind'].startswith('sticker_')]
        Image.fromarray(np.isin(ids,sticker_ids).astype(np.uint8)*255).save(path.with_name(path.stem+'_sticker.png'))
        Image.fromarray(np.isin(ids,print_ids).astype(np.uint8)*255).save(path.with_name(path.stem+'_print.png'))
        exact_print=np.zeros(ids.shape,np.uint16)
        exact_print[np.isin(ids,print_ids)]=ids[np.isin(ids,print_ids)]
        Image.fromarray(exact_print).save(path.with_name(path.stem+'_print_instance.png'))
        for graphic in meta['printed_graphics']:
            yy,xx=np.where(ids==graphic['instance_id'])
            graphic['visible_pixels']=len(xx)
            graphic['bbox_xyxy']=[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)] if len(xx) else None
    for obj in meta['objects']:
        mask=ids==obj['instance_id'];ys,xs=np.where(mask)
        obj['visible_pixels']=int(mask.sum())
        if camera_response is not None:obj['glare_pixel_fraction']=float(glare[mask].mean()) if mask.any() else None
        obj['bbox_xyxy']=[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)] if len(xs) else None
    meta['quality']={'pill_pixels':int(((sem>=2)&(sem<=13)).sum()),'film_coverage':float(film.mean()),'mean_brightness':float(rgb.mean()/255),'invisible_objects':sum(o['visible_pixels']==0 for o in meta['objects'])}
    path.with_suffix('.json').write_text(json.dumps(meta,indent=2))
    return meta


def audit(root):
    stats={};seedsets={};failures=[]
    for split in ['train','val','test','stress']:
        files=sorted((root/split).glob('[0-9]*.json'))
        hist=np.zeros(len(CLASSES),dtype=np.int64);inst=np.zeros(len(CLASSES),dtype=np.int64)
        seeds=[];empty=film=chips=stacked=invisible=0;brightness=[]
        for f in files:
            m=json.loads(f.read_text());seeds.append(m['seed'])
            a=np.array(Image.open(f.with_name(f.stem+'_semantic.png')))
            ids=np.array(Image.open(f.with_name(f.stem+'_instance.png')))
            hist+=np.bincount(a.ravel(),minlength=len(CLASSES))
            for o in m['objects']:
                inst[o['class_id']]+=1;chips+=bool(o.get('chip',0));stacked+=bool(o.get('stacked',False));invisible+=o.get('visible_pixels',0)==0
                if np.any(a[ids==o['instance_id']]!=o['class_id']):failures.append(f'label mismatch: {f}')
            empty+=not m['objects'];film+=m['transparent_film'];brightness.append(m['quality']['mean_brightness'])
        if len(seeds)!=len(set(seeds)):failures.append(f'duplicate seed: {split}')
        seedsets[split]=set(seeds)
        stats[split]={'images':len(files),'objects':int(inst.sum()),'class_pixels':hist.tolist(),'class_instances':inst.tolist(),'empty_scenes':empty,'film_scenes':film,'chipped_objects':chips,'stacked_objects':stacked,'invisible_objects':invisible,'mean_brightness':float(np.mean(brightness)) if brightness else None}
    for a in seedsets:
        for b in seedsets:
            if a<b and seedsets[a]&seedsets[b]:failures.append(f'seed leakage: {a}/{b}')
    result={'splits':stats,'failures':failures,'passed':not failures,'note':'Semantic labels are geometric surfaces with film removed; refraction causes RGB/label disagreement. Invisible objects are recorded but excluded from visible-count targets.'}
    (root/'quality.json').write_text(json.dumps(result,indent=2));return result


def main():
    p=argparse.ArgumentParser();p.add_argument('root',type=Path);p.add_argument('--audit-only',action='store_true');a=p.parse_args()
    if not a.audit_only:
        for f in sorted(a.root.glob('*/*.exr')):
            if f.stem.endswith('.beauty'):continue
            if not f.with_suffix('.png').exists():convert(f)
    print(json.dumps(audit(a.root),indent=2))
if __name__=='__main__':main()
