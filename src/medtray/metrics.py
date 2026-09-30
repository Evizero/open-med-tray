import numpy as np
from scipy import ndimage as ndi
from scipy.optimize import linear_sum_assignment
from skimage.feature import peak_local_max
from skimage.segmentation import watershed


def semantic_metrics(confusion):
    c=confusion.astype(float);tp=np.diag(c);union=c.sum(0)+c.sum(1)-tp
    iou=np.divide(tp,union,out=np.zeros_like(tp),where=union>0)
    valid=union>0
    pill=np.arange(2,14)
    # Binary foreground metric correctly merges all pill classes before calculating overlap.
    hit=c[2:14,2:14].sum();gt=c[2:14,:].sum();pred=c[:,2:14].sum()
    return {'mean_iou':float(iou[valid].mean()),'pill_class_mean_iou':float(iou[pill][valid[pill]].mean()) if valid[pill].any() else 0.,'pill_binary_iou':float(hit/max(gt+pred-hit,1)),'per_class_iou':iou.tolist(),'pixel_accuracy':float(tp.sum()/max(c.sum(),1))}


def instances_from_prediction(semantic,prob=None,min_area=10):
    foreground=(semantic>=2)&(semantic<=13)
    foreground=ndi.binary_fill_holes(foreground)
    foreground=ndi.binary_opening(foreground,iterations=1)
    distance=ndi.distance_transform_edt(foreground)
    # Separate touching silhouettes; cannot recover fully occluded pills.
    peaks=peak_local_max(distance,min_distance=5,threshold_abs=1.8,labels=foreground)
    markers=np.zeros(foreground.shape,np.int32)
    for i,(y,x) in enumerate(peaks,1):markers[y,x]=i
    ws=watershed(-distance,markers,mask=foreground)
    results=[];out=np.zeros_like(ws)
    for i in range(1,int(ws.max())+1):
        m=ws==i
        if m.sum()<min_area:continue
        votes=np.bincount(semantic[m],minlength=16);votes[:2]=0;votes[14:]=0;cls=int(votes.argmax())
        conf=float(prob[cls,m].mean()) if prob is not None else None
        ys,xs=np.where(m);iid=len(results)+1;out[m]=iid
        results.append({'instance_id':iid,'class_id':cls,'area_pixels':int(m.sum()),'confidence':conf,'bbox_xyxy':[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)],'centroid_xy':[float(xs.mean()),float(ys.mean())]})
    return out,results


def match_instances(gt_ids,pred_ids,min_area=10):
    gs=[int(g) for g in np.unique(gt_ids) if g and (gt_ids==g).sum()>=min_area]
    ps=[int(p) for p in np.unique(pred_ids) if p]
    ious=np.zeros((len(gs),len(ps)))
    for i,g in enumerate(gs):
        gm=gt_ids==g
        for j,p in enumerate(ps):
            pm=pred_ids==p;ious[i,j]=(gm&pm).sum()/max((gm|pm).sum(),1)
    pairs=[]
    if len(gs) and len(ps):
        rows,cols=linear_sum_assignment(-ious)
        pairs=[(gs[i],ps[j],float(ious[i,j])) for i,j in zip(rows,cols) if ious[i,j]>=.5]
    return {'tp':len(pairs),'fp':len(ps)-len(pairs),'fn':len(gs)-len(pairs),'count_error':len(ps)-len(gs),'gt_count':len(gs),'pred_count':len(ps),'pairs':pairs}
