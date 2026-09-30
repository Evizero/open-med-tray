"""v4.9 tests. Run: PYTHONPATH=src .venv-tf/bin/python tests/test_instance_v49.py (pytest-compatible)."""
import sys,time
from pathlib import Path
import numpy as np
from medtray import instance_eval_v49 as ev


def scene():
    """768x384 original: two-tone capsule id 1 (touching) + round pill id 2 touching its right end."""
    ids=np.zeros((384,768),np.uint16);sem=np.zeros((384,768),np.uint8)
    ids[150:210,150:390]=1;sem[150:210,150:390]=6
    ids[160:200,390:430]=2;sem[160:200,390:430]=3
    meta=dict(objects=[dict(instance_id=1,class_id=6,family='hard_capsule',color=[.9,.9,.9],secondary_color=[.1,.1,.6]),
                       dict(instance_id=2,class_id=3,family='round_biconvex',color=[.9,.9,.9],secondary_color=[.9,.9,.9])],printed_graphics=[])
    return dict(path=Path('00000'),meta=meta,ids=ids,sem=sem)


def grid_masks():
    # 512x256 grid: capsule cols 100-260 rows 100-140; pill cols 260-287 rows 107-133
    return (slice(100,140),slice(100,260)),(slice(107,133),slice(260,287))


def run(pred):
    it=scene();gt=ev.GTCache()(it);obs=[dict(instance_id=int(i),class_id=6) for i in np.unique(pred) if i]
    r,objs=ev.scene_eval(it,gt,pred,obs);return r,{o['iid']:o for o in objs}


def test_whole_capsule_and_no_fragments():
    (cy,cx),(py,px)=grid_masks();p=np.zeros((256,512),np.int32);p[cy,cx]=1;p[py,px]=2
    r,o=run(p);c=o[1];assert r['tp']==2 and c['whole_capsule'] and not c['undercovered'] and c['fragments']==0 and c['merge_kind'] is None


def test_half_mask_is_undercovered_not_whole():
    (cy,cx),(py,px)=grid_masks();p=np.zeros((256,512),np.int32);p[cy,100:190]=1;p[py,px]=2
    r,o=run(p);c=o[1];assert c['matched'] and c['undercovered'] and not c['whole_capsule'] and c['worst_half']<.2


def test_leftover_fragment_counted_but_not_split():
    (cy,cx),(py,px)=grid_masks();p=np.zeros((256,512),np.int32);p[cy,100:245]=1;p[120:122,250:253]=3;p[py,px]=2  # 6 px fragment
    r,o=run(p);c=o[1];assert c['matched'] and not c['split'] and c['fragments']==1


def test_true_absorbed_vs_neighbour_covering():
    (cy,cx),(py,px)=grid_masks();p=np.zeros((256,512),np.int32);p[cy,cx]=1;p[py,px]=1  # one mask over both
    r,o=run(p)
    assert o[1]['merge_kind']=='neighbour_covering_matched' and o[2]['merge_kind']=='absorbed_missed' and r['fn']==1
    s=ev.summary([r],list(o.values()));assert s['merge_kinds']=={'absorbed_missed':1,'neighbour_covering_matched':1}


# ---------------------------------------------------------------- v4.9 model
def _tf():
    import tensorflow as tf
    from medtray import tf_instance_v49 as n9,tf_instance_v48 as n8
    return tf,n9,n8


def test_flags_off_reproduces_frozen_v48_outputs():
    import json
    tf,n9,n8=_tf();R=Path(__file__).resolve().parents[1];fz=json.loads((R/'artifacts/comparison-v48/FROZEN_SELECTION.json').read_text())
    ref=n8.build('bifpn_query');ref.load_weights(R/fz['weights']);m=n9.build(dict(backbone='bifpn'));m.load_weights(R/fz['weights'])
    x=tf.random.stateless_uniform((1,320,640,3),(1,2),-1,1);a=ref(x,training=False);c=m(x,training=False)
    for k in a:assert float(tf.reduce_max(tf.abs(a[k]-c[k])))<1e-4,k


