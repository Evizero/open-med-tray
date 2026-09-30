"""MedTray v4.9: v4.8 BiFPN direct query masks + targeted, individually switchable changes.

With every flag off this is the v4.8 bifpn_query formulation (same encoder, BiFPN, decoder, losses, data,
augmentation and selection rule); a control run is trained with the same code path for fair comparison.
  --prior-sup W      supervise each matched query's elliptical location prior with the complete visible GT:
                     KL( N(GT centroid, c^2 * GT pixel covariance) || N(prior centre, prior covariance) ),
                     log(1+KL) averaged over matched queries at every decoder prediction; c = --prior-scale.
  --refine           decoder layer l is anchored at the previous prediction's prior centre (detached): the
                     query location, its positional code and the prior anchor move toward the whole object.
  --attn-margin M    masked attention hides only pixels with mask logit < -M (v4.8: < 0);
  --attn-drop P      training only: each query ignores its attention mask with probability P.
  --quality          IoU-aware objectness: matched target = stop-grad stride-4 mask IoU (varifocal-style),
                     negatives keep the focal term.
  --pile-weight W    each epoch, 'extreme_pile' training scenes (composition audit tiers) are included with
                     probability W; they are never deleted and remain in stress evaluation.
No classical grouping is added: inference still paints learned masks by score.
"""
import argparse,datetime,hashlib,json,os,time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL','2')
import numpy as np
import tensorflow as tf
from . import tf_instance_v48 as b
from . import tf_panoptic_v47 as v47
from . import instance_eval_v49 as ev

L=tf.keras.layers
HOLDOUT=Path('artifacts/dataset-v49-holdout')


