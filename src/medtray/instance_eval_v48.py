"""Frozen-protocol instance evaluation shared by v4.8 training and evaluation.

Grid: original GT resized directly (nearest) to 512x256; predictions from the 640x320 model grid
resized once to 512x256; visible GT >= 10 px; class-agnostic Hungarian matching at IoU >= 0.50
(medtray.metrics.match_instances, as v4.7). Split/merge are object-level diagnostics:
  split  (v4.7 capsule-diagnosis definition) >=2 predicted masks each cover >=20% and >=10 px of one
         GT object, and >=50% of each of those predictions lies inside it.
  merged one predicted mask covers >=20% and >=10 px of this GT object and of at least one other.
  touching  the object's original-resolution mask, dilated by one pixel (3x3), meets another pill.
"""
import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation
from .metrics import match_instances
from . import tf_panoptic_v47 as v47

GRID=(512,256)


def to_grid(a,min_pixels=10):
    """Resize a 640x320 map once to the evaluation grid; drop predicted IDs below 10 px there."""
    g=np.array(Image.fromarray(a).resize(GRID,Image.Resampling.NEAREST))
    if min_pixels and g.dtype!=np.uint8:
        ids,counts=np.unique(g,return_counts=True);small=ids[(ids>0)&(counts<min_pixels)]
        if len(small):g[np.isin(g,small)]=0
    return g


def size_bin(area):
    return 'tiny 10-29px' if area<30 else 'small 30-99px' if area<100 else '100+px'


class GTCache:
    def __init__(self):self.cache={}
    def __call__(self,it):
        key=str(it['path'])
        if key not in self.cache:self.cache[key]=gt_record(it)
        return self.cache[key]


def gt_record(it):
    ids=it['ids'].astype(np.int32);sem=it['sem'];fg=(sem>=2)&(sem<14)
    grid=np.array(Image.fromarray(ids).resize(GRID,Image.Resampling.NEAREST));gsem=np.array(Image.fromarray(sem).resize(GRID,Image.Resampling.NEAREST))
    pill=(gsem>=2)&(gsem<14);grid[~pill]=0
    meta={o['instance_id']:o for o in it['meta']['objects']};objects={}
    for iid,area in zip(*np.unique(grid[grid>0],return_counts=True)):
        if area<10:continue
        ob=meta[int(iid)];m=(ids==iid)&fg;yy,xx=np.where(m);touch=False
        if len(xx):
            a,b,c,d=max(xx.min()-2,0),max(yy.min()-2,0),xx.max()+3,yy.max()+3
            dil=binary_dilation(m[b:d,a:c],np.ones((3,3),bool));other=fg[b:d,a:c]&(ids[b:d,a:c]!=iid)&(ids[b:d,a:c]>0)
            touch=bool((dil&other).any())
        two=None
        if ob['family']=='hard_capsule':two=bool(np.max(np.abs(np.array(ob['color'])-np.array(ob['secondary_color'])))>.02)
        objects[int(iid)]=dict(area=int(area),family=ob['family'],class_id=ob['class_id'],touching=touch,capsule_two_tone=two,
                               color_family=ob.get('color_family','unknown'),stacked=bool(ob.get('stacked',False)))
    return dict(ids=grid,sem_pill=pill,objects=objects)


def overlaps(gt,pred):
    """Intersection table between GT and predicted IDs on the evaluation grid."""
    gi=np.unique(gt);pi=np.unique(pred);gm={g:i for i,g in enumerate(gi)};pm={p:i for i,p in enumerate(pi)}
    code=np.searchsorted(gi,gt)*len(pi)+np.searchsorted(pi,pred)
    inter=np.bincount(code.ravel(),minlength=len(gi)*len(pi)).reshape(len(gi),len(pi))
    return gi,pi,inter


def scene_eval(it,gt,pred,obs):
    """One scene: v4.7 match row plus per-object split/merge/touching records."""
    row=match_instances(gt['ids'],pred,10);truth={o['instance_id']:o for o in it['meta']['objects']};byid={o['instance_id']:o for o in obs}
    row['scene']=it['path'].stem;row['correct_family']=sum(truth[g]['class_id']==byid[p]['class_id'] for g,p,_ in row['pairs'] if p in byid)
    gi,pi,inter=overlaps(gt['ids'],pred);parea=inter.sum(0);matched={g:(p,iou) for g,p,iou in row['pairs']}
    cover=np.zeros_like(inter,bool)
    for i,g in enumerate(gi):
        if g and g in gt['objects']:cover[i]=(inter[i]>=10)&(inter[i]>=.2*gt['objects'][g]['area'])
    cover[:,pi==0]=False;covered=cover.sum(0)
    objs=[]
    for i,g in enumerate(gi):
        if not g or g not in gt['objects']:continue
        o=dict(gt['objects'][g]);area=o['area']
        parts=[j for j in range(len(pi)) if pi[j] and inter[i,j]>=10 and inter[i,j]>=.2*area and inter[i,j]>=.5*parea[j]]
        o.update(scene=row['scene'],iid=int(g),matched=g in matched,iou=matched.get(g,(0,0.))[1],split=len(parts)>=2,
                 merged=bool(any(cover[i,j] and covered[j]>=2 for j in range(len(pi)))),size_bin=size_bin(area),
                 best_iou=float(max([inter[i,j]/(area+parea[j]-inter[i,j]) for j in range(len(pi)) if pi[j]],default=0.)))
        objs.append(o)
    row['merged_predictions']=int(sum(covered>=2));row['unmatched_predictions']=row['fp']
    return row,objs


def rate(objs,key):
    return dict(n=len(objs),**{k:sum(o[k] for o in objs) for k in ['matched','split','merged']},missed=sum(not o['matched'] for o in objs),
                recall=sum(o['matched'] for o in objs)/len(objs) if objs else None,matched_mean_iou=float(np.mean([o['iou'] for o in objs if o['matched']])) if any(o['matched'] for o in objs) else None)


def summary(rows,objs):
    s=v47.summary(rows);tp=[o['iou'] for o in objs if o['matched']]
    s['matched_mean_iou']=float(np.mean(tp)) if tp else 0.;s['panoptic_quality_style']=s['matched_mean_iou']*s['instance_f1_iou50']
    s['objects']=rate(objs,'all');s['merged_prediction_masks']=sum(r['merged_predictions'] for r in rows)
    s['size_bins']={b:rate([o for o in objs if o['size_bin']==b],b) for b in ['tiny 10-29px','small 30-99px','100+px']}
    s['touching']=rate([o for o in objs if o['touching']],'t');s['isolated']=rate([o for o in objs if not o['touching']],'i')
    caps=[o for o in objs if o['capsule_two_tone'] is not None]
    s['capsules']=dict(two_tone=rate([o for o in caps if o['capsule_two_tone']],'2'),single_color=rate([o for o in caps if not o['capsule_two_tone']],'1'))
    empty=[r for r in rows if not r['gt_count']];s['empty_false_positives']=sum(r['pred_count'] for r in empty);s['empty_clean']=sum(r['pred_count']==0 for r in empty)
    return s
