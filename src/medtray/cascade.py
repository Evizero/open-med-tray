"""End-to-end segmentation + attribute classification on predicted instance crops."""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image,ImageOps
import torch
from .attributes import PillEncoder,FINISHES,MARKINGS
from .infer import load,predict,overlay
from .metrics import semantic_metrics,match_instances
from .evaluate import summarize


def load_attributes(checkpoint,device):
    state=torch.load(checkpoint,map_location='cpu',weights_only=False);m=PillEncoder().to(device);m.load_state_dict(state['model']);m.eval();return m


def classify_instances(model,device,image,ids,observations,mm_per_pixel=None):
    if not observations:return observations
    xs=[];cal=[]
    for o in observations:
        x0,y0,x1,y1=o['bbox_xyxy'];x0=max(0,x0-3);y0=max(0,y0-3);x1=min(image.width,x1+3);y1=min(image.height,y1+3)
        im=ImageOps.pad(image.crop((x0,y0,x1,y1)),(96,96),method=Image.Resampling.BILINEAR,color=(114,114,114));mk=ImageOps.pad(Image.fromarray((ids[y0:y1,x0:x1]==o['instance_id']).astype(np.uint8)*255),(96,96),method=Image.Resampling.NEAREST,color=0)
        xs.append(np.concatenate([np.array(im,dtype=np.float32)/255,np.array(mk,dtype=np.float32)[...,None]/255],2).transpose(2,0,1));cal.append([(mm_per_pixel or .3)/.5,(x1-x0)/100,(y1-y0)/100])
    with torch.inference_mode():out=model(torch.from_numpy(np.stack(xs)).to(device),torch.tensor(cal,dtype=torch.float32,device=device));probs=out['family'].softmax(1).cpu().numpy()
    results=[]
    for i,o in enumerate(observations):
        cls=int(probs[i].argmax())+2;confidence=float(probs[i].max());r=dict(o);r.update(segmentation_class_id=o['class_id'],segmentation_confidence=o['confidence'],class_id=cls,class_name=['round_flat','round_biconvex','oval_tablet','caplet','hard_capsule','softgel','oblong_tablet','triangular_tablet','diamond_tablet','hexagonal_tablet','ring_tablet','unknown_shape'][cls-2],confidence=confidence,uncertain=confidence<.7 or cls==13)
        r['attributes']={'finish':FINISHES[int(out['finish'][i].argmax())],'color_linear_rgb':out['color'][i,:3].cpu().tolist(),'score_lines':int(out['score'][i].argmax()),'damage_candidate':bool(out['damage'][i].argmax()),'partial_tablet_candidate':bool(out['fraction'][i].argmax()),'marking_candidate':MARKINGS[int(out['marking'][i].argmax())],'marking_general_ocr':False,'dimensions_mm':(out['dimensions'][i].exp()*10).cpu().tolist() if mm_per_pixel else None}
        results.append(r)
    return results


def main():
    p=argparse.ArgumentParser();p.add_argument('--data',type=Path,default=Path('artifacts/dataset-v2'));p.add_argument('--run',type=Path,default=Path('artifacts/run'));p.add_argument('--embedding',type=Path,default=Path('artifacts/embedding/best.pt'));a=p.parse_args();seg,c,d=load(a.run/'best.pt');attr=load_attributes(a.embedding,d);results={}
    for split in ['test','stress']:
        conf=np.zeros((16,16),np.int64);rows=[];gallery=a.run/(split+'-cascade');gallery.mkdir(exist_ok=True)
        for i,f in enumerate(sorted((a.data/split).glob('[0-9]*.json'))):
            meta=json.loads(f.read_text());im=Image.open(f.with_suffix('.png')).convert('RGB');sem,ids,obs,prob=predict(seg,im,c['size'],d);obs=classify_instances(attr,d,im,ids,obs)
            for o in obs:sem[ids==o['instance_id']]=o['class_id']
            truth_sem=np.array(Image.open(f.with_name(f.stem+'_semantic.png')));conf+=np.bincount((truth_sem.astype(int)*16+sem).ravel(),minlength=256).reshape(16,16)
            gt=np.array(Image.open(f.with_name(f.stem+'_instance.png')));truth={o['instance_id']:o for o in meta['objects'] if 2<=o['class_id']<=13};gt[~np.isin(gt,list(truth))]=0;r=match_instances(gt,ids,min_area=16);pred={o['instance_id']:o for o in obs};r.update(scene=f.stem,correct_family=0,confident_correct=0,confident_matched=0)
            for gid,pid,iou in r['pairs']:
                good=truth[gid]['class_id']==pred[pid]['class_id'];r['correct_family']+=good
                if pred[pid]['confidence']>=.7:r['confident_matched']+=1;r['confident_correct']+=good
            rows.append(r)
            if i<12:overlay(im,sem,obs).save(gallery/f'{f.stem}_prediction.png')
        results[split]={'semantic':semantic_metrics(conf),'instances':summarize(rows),'scenes':rows};np.save(a.run/f'{split}_cascade_confusion.npy',conf);print(split,json.dumps({k:v for k,v in results[split].items() if k!='scenes'}),flush=True)
    results['scope']='Synthetic end-to-end segmentation plus rich-attribute encoder on predicted masks, no oracle instance crops';(a.run/'cascade_metrics.json').write_text(json.dumps(results,indent=2))
if __name__=='__main__':main()
