"""v4.8 target, alignment, matching and gradient tests. Run with the TensorFlow environment:
PYTHONPATH=src .venv-tf/bin/python tests/test_instance_v48.py   (pytest-compatible functions)"""
import json,sys,time
from pathlib import Path
import numpy as np
import tensorflow as tf
from medtray import tf_instance_v48 as net,tf_panoptic_v47 as v47,instance_eval_v48 as ev
R=Path(__file__).resolve().parents[1];D=R/'artifacts/dataset-v46-combined'
_items={}
def items(split='train',n=24):
    if split not in _items:
        paths=sorted((D/split).glob('[0-9]*.json'))[:n];its=[]
        for f in paths:
            from PIL import Image
            its.append(dict(path=f,meta=json.loads(f.read_text()),rgb=np.array(Image.open(f.with_suffix('.png')).convert('RGB')),
                sem=np.array(Image.open(f.with_name(f.stem+'_semantic.png')),np.uint8),ids=np.array(Image.open(f.with_name(f.stem+'_instance.png')),np.uint16)))
        _items[split]=its
    return _items[split]


def test_augment_matches_v47_prepare_exactly():
    its=items();bank=v47.make_bank(its)
    for k,seed in enumerate([1,7,99,2024,31337,4801]):
        it=its[k*3%len(its)]
        for strength in [0.,.45,1.]:
            a=v47.prepare(it,640,seed,strength,bank);b=net.augment(it,640,seed,strength,bank)
            assert np.array_equal(a[0],b[0]) and np.array_equal(a[2],b[1]) and np.array_equal(a[3],b[2]),(seed,strength)


def test_instance_index_is_exact_and_excludes_only_tiny():
    rng=np.random.default_rng(0);its=items();bank=v47.make_bank(its)
    for it in its[:10]:
        x,y,inst=net.augment(it,640,int(rng.integers(1e9)),1.,bank);t=net.query_targets(inst,y)
        fg=(y>=2)&(y<14);ids,counts=np.unique(np.where(fg,inst,0),return_counts=True);keep=ids[(ids>0)&(counts>=net.MIN_TRAIN_PIXELS)]
        assert t['count']==len(keep)
        for k,iid in enumerate(keep):assert np.array_equal(t['instance_index']==k,(inst==iid)&fg)
        tiny=ids[(ids>0)&(counts<net.MIN_TRAIN_PIXELS)]
        assert not (t['instance_index'][np.isin(inst,tiny)]>=0).any()
        assert np.array_equal(t['foreground'][...,0]>0,fg)  # tiny pills remain semantic foreground


def test_empty_scene_targets_and_capacity_overflow_fails_clearly():
    sem=np.ones((32,64),np.uint8);inst=np.zeros((32,64),np.int32);t=net.query_targets(inst,sem)
    assert t['count']==0 and (t['instance_index']==-1).all()
    sem[:]=2;inst=np.arange(32*64).reshape(32,64)//16  # 128 separate 16-px pills
    try:net.query_targets(inst,sem,capacity=80);raise AssertionError('overflow not detected')
    except net.CapacityError:pass
    x,t=net.collate([(np.zeros((32,64,3),np.float32),net.query_targets(np.zeros((32,64),np.int32),np.ones((32,64),np.uint8)))],'query')
    assert t['target_valid'].shape==(1,1) and t['target_valid'].sum()==0


def test_hungarian_matching_including_empty_and_overflow():
    c=np.array([[[.9,.1],[.2,.8],[.0,.5]]],np.float32)  # 3 queries x 2 targets
    a=net.hungarian(c,np.array([[True,True]]));assert a.tolist()==[[2,0]]
    a=net.hungarian(c,np.array([[True,False]]));assert a.tolist()==[[2,-1]]
    assert net.hungarian(c,np.array([[False,False]])).tolist()==[[-1,-1]]
    try:net.hungarian(np.zeros((1,1,2),np.float32),np.array([[True,True]]));raise AssertionError
    except net.CapacityError:pass
    try:net.hungarian(np.full((1,3,2),np.nan,np.float32),np.array([[True,True]]));raise AssertionError
    except FloatingPointError:pass


