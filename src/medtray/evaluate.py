"""Instance counts, matched appearance accuracy, and conditions on held-out synthetic scenes."""
import argparse
import json
from collections import defaultdict
from pathlib import Path
import numpy as np
from PIL import Image
from .infer import load,predict,overlay
from .metrics import match_instances


def summarize(rows):
    tp=sum(r['tp'] for r in rows);fp=sum(r['fp'] for r in rows);fn=sum(r['fn'] for r in rows)
    return {'images':len(rows),'instance_precision_iou50':tp/max(tp+fp,1),'instance_recall_iou50':tp/max(tp+fn,1),'instance_f1_iou50':2*tp/max(2*tp+fp+fn,1),'count_mae':float(np.mean([abs(r['count_error']) for r in rows])) if rows else None,'exact_count_rate':float(np.mean([r['count_error']==0 for r in rows])) if rows else None,'matched_family_accuracy':sum(r['correct_family'] for r in rows)/max(tp,1),'confident_matched_precision':sum(r['confident_correct'] for r in rows)/max(sum(r['confident_matched'] for r in rows),1),'confident_matched_count':sum(r['confident_matched'] for r in rows)}


def main():
    p=argparse.ArgumentParser();p.add_argument('--data',type=Path,default=Path('artifacts/dataset-v2'));p.add_argument('--run',type=Path,default=Path('artifacts/run'));a=p.parse_args();m,c,d=load(a.run/'best.pt');allresults={}
    for split in ['test','stress']:
        rows=[];by=defaultdict(list);gallery=a.run/split;gallery.mkdir(exist_ok=True)
        for i,f in enumerate(sorted((a.data/split).glob('[0-9]*.json'))):
            meta=json.loads(f.read_text());im=Image.open(f.with_suffix('.png')).convert('RGB');sem,ids,obs,prob=predict(m,im,c['size'],d)
            gt=np.array(Image.open(f.with_name(f.stem+'_instance.png')));truth={o['instance_id']:o for o in meta['objects'] if 2<=o['class_id']<=13};gt[~np.isin(gt,list(truth))]=0
            r=match_instances(gt,ids,min_area=16);r['scene']=f.stem;r['correct_family']=r['confident_correct']=r['confident_matched']=0
            predictions={o['instance_id']:o for o in obs}
            for gid,pid,iou in r['pairs']:
                correct=truth[gid]['class_id']==predictions[pid]['class_id'];r['correct_family']+=correct
                if predictions[pid]['confidence']>=.7:r['confident_matched']+=1;r['confident_correct']+=correct
            for key in ['lighting','background_material','container_material']:
                r[key]=meta[key];by[f'{key}:{meta[key]}'].append(r)
            r['film']=meta['transparent_film'];by[f'film:{r["film"]}'].append(r);rows.append(r)
            if i<12:overlay(im,sem,obs).save(gallery/f'{f.stem}_prediction.png');Image.fromarray(sem).save(gallery/f'{f.stem}_pred_semantic.png')
        # Save additional worst/best cases selected by measured instance errors.
        ordered=sorted(rows,key=lambda r:(r['fp']+r['fn']+r['tp']-r['correct_family']),reverse=True)
        for row in ordered[:6]+ordered[-4:]:
            predpath=gallery/(row['scene']+'_prediction.png')
            if not predpath.exists():
                imagepath=a.data/split/(row['scene']+'.png');im=Image.open(imagepath).convert('RGB');sem,ids,obs,prob=predict(m,im,c['size'],d);overlay(im,sem,obs).save(predpath);Image.fromarray(sem).save(gallery/(row['scene']+'_pred_semantic.png'))
        allresults[split]={'aggregate':summarize(rows),'by_condition':{k:summarize(v) for k,v in by.items()},'scenes':rows};print(split,json.dumps(allresults[split]['aggregate']),flush=True)
    (a.run/'instance_metrics.json').write_text(json.dumps(allresults,indent=2))
if __name__=='__main__':main()
