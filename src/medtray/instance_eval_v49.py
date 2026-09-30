"""v4.9 diagnostics layered on the unchanged v4.8/v4.7 headline evaluator.

Headline numbers (TP/FP/FN, F1, count error, split/merged/missed) come from instance_eval_v48 unchanged.
Added per object / per scene:
  merge_kind       'absorbed_missed' = merged flag AND not matched (true absorbed neighbour);
                   'neighbour_covering_matched' = merged flag but the pill itself is matched.
  capsule coverage matched_coverage = |matched mask ∩ GT| / |GT|; halves = GT capsule split at the median of its
                   principal-axis projection; worst_half = min coverage of the two halves by the matched mask;
                   whole_capsule = matched AND worst_half >= 0.5; undercovered = matched AND matched_coverage < 0.8.
  fragments        other predicted masks with >=3 px inside the capsule and >=50% of their own pixels inside it
                   that are NOT counted by the split rule (coverage <20% or <10 px): leftover sub-threshold pieces.
  print FPs        unmatched predictions tagged as in evaluate_v47 (real-object mismatch / print-associated / other).
"""
import numpy as np
from PIL import Image
from . import instance_eval_v48 as ev48

GRID=ev48.GRID
to_grid=ev48.to_grid


def halves(mask):
    yy,xx=np.where(mask)
    if len(xx)<4:return mask,np.zeros_like(mask)
    pts=np.stack([xx,yy],1).astype(np.float32);c=pts.mean(0);_,_,vt=np.linalg.svd(pts-c,full_matrices=False)
    proj=(pts-c)@vt[0];cut=np.median(proj);a=np.zeros_like(mask);b=np.zeros_like(mask)
    a[yy[proj<=cut],xx[proj<=cut]]=True;b[yy[proj>cut],xx[proj>cut]]=True
    return a,b


class GTCache(ev48.GTCache):
    def __call__(self,it):
        key=str(it['path'])
        if key not in self.cache:
            rec=ev48.gt_record(it)
            ids=np.array(Image.fromarray(it['ids'].astype(np.int32)).resize(GRID,Image.Resampling.NEAREST))
            printids=[g['instance_id'] for g in it['meta'].get('printed_graphics',[]) if g['kind']!='sticker_paper']
            rec['print']=np.isin(ids,printids);self.cache[key]=rec
        return self.cache[key]


def scene_eval(it,gt,pred,obs):
    row,objs=ev48.scene_eval(it,gt,pred,obs)
    gi,pi,inter=ev48.overlaps(gt['ids'],pred);parea=inter.sum(0);gpos={g:i for i,g in enumerate(gi)};ppos={p:j for j,p in enumerate(pi)}
    matched={g:p for g,p,_ in ev48.match_instances(gt['ids'],pred,10)['pairs']}
    for o in objs:
        o['merge_kind']=('neighbour_covering_matched' if o['matched'] else 'absorbed_missed') if o['merged'] else None
        if o['capsule_two_tone'] is None:continue
        i=gpos[o['iid']];area=o['area'];gm=gt['ids']==o['iid'];p=matched.get(o['iid'])
        o['matched_coverage']=float(inter[i,ppos[p]]/area) if p else 0.
        if p:
            h1,h2=halves(gm);pm=pred==p;o['worst_half']=float(min((h1&pm).sum()/max(h1.sum(),1),(h2&pm).sum()/max(h2.sum(),1)))
        else:o['worst_half']=0.
        o['whole_capsule']=bool(p) and o['worst_half']>=.5;o['undercovered']=bool(p) and o['matched_coverage']<.8
        frag=0
        for j,q in enumerate(pi):
            if not q or q==p:continue
            n=inter[i,j]
            if n>=3 and n>=.5*parea[j] and not (n>=10 and n>=.2*area):frag+=1
        o['fragments']=frag
        o['union_coverage']=float(sum(inter[i,j] for j,q in enumerate(pi) if q and inter[i,j]>=.5*parea[j])/area)
    tags={'real-object segmentation mismatch':0,'print-associated':0,'background/other':0};mp=set(matched.values())
    for q in pi:
        if not q or q in mp:continue
        m=pred==q;rf=(m&(gt['ids']>0)).sum()/m.sum();pf=(m&gt['print']).sum()/m.sum() if 'print' in gt else 0.
        tags['real-object segmentation mismatch' if rf>=.25 else 'print-associated' if pf>=.1 else 'background/other']+=1
    row['fp_tags']=tags
    return row,objs


def _caps(objs):
    n=len(objs);m=[o for o in objs if o['matched']]
    return dict(n=n,matched=len(m),split=sum(o['split'] for o in objs),merged=sum(o['merged'] for o in objs),missed=n-len(m),split_plus_missed=sum(o['split'] for o in objs)+n-len(m),
        whole_capsule=sum(o['whole_capsule'] for o in objs),undercovered=sum(o['undercovered'] for o in objs),with_fragments=sum(o['fragments']>0 for o in objs),fragments=sum(o['fragments'] for o in objs),
        mean_matched_coverage=float(np.mean([o['matched_coverage'] for o in m])) if m else None,mean_worst_half=float(np.mean([o['worst_half'] for o in m])) if m else None)


def summary(rows,objs):
    s=ev48.summary(rows,objs)
    s['merge_kinds']=dict(absorbed_missed=sum(o.get('merge_kind')=='absorbed_missed' for o in objs),neighbour_covering_matched=sum(o.get('merge_kind')=='neighbour_covering_matched' for o in objs))
    caps=[o for o in objs if o['capsule_two_tone'] is not None]
    s['capsules_v49']=dict(two_tone=_caps([o for o in caps if o['capsule_two_tone']]),single_color=_caps([o for o in caps if not o['capsule_two_tone']]))
    t={}
    for r in rows:
        for k,v in r.get('fp_tags',{}).items():t[k]=t.get(k,0)+v
    s['fp_tags']=t;empty=[r for r in rows if not r['gt_count']]
    s['empty_print_fp']=sum(r.get('fp_tags',{}).get('print-associated',0) for r in empty)
    return s
