"""Compare observations to an explicit plan. Never authorizes medication administration."""
from collections import Counter
import math


def inside(point,polygon):
    x,y=point;hit=False
    for a,b in zip(polygon,polygon[1:]+polygon[:1]):
        if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:hit=not hit
    return hit


def compare_plan(instances,plan,image_size,threshold=.7):
    if not 0<=threshold<=1:raise ValueError('threshold must be in [0,1]')
    slots=plan.get('slots')
    if not isinstance(slots,list) or not slots:raise ValueError('plan requires a nonempty slots list')
    names=[s['name'] for s in slots]
    if len(set(names))!=len(names):raise ValueError('slot names must be unique')
    for s in slots:
        if len(s.get('polygon_normalized',[]))<3:raise ValueError('each slot needs a normalized polygon')
        if any(len(p)!=2 or any(not math.isfinite(v) or not 0<=v<=1 for v in p) for p in s['polygon_normalized']):raise ValueError('invalid polygon')
        for item in s.get('expected',[]):
            if not isinstance(item.get('count'),int) or isinstance(item['count'],bool) or item['count']<0:raise ValueError('counts must be nonnegative integers')
            if not 2<=item['class_id']<=13:raise ValueError('expected class must be a pill family')
    observed={n:Counter() for n in names};unresolved=[]
    for o in instances:
        cx,cy=o['centroid_xy'];point=(cx/image_size[0],cy/image_size[1]);matches=[s for s in slots if inside(point,s['polygon_normalized'])]
        if len(matches)!=1:unresolved.append({'instance_id':o['instance_id'],'reason':'outside_or_ambiguous_compartment'});continue
        conf=o.get('confidence')
        if conf is None or not math.isfinite(conf) or conf<threshold or o['class_id']==13:unresolved.append({'instance_id':o['instance_id'],'reason':'uncertain_appearance'});continue
        observed[matches[0]['name']][o['class_id']]+=1
    differences=[]
    for s in slots:
        expected=Counter()
        for item in s.get('expected',[]):expected[item['class_id']]+=item['count']
        for cls in set(expected)|set(observed[s['name']]):
            if expected[cls]!=observed[s['name']][cls]:differences.append({'slot':s['name'],'class_id':cls,'expected':expected[cls],'observed_confident':observed[s['name']][cls]})
    return {'status':'REVIEW_REQUIRED','appearance_count_match':not differences and not unresolved,'differences':differences,'unresolved':unresolved,'observed_by_slot':{n:dict(c) for n,c in observed.items()},'identity_verified':False,'administration_authorized':False,'reason':'Prototype predicts appearance families, not verified medicine/strength/manufacturer. Half-tablet dose equivalence and fully hidden pills are not resolved.'}