def synthetic_out(idx,g,q=4,scale=12.,assign=None,obj=None):
    """Hand-built query outputs whose masks are the GT instances (feature k = instance k)."""
    b,h,w=idx.shape;feat=np.zeros((b,h,w,net.MASK_DIM),np.float32)
    for k in range(g):feat[...,k]=(idx==k)
    emb=np.zeros((b,q,net.MASK_DIM+1),np.float32);emb[...,-1]=-scale/2;loc=np.zeros((b,q,2),np.float32)
    for j in range(q):
        k=assign[j] if assign is not None else j
        if k<g:emb[:,j,k]=scale
        ys,xs=np.where(idx[0]==k) if k<g else (np.array([h//2]),np.array([w//2]));loc[:,j]=[xs.mean()+.5,ys.mean()+.5]
    prior=np.zeros((b,q,5),np.float32);prior[...,2:4]=-3  # weak location prior
    o=np.full((b,q),-6.,np.float32) if obj is None else obj
    fg=(idx>=0).astype(np.float32)[...,None]
    out=dict(mask_features=feat,query_loc=loc,activation=np.zeros((b,h//4,w//4),np.float32),foreground=fg*20-10,boundary=np.zeros_like(fg),
             family=np.zeros((b,h//2,w//2,12),np.float32),stuff=np.zeros((b,h,w,4),np.float32))
    out.update(obj_0=o,emb_0=emb,prior_0=prior)
    return {k:tf.constant(v) for k,v in out.items()}


def small_targets(idx,g):
    fg=(idx>=0).astype(np.float32)[...,None];b,h,w=idx.shape
    return dict(instance_index=tf.constant(idx),target_valid=tf.constant(np.array([[k<g for k in range(max(g,1))]]*b,np.float32)),foreground=tf.constant(fg),
                boundary=tf.zeros_like(fg),family=tf.zeros((b,h//2,w//2),tf.int32),family_valid=tf.zeros((b,h//2,w//2)),stuff=tf.zeros((b,h,w),tf.int32))


def two_pill_index():
    idx=np.full((1,32,64),-1,np.int32);idx[0,8:16,8:24]=0;idx[0,16:24,40:56]=1;return idx


def test_mask_alignment_painting_and_grid_evaluation_are_exact():
    """Hand-built query masks equal to the GT instances must paint back exactly, and a full-size
    scene evaluated on the 512x256 grid must score every eligible GT object as TP."""
    it=items('val')[0];x,y,inst=net.augment(it,640);t=net.query_targets(inst,y);g=t['count']
    if g>net.MASK_DIM-1:return
    idx=t['instance_index'][None];out=synthetic_out(idx,g,q=max(g,1)+2,obj=np.array([[3.]*g+[-6.]*(max(g,1)+2-g)],np.float32))
    win,prob,score=net.paint(out,[.5],0);ids,obs=net.query_instances(win.numpy()[0,0],prob.numpy()[0,0],score.numpy()[0],np.zeros((160,320,12),np.float32),.5)
    assert np.array_equal(ids>0,idx[0]>=0)
    for o in obs:assert len(np.unique(idx[0][ids==o['instance_id']]))==1
    gt=ev.gt_record(it);row,objs=ev.scene_eval(it,gt,ev.to_grid(ids),obs)
    # GT goes original->512 directly; the painted map went original->640->512, so tiny objects may differ.
    assert row['fn']<=max(1,.05*row['gt_count']) and row['fp']==0,row


def test_pooled_logits_match_full_resolution_average():
    rng=np.random.default_rng(1);feat=tf.constant(rng.normal(size=(1,32,64,net.MASK_DIM)),tf.float32)
    emb=tf.constant(rng.normal(size=(1,3,net.MASK_DIM+1)),tf.float32);prior=tf.constant(np.zeros((1,3,5)),tf.float32);prior=prior+tf.constant([0,0,-3,-3,0.])
    loc=tf.constant([[[10.,6.],[40.,20.],[60.,30.]]])
    full=net.mask_logits(feat,emb,prior,loc,1).numpy();p4=net.mask_logits(tf.nn.avg_pool2d(feat,4,4,'VALID'),emb,prior,loc,4).numpy()
    avg=full.reshape(1,3,8,4,16,4).mean((3,5));assert np.abs(avg-p4).max()<.02  # prior is nearly flat; linear part exact
    strong=tf.constant([[[0,0,2.,2.,0]]*3],tf.float32);m=net.mask_logits(feat*0,emb*0,strong,loc,1).numpy()[0,0]
    yy,xx=np.unravel_index(m.argmax(),m.shape);assert (xx,yy)==(9,5) or (xx,yy)==(10,6)  # peak at pixel whose center is (10,6)


def test_duplicate_query_is_penalized_and_empty_scene_trains_objectness_down():
    idx=two_pill_index()
    one=synthetic_out(idx,2,obj=np.array([[4.,4.,-6.,-6.]],np.float32))
    dup=synthetic_out(idx,2,assign=[0,0,1,3],obj=np.array([[4.,4.,4.,-6.]],np.float32))  # query 1 duplicates pill 0; query 2 is pill 1
    fw=tf.ones(12);t=small_targets(idx,2)
    _,p1=net.query_losses(one,t,fw,1);_,p2=net.query_losses(dup,t,fw,1)
    names=net.QUERY_PARTS;o1=p1.numpy()[names.index('objectness_bce')];o2=p2.numpy()[names.index('objectness_bce')]
    m2=p2.numpy()[names.index('mask_dice')]
    assert o2>o1*3,(o1,o2);assert m2<.05,m2  # both pills still matched with perfect masks; only the duplicate is penalized
    empty=np.full((1,32,64),-1,np.int32);obj=tf.Variable(np.zeros((1,4),np.float32))
    with tf.GradientTape() as tape:
        out=dict(synthetic_out(empty,0));out['obj_0']=obj;loss,parts=net.query_losses(out,small_targets(empty,0),fw,1)
    grad=tape.gradient(loss,obj).numpy();assert np.isfinite(loss.numpy()) and (grad>0).all(),grad  # descent lowers every score
    assert parts.numpy()[names.index('mask_dice')]==0


def test_full_model_gradients_on_metal_are_finite_with_empty_and_busy_scenes():
    its=items();busy=[it for it in its if any(2<=o['class_id']<14 for o in it['meta']['objects'])][:2]
    empty=[f for f in sorted((D/'train').glob('[0-9]*.json')) if not any(2<=o['class_id']<14 for o in json.loads(f.read_text())['objects'])][:1]
    from PIL import Image
    e=[dict(path=f,meta=json.loads(f.read_text()),rgb=np.array(Image.open(f.with_suffix('.png')).convert('RGB')),sem=np.array(Image.open(f.with_name(f.stem+'_semantic.png')),np.uint8),
            ids=np.array(Image.open(f.with_name(f.stem+'_instance.png')),np.uint16)) for f in empty]
    for variant in ['unet_query','bifpn_query','bifpn_orig']:
        form=variant.split('_')[1];x,t=net.collate([net.example(it,640,3,1.,None,form,net.QUERIES) for it in busy+e],form)
        with tf.device('/GPU:0'):
            model=net.build(variant)
            with tf.GradientTape() as tape:
                o=model(x,training=True);loss,_=(v47.losses(o,t,tf.ones(12)) if form=='orig' else net.query_losses(o,{k:tf.constant(v) for k,v in t.items()},tf.ones(12),model.layers_out))
            grads=tape.gradient(loss,model.trainable_variables)
        missing=[v.name for g,v in zip(grads,model.trainable_variables) if g is None]
        assert not missing,(variant,missing[:5])
        assert all(bool(tf.reduce_all(tf.math.is_finite(g))) for g in grads),variant
        assert all('GPU:0' in g.device for g in grads),variant
        # Every query path receives nonzero gradient except via the stop-gradient proposal selection.
        print('  ',variant,'params',model.count_params(),'loss',float(loss))


def test_up2_equals_keras_bilinear_upsampling():
    rng=np.random.default_rng(3)
    for shape in [(2,5,7,3),(1,10,20,16),(1,1,1,2)]:
        x=tf.constant(rng.normal(size=shape),tf.float32)
        a=tf.keras.layers.UpSampling2D(2,interpolation='bilinear')(x).numpy();b=net.Up2()(x).numpy()
        assert np.abs(a-b).max()<1e-5,(shape,np.abs(a-b).max())


def test_unet_orig_reproduces_frozen_v47_outputs():
    ref=tf.keras.models.load_model(R/'artifacts/tf-panoptic-v47-strong/best.keras',compile=False);m=net.build('unet_orig')
    src={l.name:l for l in ref.layers if l.weights}
    assert sorted(src)==sorted(l.name for l in m.layers if l.weights)
    for l in m.layers:
        if l.weights:l.set_weights(src[l.name].get_weights())
    x=net.augment(items('val')[1],640)[0][None];a=ref(x,training=False);b=m(x,training=False)
    for k in a:assert np.abs(a[k].numpy()-b[k].numpy()).max()<1e-3,(k,np.abs(a[k].numpy()-b[k].numpy()).max())


if __name__=='__main__':
    failed=0
    for name,fn in list(globals().items()):
        if name.startswith('test_'):
            t=time.time()
            try:fn();print('PASS',name,f'{time.time()-t:.1f}s',flush=True)
            except Exception as e:
                failed+=1;import traceback;traceback.print_exc();print('FAIL',name,repr(e)[:300],flush=True)
    print('FAILED' if failed else 'ALL_PASSED',failed);sys.exit(bool(failed))