def test_gt_moments_and_prior_kl():
    tf,n9,n8=_tf()
    onehot=np.zeros((1,80,160,1),np.float32);onehot[0,20:30,40:80,0]=1  # stride-4 cells
    mu,sxx,syy,sxy=n9.gt_moments(tf.constant(onehot))
    assert abs(float(mu[0,0,0])-(60*4)/32)<1e-4 and abs(float(mu[0,0,1])-(25*4)/32)<1e-4
    assert float(sxx[0,0])>float(syy[0,0])>0 and abs(float(sxy[0,0]))<1e-6
    loc=tf.constant([[[0.,0.]]])
    # Prior exactly matching the target Gaussian (c=1): centre offset = mu, precision = S^-1 (diagonal).
    lx=np.log(1/np.sqrt(float(sxx[0,0])));ly=np.log(1/np.sqrt(float(syy[0,0])))
    good=tf.constant([[[float(mu[0,0,0]),float(mu[0,0,1]),lx,ly,0.]]]);bad=good+tf.constant([[[1.,0.,1.,0.,0.]]])
    kg=float(n9.prior_kl(good,loc,mu,sxx,syy,sxy,1.)[0,0]);kb=float(n9.prior_kl(bad,loc,mu,sxx,syy,sxy,1.)[0,0])
    assert abs(kg)<1e-3 and kb>kg+.1,(kg,kb)


def test_refine_reanchors_at_previous_prior_centre():
    tf,n9,n8=_tf();m=n9.build(dict(backbone='bifpn',refine=True));x=tf.random.stateless_uniform((1,320,640,3),(3,4),-1,1);o=m(x,training=False)
    exp=np.clip(o['loc_0'].numpy()+o['prior_0'].numpy()[...,:2]*n8.UNIT,0,[640,320]);assert np.allclose(o['loc_1'].numpy(),exp,atol=1e-3)


def test_pile_weight_keeps_ordinary_scenes():
    tf,n9,n8=_tf();rng=np.random.default_rng(0);order=n9.epoch_order(rng,100,set(range(10)),.5)
    assert set(range(10,100))<=set(order.tolist()) and 0<len(set(order.tolist())&set(range(10)))<10 and len(order)==len(set(order.tolist()))


def test_all_flags_gradients_finite_on_gpu():
    import json
    tf,n9,n8=_tf();from medtray import tf_panoptic_v47 as v47
    R=Path(__file__).resolve().parents[1];items=v47.load_items(R/'artifacts/dataset-v46-combined','val')[:3]
    x,t=n8.collate([n8.example(it,640,5,1.,None,'query',80) for it in items],'query')
    cfg=dict(backbone='bifpn',refine=True,attn_margin=3.,attn_drop=.15,prior_sup=1.,prior_scale=1.,quality=True)
    with tf.device('/GPU:0'):
        m=n9.build(cfg)
        with tf.GradientTape() as tape:
            o=m(x,training=True);loss,parts=n9.query_losses(o,{k:tf.constant(v) for k,v in t.items()},tf.ones(12),m.layers_out,cfg)
        g=tape.gradient(loss,m.trainable_variables)
    assert all(v is not None and bool(tf.reduce_all(tf.math.is_finite(v))) and 'GPU:0' in v.device for v in g) and np.isfinite(float(loss)) and float(parts[-1])>0


if __name__=='__main__':
    failed=0
    for name,fn in list(globals().items()):
        if name.startswith('test_'):
            t=time.time()
            try:fn();print('PASS',name,f'{time.time()-t:.1f}s',flush=True)
            except Exception as e:
                failed+=1;import traceback;traceback.print_exc();print('FAIL',name,repr(e)[:300],flush=True)
    print('FAILED' if failed else 'ALL_PASSED',failed);sys.exit(bool(failed))