class QueryDecoderV49(b.QueryDecoder):
    def __init__(self,queries=b.QUERIES,refine=False,attn_margin=0.,attn_drop=0.,**kw):
        super().__init__(queries,**kw);self.refine=refine;self.attn_margin=attn_margin;self.attn_drop=attn_drop
    def call(self,f4,f8,feat,training=False):
        bs=tf.shape(f4)[0];h4=tf.shape(f4)[1];w4=tf.shape(f4)[2]
        ia=self.ia_out(self.ia_conv(f4))[...,0]
        peak=tf.equal(ia,tf.nn.max_pool2d(ia[...,None],3,1,'SAME')[...,0])
        _,idx=tf.math.top_k(tf.stop_gradient(tf.reshape(tf.where(peak,ia,-1e9),(bs,-1))),self.queries)
        q=self.q_norm(self.q_in(tf.gather(tf.reshape(f4,(bs,-1,f4.shape[-1])),idx,batch_dims=1)))
        loc=tf.cast(tf.stack([idx%w4*4+2,idx//w4*4+2],-1),tf.float32)
        size=tf.cast(tf.stack([w4*4,h4*4]),tf.float32);qpos=self.qpos(b.sine(loc/size))
        h8=tf.shape(f8)[1];w8=tf.shape(f8)[2]
        gy,gx=tf.meshgrid((tf.cast(tf.range(h8),tf.float32)+.5)/tf.cast(h8,tf.float32),(tf.cast(tf.range(w8),tf.float32)+.5)/tf.cast(w8,tf.float32),indexing='ij')
        mpos=self.mpos(b.sine(tf.reshape(tf.stack([gx,gy],-1),(1,-1,2))));mem=self.m_in(tf.reshape(f8,(bs,-1,f8.shape[-1])))
        feat8=tf.nn.avg_pool2d(feat,8,8,'VALID')
        obj,emb,prior=self.head(q);out={'activation':ia,'query_loc':loc,'loc_0':loc,'obj_0':obj,'emb_0':emb,'prior_0':prior}
        for i,blk in enumerate(self.blocks,1):
            m=tf.cast(tf.stop_gradient(tf.reshape(b.mask_logits(feat8,emb,prior,loc,8),(bs,self.queries,-1)))<-self.attn_margin,tf.float32)
            if training and self.attn_drop>0:
                m=m*tf.cast(tf.random.uniform((bs,self.queries,1))>=self.attn_drop,tf.float32)
            bias=-1e4*m*(1-tf.reduce_min(m,-1,keepdims=True))
            if self.refine:
                # Re-anchor at the previous prediction's prior centre; detached like iterative box refinement.
                loc=tf.stop_gradient(tf.clip_by_value(loc+prior[...,:2]*b.UNIT,0.,tf.reshape(size,(1,1,2))));qpos=self.qpos(b.sine(loc/size))
            q=blk(q,qpos,mem,mpos,bias);obj,emb,prior=self.head(q)
            out.update({f'obj_{i}':obj,f'emb_{i}':emb,f'prior_{i}':prior,f'loc_{i}':loc})
        return out


class QueryModelV49(tf.keras.Model):
    def __init__(self,backbone='bifpn',queries=b.QUERIES,refine=False,attn_margin=0.,attn_drop=0.,**kw):
        super().__init__(name=f'MedTray_V49_{backbone}_query',**kw)
        self.pixels=b.build_pixel_query(backbone);self.decoder=QueryDecoderV49(queries,refine=refine,attn_margin=attn_margin,attn_drop=attn_drop,name='query_decoder')
        self.layers_out=len(self.decoder.blocks)+1
    def call(self,x,training=False):
        o=dict(self.pixels(x,training=training));o.update(self.decoder(o.pop('f4'),o.pop('f8'),o['mask_features'],training=training))
        return o


def build(cfg):
    b.PRIOR_SCALE=1.;b.PRIOR_MAX_LOG=4.
    m=QueryModelV49(cfg.get('backbone','bifpn'),cfg.get('queries',b.QUERIES),cfg.get('refine',False),cfg.get('attn_margin',0.),cfg.get('attn_drop',0.))
    m(tf.zeros((1,320,640,3)),training=False);return m


def loc_of(out,l):return out.get(f'loc_{l}',out['query_loc'])


# ---------------------------------------------------------------- losses
def gt_moments(frac4):
    """Area-fraction-weighted centroid and covariance of each target at stride 4, in prior units (32 px)."""
    bsz=tf.shape(frac4)[0];h=tf.shape(frac4)[1];w=tf.shape(frac4)[2];g=tf.shape(frac4)[3]
    ys=(tf.cast(tf.range(h),tf.float32)+.5)*4/b.UNIT;xs=(tf.cast(tf.range(w),tf.float32)+.5)*4/b.UNIT
    gy,gx=tf.meshgrid(ys,xs,indexing='ij');X=tf.reshape(gx,(1,-1,1));Y=tf.reshape(gy,(1,-1,1))
    f=tf.reshape(frac4,(bsz,-1,g));n=tf.maximum(tf.reduce_sum(f,1),1e-6)
    mx=tf.reduce_sum(f*X,1)/n;my=tf.reduce_sum(f*Y,1)/n;dx=X-mx[:,None];dy=Y-my[:,None]
    q=(4/b.UNIT)**2/12  # within-cell quantization variance
    sxx=tf.reduce_sum(f*dx*dx,1)/n+q;syy=tf.reduce_sum(f*dy*dy,1)/n+q;sxy=tf.reduce_sum(f*dx*dy,1)/n
    return tf.stack([mx,my],-1),sxx,syy,sxy


def prior_kl(prior,loc,mu,sxx,syy,sxy,c):
    """KL(N(mu, c^2 S) || N(prior centre, P^-1)) with P = L L^T, L = [[l11,0],[l21,l22]] in prior units."""
    lp=tf.clip_by_value(prior[...,2:4],-3.,b.PRIOR_MAX_LOG);l11=tf.exp(lp[...,0]);l22=tf.exp(lp[...,1]);l21=prior[...,4]
    pxx=l11*l11;pxy=l11*l21;pyy=l21*l21+l22*l22
    ctr=loc/b.UNIT+prior[...,:2];d=ctr-mu;dx=d[...,0];dy=d[...,1]
    c2=c*c;tr=pxx*c2*sxx+2*pxy*c2*sxy+pyy*c2*syy;mah=pxx*dx*dx+2*pxy*dx*dy+pyy*dy*dy
    logdet_p=2*(lp[...,0]+lp[...,1]);logdet_s=tf.math.log(tf.maximum(c2*c2*(sxx*syy-sxy*sxy),1e-8))
    return .5*(tr+mah-2.-logdet_p-logdet_s)


def query_losses(out,t,family_weights,layers,cfg):
    feat=out['mask_features'];bsz=tf.shape(feat)[0];W=tf.shape(feat)[2]
    idx=t['instance_index'];valid=t['target_valid'];g=tf.shape(valid)[1];nq=tf.shape(out['obj_0'])[1]
    onehot=tf.one_hot(idx,g);frac2=tf.nn.avg_pool2d(onehot,2,2,'VALID');frac4=tf.nn.avg_pool2d(onehot,4,4,'VALID')
    t4=tf.reshape(frac4,(bsz,-1,g));feat2=tf.nn.avg_pool2d(feat,2,2,'VALID');feat4=tf.nn.avg_pool2d(feat,4,4,'VALID')
    if cfg.get('prior_sup',0) or cfg.get('centre_sup',0):mu,sxx,syy,sxy=gt_moments(frac4)
    inst=[];finals=None;psup=[]
    for l in range(layers):
        obj,emb,prior=out[f'obj_{l}'],out[f'emb_{l}'],out[f'prior_{l}'];loc=loc_of(out,l)
        x4=tf.reshape(b.mask_logits(feat4,emb,prior,loc,4),(bsz,nq,-1));a=b.match(obj,x4,t4,valid,'focal')
        ok=tf.cast(a>=0,tf.float32)*valid;a=tf.maximum(a,0)
        oh=tf.one_hot(a,nq)*ok[...,None];matched=tf.reduce_max(oh,1)
        p4=tf.sigmoid(tf.gather(x4,a,batch_dims=1));tt=tf.transpose(t4,(0,2,1))
        iou=tf.stop_gradient(tf.reduce_sum(p4*tt,-1)/tf.maximum(tf.reduce_sum(p4+tt-p4*tt,-1),1e-6))
        if cfg.get('quality'):
            qt=tf.reduce_max(oh*tf.clip_by_value(iou,.05,1.)[...,None],1)  # per-query IoU target (0 for unmatched)
            p=tf.sigmoid(obj);bce=tf.nn.sigmoid_cross_entropy_with_logits(labels=qt,logits=obj)
            objl=tf.reduce_sum(matched*qt*bce+(1-matched)*.75*p**2*bce)/tf.maximum(tf.reduce_sum(ok),1.)
        else:
            objl=tf.reduce_sum(b.focal(obj,matched))/tf.maximum(tf.reduce_sum(ok),1.)
        e=tf.gather(emb,a,batch_dims=1);pr=tf.gather(prior,a,batch_dims=1);lc=tf.gather(loc,a,batch_dims=1)
        if l==layers-1:
            target=tf.cast(tf.equal(idx[:,None],tf.range(g)[None,:,None,None]),tf.float32);xm=b.mask_logits(feat,e,pr,lc,1)
        else:
            target=tf.transpose(frac2,(0,3,1,2));xm=b.mask_logits(feat2,e,pr,lc,2)
        mb,md=b.pair_mask_losses(xm,target,ok);inst.append([objl,mb,md])
        term=tf.constant(0.)
        if cfg.get('prior_sup',0):
            kl=prior_kl(pr,lc,mu,sxx,syy,sxy,cfg.get('prior_scale',1.));term+=cfg['prior_sup']*tf.reduce_sum(tf.math.log1p(tf.maximum(kl,0.))*ok)/tf.maximum(tf.reduce_sum(ok),1.)
        if cfg.get('centre_sup',0):
            # Direct centre term, independent of the predicted width: |prior centre - GT centroid| / GT spread.
            d=tf.reduce_sum(tf.abs(lc/b.UNIT+pr[...,:2]-mu),-1)/tf.sqrt(sxx+syy);term+=cfg['centre_sup']*tf.reduce_sum(tf.math.log1p(d)*ok)/tf.maximum(tf.reduce_sum(ok),1.)  # log1p: bounded early gradient
        if cfg.get('prior_sup',0) or cfg.get('centre_sup',0):psup.append(term)
        if l==layers-1:finals=[objl,mb,md,tf.reduce_sum(iou*ok)/tf.maximum(tf.reduce_sum(ok),1.)]
    inst=tf.reduce_mean(tf.stack(inst),0);instance=tf.reduce_sum(tf.constant([4.,5.,5.])*inst)
    prior_loss=tf.reduce_mean(tf.stack(psup)) if psup else tf.constant(0.)
    ia=tf.reshape(out['activation'],(bsz,-1));pia=tf.sigmoid(ia)
    inside=(t4>=.5)|((t4>=tf.reduce_max(t4,1,keepdims=True))&(t4>0))
    score=tf.stop_gradient(tf.where(inside,pia[...,None],-1.));_,best=tf.math.top_k(tf.transpose(score,(0,2,1)),1)
    pos=tf.reduce_max(tf.one_hot(best[...,0],tf.shape(ia)[1])*valid[...,None],1)
    ce=tf.nn.sigmoid_cross_entropy_with_logits(labels=pos,logits=ia);pt=pia*pos+(1-pia)*(1-pos)
    ia_focal=tf.reduce_sum(ce*(1-pt)**2*(.25*pos+.75*(1-pos)))/tf.maximum(tf.reduce_sum(pos),1.)
    dense,dparts=b.dense_losses(out,t,family_weights)
    li=tf.cast(out['query_loc'],tf.int32);flat=tf.reshape(idx,(bsz,-1));hit=tf.gather(flat,li[...,1]*W+li[...,0],batch_dims=1)
    rec=tf.reduce_sum(tf.reduce_max(tf.one_hot(hit,g),1)*valid)/tf.maximum(tf.reduce_sum(valid),1.)
    total=instance+ia_focal+dense+prior_loss  # prior_loss already weighted
    return total,tf.stack([instance,inst[0],inst[1],inst[2],ia_focal,dense,*dparts,*finals[:3],rec,finals[3],prior_loss])


PARTS=['instance_total','objectness','mask_bce','mask_dice','activation_focal','dense_total','foreground_bce','foreground_dice','boundary_bce','family_ce','stuff_ce',
       'final_objectness','final_mask_bce','final_mask_dice','proposal_recall','matched_mean_iou_s4','prior_terms_weighted']


# ---------------------------------------------------------------- inference
def paint(out,obj_thresholds,layer):
    feat=out['mask_features'];score=tf.sigmoid(out[f'obj_{layer}'])
    prob=tf.transpose(tf.sigmoid(b.mask_logits(feat,out[f'emb_{layer}'],out[f'prior_{layer}'],loc_of(out,layer),1)),(0,2,3,1));wins=[];probs=[]
    for th in obj_thresholds:
        keep=tf.cast(score>=th,tf.float32)[:,None,None,:]
        v,i=tf.math.top_k(prob*score[:,None,None,:]*keep,1);i=i[...,0]
        wins.append(tf.where(v[...,0]>0,i,-1));probs.append(tf.where(v[...,0]>0,tf.gather(prob,i[...,None],batch_dims=3)[...,0],0.))
    return tf.stack(wins,1),tf.stack(probs,1),score


def predict_batch(model,x,grid):
    out=model(x,training=False);layer=model.layers_out-1;obj_th=sorted({g[0] for g in grid})
    win,prob,score=[v.numpy() for v in paint(out,obj_th,layer)];fam=out['family'].numpy();stuff=out['stuff'].numpy();fg=out['foreground'].numpy();res=[]
    for j in range(len(x)):
        d={}
        for ot,mt in grid:
            ids,obs=b.query_instances(win[j,obj_th.index(ot)],prob[j,obj_th.index(ot)],score[j],fam[j],mt)
            d[(ot,mt)]=(ids,obs,b.semantic_from(dict(family=fam[j],stuff=stuff[j]),ids))
        res.append(dict(maps=d,foreground=fg[j,...,0],scores=score[j]))
    return res


def validate(model,items,size,bs,grid,gt_cache,keep_best=False):
    rows={g:[] for g in grid};objs={g:[] for g in grid};fgstat=[0,0]
    for at in range(0,len(items),bs):
        sub=items[at:at+bs];x=np.stack([b.augment(it,size)[0] for it in sub])
        for it,r in zip(sub,predict_batch(model,x,grid)):
            gt=gt_cache(it);p=ev.to_grid((r['foreground']>0).astype(np.uint8))>0;fgstat[0]+=int((p&gt['sem_pill']).sum());fgstat[1]+=int((p|gt['sem_pill']).sum())
            for g in grid:
                ids,obs,_=r['maps'][g];row,ob=ev.scene_eval(it,gt,ev.to_grid(ids),obs);rows[g].append(row);objs[g]+=ob
    table=[dict(thresholds=list(g),**ev.summary(rows[g],objs[g])) for g in grid]
    best=max(range(len(grid)),key=lambda i:table[i]['instance_f1_iou50'])
    out=dict(grid=table,best=table[best],pill_binary_iou_foreground_head=fgstat[0]/max(fgstat[1],1))
    if keep_best:out['scenes']=rows[grid[best]];out['objects']=objs[grid[best]]
    return out


def epoch_order(rng,n,extreme,pile_weight):
    """Permutation of scene indices; extreme-pile scenes kept each epoch with probability pile_weight."""
    keep=[i for i in range(n) if i not in extreme or pile_weight>=1 or rng.random()<pile_weight]
    return np.array(keep)[rng.permutation(len(keep))]


def main():
    ap=argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out',type=Path,required=True);ap.add_argument('--data',type=Path,default=Path('artifacts/dataset-v46-combined'))
    ap.add_argument('--backbone',default='bifpn',choices=['bifpn','unet']);ap.add_argument('--epochs',type=int,default=12);ap.add_argument('--seed',type=int,default=4901)
    ap.add_argument('--batch-size',type=int,default=16);ap.add_argument('--size',type=int,default=640);ap.add_argument('--lr',type=float,default=.0015);ap.add_argument('--warmup-steps',type=int,default=44)
    ap.add_argument('--eval-every',type=int,default=3);ap.add_argument('--workers',type=int,default=6)
    ap.add_argument('--prior-sup',type=float,default=0.);ap.add_argument('--centre-sup',type=float,default=0.);ap.add_argument('--prior-scale',type=float,default=1.);ap.add_argument('--refine',action='store_true')
    ap.add_argument('--attn-margin',type=float,default=0.);ap.add_argument('--attn-drop',type=float,default=0.);ap.add_argument('--quality',action='store_true')
    ap.add_argument('--pile-weight',type=float,default=1.);ap.add_argument('--extra-train',type=Path,action='append',default=[],help='additional versioned training component dirs (train split)')
    ap.add_argument('--limit',type=int,default=0,help='smoke tests only: first N train and val scenes')
    ap.add_argument('--no-resume',action='store_true',help='ignore an existing <out>/state checkpoint')
    ap.add_argument('--steps-matched',action='store_true',help='with --extra-train: each epoch samples as many scenes as the base set from the union (same optimisation steps as the control)')
    a=ap.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    for p in [a.data]+a.extra_train:assert 'dataset-v49-holdout' not in str(p),'the v4.9 holdout must never be used for training/selection'
    assert tf.config.list_physical_devices('GPU'),'TensorFlow Metal required'
    tf.keras.utils.set_random_seed(a.seed);rng=np.random.default_rng(a.seed)
    tr=v47.load_items(a.data,'train');va=v47.load_items(a.data,'val')
    if a.limit:tr=tr[:a.limit];va=va[:a.limit]
    n_base=len(tr)
    for extra in a.extra_train:tr+=v47.load_items(extra,'train')
    support=np.zeros(12)
    for it in tr[:n_base]:
        for ob in it['meta']['objects']:
            if 2<=ob['class_id']<14:support[ob['class_id']-2]+=1
    fw=np.clip(np.sqrt(support.sum()/(12*np.maximum(support,1))),.4,4).astype(np.float32);fw/=np.sum(fw*support)/support.sum();weights=tf.constant(fw)
    comp={r['scene']:r['tier'] for r in json.loads(Path('artifacts/opus-bifpn-v49/composition.json').read_text())['train']['rows']}
    extreme={i for i,it in enumerate(tr[:n_base]) if comp.get(it['path'].stem)=='extreme_pile'}
    bank=v47.make_bank(tr)
    cfg=dict(backbone=a.backbone,queries=b.QUERIES,refine=a.refine,attn_margin=a.attn_margin,attn_drop=a.attn_drop,prior_sup=a.prior_sup,prior_scale=a.prior_scale,centre_sup=a.centre_sup,quality=a.quality)
    with tf.device('/GPU:0'):
        model=build(cfg);opt=tf.keras.optimizers.AdamW(a.lr,weight_decay=.00005,global_clipnorm=5)
    layers=model.layers_out;params=int(model.count_params());gtc=ev.GTCache()
    manifest=dict(version='v4.9',architecture=model.name,parameters=params,config=cfg,tensorflow=tf.__version__,size=a.size,epochs=a.epochs,batch_size=a.batch_size,seed=a.seed,
        learning_rate=dict(peak=a.lr,final=.0001,schedule='linear warmup then cosine per step',warmup_steps=a.warmup_steps),optimizer='AdamW wd 5e-5, global clipnorm 5',
        data=str(a.data),extra_train=[str(p) for p in a.extra_train],steps_matched=a.steps_matched,train_scenes=len(tr),pile_weight=a.pile_weight,extreme_pile_train_scenes=len(extreme),copy_paste_donors=len(bank),
        family_class_weights=fw.tolist(),selection='Epoch: max validation F1 over the small fixed grid; thresholds: full grid on the selected checkpoint. Development validation only; v4.9 holdout never read.',
        random_initialization=True,test_status='Not evaluated during training')
    b.write_json(a.out/'manifest.json',manifest);print('START',json.dumps(manifest),flush=True)
    executor=ThreadPoolExecutor(a.workers)
    x,t=b.collate([b.example(tr[i],a.size,None,0.,None,'query',b.QUERIES) for i in range(min(a.batch_size,len(tr)))],'query')
    with tf.device('/GPU:0'):
        with tf.GradientTape() as tape:o=model(x,training=True);loss,parts=query_losses(o,{k:tf.constant(v) for k,v in t.items()},weights,layers,cfg)
        grads=tape.gradient(loss,model.trainable_variables)
    ver=dict(loss=float(loss),outputs_on_gpu=all('GPU:0' in v.device for v in o.values()),gradients=len(grads),gpu_gradients=sum(g is not None and 'GPU:0' in g.device for g in grads),
             finite_gradients=sum(g is not None and bool(tf.reduce_all(tf.math.is_finite(g))) for g in grads),none_gradients=[v.name for g,v in zip(grads,model.trainable_variables) if g is None])
    assert ver['gpu_gradients']==len(grads)==ver['finite_gradients'] and ver['outputs_on_gpu'],ver
    b.write_json(a.out/'gpu-verification.json',ver);print('GPU_VERIFIED',json.dumps(ver),flush=True)
    spec={'foreground':tf.TensorSpec((None,None,None,1)),'boundary':tf.TensorSpec((None,None,None,1)),'family':tf.TensorSpec((None,None,None),tf.int32),'family_valid':tf.TensorSpec((None,None,None)),
          'stuff':tf.TensorSpec((None,None,None),tf.int32),'instance_index':tf.TensorSpec((None,None,None),tf.int32),'target_valid':tf.TensorSpec((None,None))}
    @tf.function(reduce_retracing=True,input_signature=[tf.TensorSpec((None,None,None,3)),spec])
    def step(x,t):
        with tf.device('/GPU:0'):
            with tf.GradientTape() as tape:o=model(x,training=True);loss,parts=query_losses(o,t,weights,layers,cfg)
            grads=tape.gradient(loss,model.trainable_variables);opt.apply_gradients(zip(grads,model.trainable_variables))
            finite=tf.reduce_all([tf.reduce_all(tf.math.is_finite(g)) for g in grads])
        return loss,parts,finite
    total_steps=int(np.ceil(((n_base if a.steps_matched else len(tr))-len(extreme)*(1-a.pile_weight))/a.batch_size))*a.epochs;gstep=0
    hist=[];best=-1;chosen=0;t0=time.time();small=b.default_grid('query');first=1;state=a.out/'state';resumed=None
    if (state/'state.json').exists() and not a.no_resume:
        # Full-state resume: weights, optimizer variables (moments + iteration), numpy RNG, step, best tracking.
        st=json.loads((state/'state.json').read_text());model.load_weights(state/'model.weights.h5');opt.build(model.trainable_variables)
        saved=np.load(state/'optimizer.npz');vals=[saved[f'v{i}'] for i in range(len(saved.files))];assert len(vals)==len(opt.variables)
        for var,val in zip(opt.variables,vals):assert tuple(var.shape)==val.shape;var.assign(val)
        rng.bit_generator.state=st['rng'];gstep=st['gstep'];best=st['best'];chosen=st['chosen'];first=st['epoch']+1;t0=time.time()-st['elapsed']
        hist=json.loads((a.out/'history.json').read_text())[:st['epoch']];resumed=dict(from_epoch=st['epoch'],at=datetime.datetime.now().isoformat(timespec='seconds'))
        (a.out/'resume-log.json').write_text(json.dumps(json.loads((a.out/'resume-log.json').read_text())+[resumed] if (a.out/'resume-log.json').exists() else [resumed],indent=1))
        print('RESUMED',json.dumps(resumed),flush=True)
    for epoch in range(first,a.epochs+1):
        before=time.time();strength=.45 if epoch<=2 else .25 if epoch>a.epochs*.8 else 1.
        this_bank=bank if strength>.5 else None;tot=0;n=0;plist=[];wait=0;compute=0;nonfinite=0
        order=epoch_order(rng,len(tr),extreme,a.pile_weight);order_hash=None
        if a.steps_matched and len(tr)>n_base:order=order[:int(round(n_base-len(extreme)*(1-a.pile_weight)))]
        tick=time.time();order_hash=hashlib.sha256(np.asarray(order,np.int64).tobytes()).hexdigest()[:16]
        for x,t in b.Prefetch(tr,order,a.size,a.batch_size,rng,strength,this_bank,'query',b.QUERIES,executor):
            lr=a.lr*min(1,(gstep+1)/max(a.warmup_steps,1)) if gstep<a.warmup_steps else .0001+(a.lr-.0001)*(1+np.cos(np.pi*min(1.,(gstep-a.warmup_steps)/max(total_steps-a.warmup_steps,1))))/2
            opt.learning_rate.assign(lr);wait+=time.time()-tick;tick=time.time()
            v,parts,finite=step(tf.constant(x),{k:tf.constant(z) for k,z in t.items()});v=float(v);compute+=time.time()-tick
            if not bool(finite) or not np.isfinite(v):nonfinite+=1
            tot+=v*len(x);n+=len(x);plist.append(parts.numpy());gstep+=1;tick=time.time()
        if nonfinite:raise FloatingPointError(f'{nonfinite} non-finite steps in epoch {epoch}')
        row=dict(epoch=epoch,scenes=int(len(order)),order_sha=order_hash,train_loss=tot/n,learning_rate_end=float(lr),augmentation_strength=strength,loss_components=dict(zip(PARTS,np.mean(plist,0).tolist())),data_wait_seconds=wait,step_seconds=compute)
        if epoch%a.eval_every==0 or epoch==a.epochs:
            e0=time.time();val=validate(model,va,a.size,8,small,gtc);row.update(validation=val,validation_seconds=time.time()-e0)
            if val['best']['instance_f1_iou50']>best:best=val['best']['instance_f1_iou50'];chosen=epoch;model.save_weights(a.out/'best.weights.h5')
        row['seconds']=time.time()-before;hist.append(row);b.write_json(a.out/'history.json',hist)
        state.mkdir(exist_ok=True);model.save_weights(state/'model.weights.h5');np.savez(state/'optimizer.npz',**{f'v{i}':v.numpy() for i,v in enumerate(opt.variables)})
        b.write_json(state/'state.json',dict(epoch=epoch,rng=rng.bit_generator.state,gstep=gstep,best=best,chosen=chosen,elapsed=time.time()-t0,
            note='Full training state after this epoch. TF global RNG (attention-mask dropout only) is not restored; Metal is not bit-reproducible.'))
        b.write_json(a.out/'progress.json',dict(epoch=epoch,epochs=a.epochs,best_epoch=chosen,best_small_grid_f1=best,elapsed_seconds=time.time()-t0,updated=datetime.datetime.now().isoformat(timespec='seconds')))
        print('EPOCH',epoch,round(row['train_loss'],4),round(row['seconds']),'VAL',json.dumps({k:row['validation']['best'][k] for k in ['instance_f1_iou50','tp','fp','fn']}) if 'validation' in row else '',flush=True)
    model.save_weights(a.out/'last.weights.h5');executor.shutdown();train_seconds=time.time()-t0
    model.load_weights(a.out/'best.weights.h5');e0=time.time()
    val=validate(model,va,a.size,8,b.default_grid('query',True),gtc,keep_best=True);pick=val['best']
    result=dict(version='v4.9',config=cfg,selected_epoch=chosen,training_seconds=train_seconds,thresholds=pick['thresholds'],threshold_names=['objectness_threshold','mask_threshold'],
        validation_threshold_search=val['grid'],val=dict(instances=pick,pill_binary_iou_foreground_head=val['pill_binary_iou_foreground_head'],scenes=val['scenes']),search_seconds=time.time()-e0,
        scope='Synthetic development validation only. v4.9 holdout never read.')
    b.write_json(a.out/'validation.json',result);b.write_json(a.out/'val-objects.json',val['objects'])
    print('VALIDATION_DONE',json.dumps({k:pick[k] for k in ['instance_f1_iou50','tp','fp','fn','count_mae']}),flush=True)


if __name__=='__main__':main()
