"""Synthetic-only, high-resolution residual encoder-decoder with decoupled instance heads.
ConvNeXt/RTMDet-inspired depthwise residual blocks; not an implementation or SOTA claim.
All weights start random. Geometry transforms are followed by target regeneration.
"""
import argparse,io,json,os,time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL','2')
import numpy as np
from PIL import Image,ImageFilter
from scipy.ndimage import maximum_filter,label,binary_erosion
from scipy.special import expit,softmax
import tensorflow as tf
from .metrics import match_instances

PILL=(2,14)

def build_model():
    L=tf.keras.layers
    def conv(x,c,k=3,stride=1,name='conv'):
        x=L.Conv2D(c,k,strides=stride,padding='same',use_bias=False,name=name)(x)
        x=L.BatchNormalization(momentum=.9,name=name+'_bn')(x)
        return L.Activation('swish',name=name+'_act')(x)
    def residual(x,c,name):
        z=L.DepthwiseConv2D(5,padding='same',use_bias=False,name=name+'_spatial')(x)
        z=L.BatchNormalization(momentum=.9,name=name+'_bn')(z)
        z=L.Conv2D(c*2,1,activation='swish',name=name+'_expand')(z)
        z=L.Conv2D(c,1,name=name+'_project')(z)
        return L.Add(name=name+'_residual')([x,z])
    inp=L.Input((None,None,3),name='image')
    s0=conv(inp,16,name='detail_stem')
    stages=[s0];x=s0
    for i,c in enumerate([32,64,96,160],1):
        x=conv(x,c,stride=2,name=f'encoder_{i}_down')
        for j in range(2 if i>1 else 1):x=residual(x,c,f'encoder_{i}_block_{j}')
        stages.append(x)
    for i,c in [(3,96),(2,64),(1,40),(0,24)]:
        x=L.UpSampling2D(2,interpolation='bilinear',name=f'decoder_{i}_up')(x)
        x=L.Concatenate(name=f'decoder_{i}_fuse')([x,stages[i]])
        x=conv(x,c,name=f'decoder_{i}_mix');x=residual(x,c,f'decoder_{i}_block')
        if i==1:fine=x
    mask=conv(x,24,name='mask_features')
    inst=conv(fine,48,name='instance_features')
    inst=residual(inst,48,'instance_refine')
    family=conv(fine,40,name='appearance_features')
    outputs={
        'foreground':L.Conv2D(1,1,name='foreground')(mask),
        'boundary':L.Conv2D(1,1,name='boundary')(mask),
        'centers':L.Conv2D(1,1,bias_initializer=tf.keras.initializers.Constant(-2.19),name='centers')(inst),
        'offsets':L.Conv2D(2,1,name='offsets')(inst),
        'family':L.Conv2D(12,1,name='family')(family),
        'stuff':L.Conv2D(4,1,name='stuff')(mask)}
    return tf.keras.Model(inp,outputs,name='MedTray_V47_Decoupled_ResidualUNet')


def load_items(root,split):
    items=[]
    for f in sorted((Path(root)/split).glob('[0-9]*.json')):
        meta=json.loads(f.read_text())
        items.append(dict(path=f,meta=meta,rgb=np.array(Image.open(f.with_suffix('.png')).convert('RGB')),
            sem=np.array(Image.open(f.with_name(f.stem+'_semantic.png')),np.uint8),
            ids=np.array(Image.open(f.with_name(f.stem+'_instance.png')),np.uint16)))
    return items


def make_bank(items):
    bank=[]
    for it in items:
        if it['meta'].get('transparent_film'):continue
        for ob in it['meta']['objects']:
            if not 2<=ob['class_id']<14 or ob.get('stacked') or (ob.get('glare_pixel_fraction') or 0)>.1:continue
            # Transmitting pills retain the donor background in RGB; do not paste them.
            if ob.get('family')=='softgel' and ob.get('softgel_opacity')!='opaque':continue
            m=it['ids']==ob['instance_id'];yy,xx=np.where(m)
            if len(xx)<64:continue
            a,b,c,d=xx.min(),yy.min(),xx.max()+1,yy.max()+1
            bank.append((it['rgb'][b:d,a:c].copy(),m[b:d,a:c].copy(),ob['class_id']))
    return bank


def targets(ids,sem):
    h,w=sem.shape;oh,ow=h//2,w//2
    fg=((sem>=2)&(sem<14)).astype(np.float32)
    lowids=np.array(Image.fromarray(ids).resize((ow,oh),Image.Resampling.NEAREST))
    lowsem=np.array(Image.fromarray(sem).resize((ow,oh),Image.Resampling.NEAREST))
    ctr=np.zeros((oh,ow,1),np.float32);off=np.zeros((oh,ow,2),np.float32);weight=np.zeros((oh,ow,1),np.float32)
    for iid in np.unique(ids[fg>0]):
        if not iid:continue
        yy,xx=np.where((ids==iid)&(fg>0));area=len(xx)
        if area<6:continue
        cy=int(np.clip(round((yy.mean()+.5)/2-.5),0,oh-1));cx=int(np.clip(round((xx.mean()+.5)/2-.5),0,ow-1))
        sigma=float(np.clip(np.sqrt(area/np.pi)/5,1.,3.));radius=int(np.ceil(sigma*3))
        a,b=max(0,cx-radius),max(0,cy-radius);c,d=min(ow,cx+radius+1),min(oh,cy+radius+1)
        gy,gx=np.mgrid[b:d,a:c];ctr[b:d,a:c,0]=np.maximum(ctr[b:d,a:c,0],np.exp(-((gx-cx)**2+(gy-cy)**2)/(2*sigma**2)))
        ly,lx=np.where(lowids==iid);off[ly,lx,0]=(cx-lx)/32;off[ly,lx,1]=(cy-ly)/32
        weight[ly,lx,0]=1/np.sqrt(max(len(lx),1))
    boundary=np.zeros((h,w),np.float32)
    # Instance boundaries include contacts between adjacent tablets.
    for dy,dx in [(1,0),(-1,0),(0,1),(0,-1)]:
        boundary=np.maximum(boundary,((ids!=np.roll(ids,(dy,dx),(0,1)))&(fg>0)).astype(np.float32))
    stuff=np.zeros((h,w),np.int32);stuff[sem==1]=1;stuff[sem==14]=2;stuff[sem==15]=3
    return dict(foreground=fg[...,None],boundary=boundary[...,None],centers=ctr,offsets=off,instance_weight=weight,
        family=np.maximum(lowsem.astype(np.int32)-2,0).clip(0,11),family_valid=((lowsem>=2)&(lowsem<14)).astype(np.float32),stuff=stuff)


def prepare(it,size,seed=None,strength=0.,bank=None):
    rng=np.random.default_rng(seed);h,w=size//2,size
    # PIL's I;16 affine path rounds coordinates differently from L at some edges.
    # Use identical I-mode sampling for both categorical maps.
    rgb=Image.fromarray(it['rgb']);sem=Image.fromarray(it['sem'].astype(np.int32));ids=Image.fromarray(it['ids'].astype(np.int32))
    iw,ih=rgb.size
    if strength>0 and rng.random()<.85:
        angle=np.deg2rad(rng.uniform(-35,35)*strength + (rng.choice([0,90,180,270]) if rng.random()<.25 else 0))
        zoom=np.exp(rng.uniform(np.log(.8),np.log(1+1.3*strength)))
        scale=(iw/w)/zoom;ca,sa=np.cos(angle),np.sin(angle)
        tx=rng.uniform(-.14,.14)*iw*strength;ty=rng.uniform(-.14,.14)*ih*strength
        matrix=(scale*ca,scale*sa,iw/2+tx-scale*ca*w/2-scale*sa*h/2,
                -scale*sa,scale*ca,ih/2+ty+scale*sa*w/2-scale*ca*h/2)
        rgb=rgb.transform((w,h),Image.Transform.AFFINE,matrix,resample=Image.Resampling.BILINEAR,fillcolor=(114,114,114))
        sem=sem.transform((w,h),Image.Transform.AFFINE,matrix,resample=Image.Resampling.NEAREST,fillcolor=0)
        ids=ids.transform((w,h),Image.Transform.AFFINE,matrix,resample=Image.Resampling.NEAREST,fillcolor=0)
    else:
        rgb=rgb.resize((w,h),Image.Resampling.BILINEAR);sem=sem.resize((w,h),Image.Resampling.NEAREST);ids=ids.resize((w,h),Image.Resampling.NEAREST)
    x=np.array(rgb);y=np.array(sem);inst=np.array(ids)
    if strength>0:
        if rng.random()<.5:x=x[:,::-1].copy();y=y[:,::-1].copy();inst=inst[:,::-1].copy()
        if rng.random()<.5:x=x[::-1].copy();y=y[::-1].copy();inst=inst[::-1].copy()
        if bank and rng.random()<.25*strength:
            for _ in range(int(rng.integers(1,4))):
                donor,mask,cls=bank[int(rng.integers(len(bank)))];dh,dw=mask.shape
                ds=rng.uniform(.75,1.35)*size/768;dw=max(3,round(dw*ds));dh=max(3,round(dh*ds))
                if dw>=w or dh>=h:continue
                mask=np.array(Image.fromarray(mask.astype(np.uint8)).resize((dw,dh),Image.Resampling.NEAREST))>0
                donor=np.array(Image.fromarray(donor).resize((dw,dh),Image.Resampling.BILINEAR))
                for attempt in range(10):
                    a=int(rng.integers(0,w-dw));b=int(rng.integers(0,h-dh));region=y[b:b+dh,a:a+dw]
                    if np.mean(region[mask]==1)>.75:break
                else:continue
                patch=x[b:b+dh,a:a+dw];patch[mask]=donor[mask];region[mask]=cls
                inst[b:b+dh,a:a+dw][mask]=int(inst.max())+1
        rgb=Image.fromarray(x)
        if rng.random()<.18*strength:rgb=rgb.filter(ImageFilter.GaussianBlur(rng.uniform(.15,.85)*strength))
        if rng.random()<.15*strength:
            k=rng.uniform(.65,.95);rgb=rgb.resize((round(w*k),round(h*k)),Image.Resampling.BILINEAR).resize((w,h),Image.Resampling.BILINEAR)
        if rng.random()<.22*strength:
            z=io.BytesIO();rgb.save(z,format='JPEG',quality=int(rng.uniform(45,95)));z.seek(0);rgb=Image.open(z).convert('RGB')
        x=np.asarray(rgb,dtype=np.float32)/255
        exposure=np.exp(rng.uniform(-.4,.4)*strength);wb=np.exp(rng.uniform(-.12,.12,3)*strength)
        gamma=np.exp(rng.uniform(-.25,.25)*strength)
        x=np.clip(x**gamma*exposure*wb,0,1)
        sat=1+rng.uniform(-.35,.35)*strength;gray=x.mean(-1,keepdims=True);x=np.clip(gray+(x-gray)*sat,0,1)
        if rng.random()<.3*strength:x=np.clip(x+rng.normal(0,rng.uniform(.003,.02)*strength,x.shape),0,1)
        x=x*2-1
    else:x=x.astype(np.float32)/127.5-1
    # Regenerate centers/offsets from the final visible instance masks after all spatial augmentation.
    return x.astype(np.float32),targets(inst,y),y,inst


def batch(items,idx,size,rng=None,strength=0.,bank=None,executor=None):
    seeds=[int(rng.integers(2**32)) for _ in idx] if rng is not None else [None]*len(idx)
    args=[(items[i],size,s,strength,bank) for i,s in zip(idx,seeds)]
    data=list(executor.map(lambda v:prepare(*v),args)) if executor else [prepare(*v) for v in args]
    return np.stack([d[0] for d in data]),{k:np.stack([d[1][k] for d in data]) for k in data[0][1]},data


def balanced_bce(logits,truth):
    z=tf.nn.sigmoid_cross_entropy_with_logits(labels=truth,logits=logits)
    return .5*tf.reduce_sum(z*truth)/tf.maximum(tf.reduce_sum(truth),1.)+.5*tf.reduce_sum(z*(1-truth))/tf.maximum(tf.reduce_sum(1-truth),1.)


def losses(out,t,family_weights):
    fg=t['foreground'];p=tf.sigmoid(out['foreground'])
    bce=balanced_bce(out['foreground'],fg)
    dice=1-(2*tf.reduce_sum(p*fg)+1)/(tf.reduce_sum(p)+tf.reduce_sum(fg)+1)
    boundary=balanced_bce(out['boundary'],t['boundary'])
    ct=t['centers'];cp=tf.clip_by_value(tf.sigmoid(out['centers']),1e-5,1-1e-5);pos=tf.cast(ct>.999,tf.float32)
    focal=-tf.reduce_sum(pos*(1-cp)**2*tf.math.log(cp)+(1-pos)*(1-ct)**4*cp**2*tf.math.log(1-cp))/tf.maximum(tf.reduce_sum(pos),1.)
    iw=t['instance_weight'];err=tf.abs(out['offsets']-t['offsets']);huber=tf.where(err<.1,5*err**2,err-.05)
    offset=tf.reduce_sum(huber*iw)/(2*tf.maximum(tf.reduce_sum(iw),1.))
    fc=tf.nn.sparse_softmax_cross_entropy_with_logits(labels=t['family'],logits=out['family'])
    fw=tf.gather(family_weights,t['family'])*t['family_valid'];family=tf.reduce_sum(fc*fw)/tf.maximum(tf.reduce_sum(fw),1.)
    sc=tf.nn.sparse_softmax_cross_entropy_with_logits(labels=t['stuff'],logits=out['stuff']);stuff=tf.reduce_sum(sc*(1-fg[...,0]))/tf.maximum(tf.reduce_sum(1-fg),1.)
    total=bce+dice+.15*boundary+.3*focal+offset+.25*family+.1*stuff
    return total,tf.stack([bce,dice,boundary,focal,offset,family,stuff])


def decode(o,center_threshold=.25,mask_threshold=.5):
    p=expit(o['foreground'][...,0]);fg=p>=mask_threshold;h,w=fg.shape
    heat=expit(o['centers'][...,0]);oh,ow=heat.shape
    cy,cx=np.where((heat>=maximum_filter(heat,3))&(heat>=center_threshold));order=np.argsort(-heat[cy,cx])[:128];cy,cx=cy[order],cx[order]
    off=np.stack([np.array(Image.fromarray(o['offsets'][...,k]).resize((w,h),Image.Resampling.BILINEAR)) for k in range(2)],-1)
    fam=np.array(Image.fromarray(o['family'].argmax(-1).astype(np.uint8)).resize((w,h),Image.Resampling.NEAREST))+2
    stuff=np.array([0,1,14,15],np.uint8)[o['stuff'].argmax(-1)];sem=np.where(fg,fam,stuff).astype(np.uint8)
    ids=np.zeros((h,w),np.int32);ys,xs=np.where(fg);obs=[]
    if not len(cx) or not len(xs):return sem,ids,obs
    vx=(xs+.5)/(w/ow)-.5+off[ys,xs,0]*32;vy=(ys+.5)/(h/oh)-.5+off[ys,xs,1]*32
    ds=(vx[:,None]-cx)**2+(vy[:,None]-cy)**2;group=ds.argmin(1);valid=ds.min(1)<16**2
    for k in range(len(cx)):
        pick=(group==k)&valid
        if pick.sum()<5:continue
        m=np.zeros((h,w),bool);m[ys[pick],xs[pick]]=True;cc,n=label(m,np.ones((3,3)));choices=[]
        for j in range(1,n+1):
            yy,xx=np.where(cc==j)
            if len(xx)<5:continue
            dist=((xx-(cx[k]+.5)*(w/ow)+.5)**2+(yy-(cy[k]+.5)*(h/oh)+.5)**2).min()
            choices.append((dist+.5/len(xx),j))
        if not choices:continue
        m=cc==min(choices)[1];iid=len(obs)+1;ids[m]=iid;yy,xx=np.where(m)
        cls=int(np.bincount(fam[m],minlength=16).argmax())
        obs.append(dict(instance_id=iid,class_id=cls,confidence=float(p[m].mean()),center_score=float(heat[cy[k],cx[k]]),bbox_xyxy=[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)]))
    return sem,ids,obs


def summary(rows):
    tp=sum(r['tp'] for r in rows);fp=sum(r['fp'] for r in rows);fn=sum(r['fn'] for r in rows)
    occupied=[r for r in rows if r['gt_count']>0];empty=[r for r in rows if not r['gt_count']]
    return dict(images=len(rows),tp=tp,fp=fp,fn=fn,instance_precision_iou50=tp/max(tp+fp,1),instance_recall_iou50=tp/max(tp+fn,1),instance_f1_iou50=2*tp/max(2*tp+fp+fn,1),count_mae=float(np.mean([abs(r['count_error']) for r in rows])),exact_count_rate=float(np.mean([r['count_error']==0 for r in rows])),occupied_count_mae=float(np.mean([abs(r['count_error']) for r in occupied])) if occupied else 0.,occupied_exact_count_rate=float(np.mean([r['count_error']==0 for r in occupied])) if occupied else 0.,empty_images=len(empty),empty_candidates=sum(r['pred_count'] for r in empty),matched_family_accuracy=sum(r.get('correct_family',0) for r in rows)/max(tp,1))


def evaluate_raw(model,items,size,batch_size,family_weights):
    raws=[];total=0;binary=[0,0]
    for at in range(0,len(items),batch_size):
        idx=list(range(at,min(at+batch_size,len(items))));x,t,data=batch(items,idx,size)
        out=model(x,training=False);loss,_=losses(out,t,family_weights);total+=float(loss)*len(x)
        o={k:v.numpy() for k,v in out.items()}
        for j in range(len(x)):
            z={k:v[j] for k,v in o.items()};raws.append(z)
            pred=z['foreground'][...,0]>0;gt=t['foreground'][j,...,0]>0;binary[0]+=int((pred&gt).sum());binary[1]+=int((pred|gt).sum())
    return raws,dict(loss=total/len(items),pill_binary_iou=binary[0]/max(binary[1],1))


def score_raw(raws,items,ct=.25,mt=.5):
    rows=[]
    for o,it in zip(raws,items):
        sem,ids,obs=decode(o,ct,mt)
        # Freeze comparison grid and visible-object eligibility to the existing 512x256 protocol.
        ids=np.array(Image.fromarray(ids).resize((512,256),Image.Resampling.NEAREST))
        for iid in np.unique(ids):
            if iid and (ids==iid).sum()<10:ids[ids==iid]=0
        gt=np.array(Image.fromarray(it['ids']).resize((512,256),Image.Resampling.NEAREST));ys=np.array(Image.fromarray(it['sem']).resize((512,256),Image.Resampling.NEAREST));gt[(ys<2)|(ys>=14)]=0
        row=match_instances(gt,ids,min_area=10);truth={z['instance_id']:z['class_id'] for z in it['meta']['objects']};pred={z['instance_id']:z['class_id'] for z in obs}
        row.update(scene=it['path'].stem,correct_family=sum(truth[g]==pred[p] for g,p,_ in row['pairs']));rows.append(row)
    return summary(rows),rows


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--data',type=Path,default=Path('artifacts/dataset-v46-combined'));ap.add_argument('--out',type=Path,default=Path('artifacts/tf-panoptic-v47'));ap.add_argument('--size',type=int,default=640);ap.add_argument('--batch-size',type=int,default=8);ap.add_argument('--epochs',type=int,default=36);ap.add_argument('--augmentation',choices=['none','strong'],default='strong');ap.add_argument('--smoke',action='store_true');ap.add_argument('--overfit',action='store_true');ap.add_argument('--warmstart',type=Path);ap.add_argument('--eval-every',type=int,default=3);a=ap.parse_args()
    a.out.mkdir(parents=True,exist_ok=True);assert a.size%32==0
    assert tf.config.list_physical_devices('GPU'),'TensorFlow Metal required'
    tf.keras.utils.set_random_seed(4701);rng=np.random.default_rng(4701)
    tr=load_items(a.data,'train');va=load_items(a.data,'val')
    support=np.zeros(12)
    for it in tr:
        for ob in it['meta']['objects']:
            if 2<=ob['class_id']<14:support[ob['class_id']-2]+=1
    fw=np.clip(np.sqrt(support.sum()/(12*np.maximum(support,1))),.4,4).astype(np.float32);fw/=np.sum(fw*support)/support.sum();weights=tf.constant(fw)
    if a.smoke or a.overfit:
        tr=[it for it in tr if np.isin(it['sem'],np.arange(2,14)).sum()>1000][:8];va=tr
    bank=make_bank(tr) if a.augmentation=='strong' else []
    with tf.device('/GPU:0'):model=build_model();opt=tf.keras.optimizers.AdamW(.0015,weight_decay=.00005,global_clipnorm=5)
    if a.warmstart:model.load_weights(a.warmstart)
    manifest=dict(architecture=model.name,parameters=model.count_params(),tensorflow=tf.__version__,gpu=[str(x) for x in tf.config.list_physical_devices('GPU')],size=a.size,epochs=a.epochs,seed=4701,augmentation=a.augmentation,copy_paste_donors=len(bank),random_initialization=not bool(a.warmstart),warmstart=str(a.warmstart) if a.warmstart else None,heads=list(model.output.keys()),family_class_weights=fw.tolist(),training_splits=['train'],selection='Validation instance mask F1 at IoU .5, frozen 512x256 eligibility grid. No test or stress selection.',architecture_scope='Compact residual depthwise encoder-decoder inspired by ConvNeXt and RTMDet design principles; not those exact models or a benchmark SOTA claim.',input_normalization='RGB /127.5 -1',data_contract='Pills are semantic IDs 2..13. Transform integer masks together, then regenerate centers and offsets. Copy-paste uses training-only uncovered visible donor pixels.',augmentation_scope='Exposure, gamma, white balance, saturation, JPEG, blur, noise, downsample, flips, rotation, translation, log-uniform zoom; 25% copy-paste on tray. Final 20% of training uses mild geometry/photometry without copy-paste.',test_status='Not evaluated during training')
    manifest.update(overfit_diagnostic=a.overfit,smoke_check=a.smoke,evaluation_split='same eight training images; NOT held-out' if a.overfit else 'val')
    (a.out/'manifest.json').write_text(json.dumps(manifest,indent=2));print('START',json.dumps(manifest),flush=True)
    x,t,_=batch(tr,list(range(min(a.batch_size,len(tr)))),a.size)
    with tf.device('/GPU:0'):
        with tf.GradientTape() as tape:o=model(x,training=True);loss,_=losses(o,t,weights)
        grads=tape.gradient(loss,model.trainable_variables)
    verification=dict(loss=float(loss),parameters=model.count_params(),heads={k:v.device for k,v in o.items()},gradients=len(grads),gpu_gradients=sum(g is not None and 'GPU:0' in g.device for g in grads))
    assert verification['gpu_gradients']==len(grads),verification
    assert all('GPU:0' in v for v in verification['heads'].values()),verification
    (a.out/'gpu-verification.json').write_text(json.dumps(verification,indent=2));print('GPU_VERIFIED',json.dumps(verification),flush=True)
    @tf.function(reduce_retracing=True,jit_compile=False)
    def step(x,t):
        with tf.device('/GPU:0'):
            with tf.GradientTape() as tape:o=model(x,training=True);loss,parts=losses(o,t,weights)
            grads=tape.gradient(loss,model.trainable_variables);opt.apply_gradients(zip(grads,model.trainable_variables))
        return loss,parts
    if a.smoke:
        before=time.time()
        for _ in range(6):v,_=step(x,t);float(v)
        model.save(a.out/'smoke.keras');loaded=tf.keras.models.load_model(a.out/'smoke.keras',compile=False);print('SMOKE_DONE',float(v),'six_steps_seconds',time.time()-before,'reload',len(loaded(x)),flush=True);return
    hist=[];best=-1;chosen_epoch=0;before_all=time.time()
    executor=ThreadPoolExecutor(6)
    for epoch in range(1,a.epochs+1):
        before=time.time();lr=.0001+.0014*(1+np.cos(np.pi*(epoch-1)/a.epochs))/2;opt.learning_rate.assign(lr)
        strength=0 if a.augmentation=='none' or a.overfit else (.45 if epoch<=2 else .25 if epoch>a.epochs*.8 else 1.)
        this_bank=bank if strength>.5 else None
        idx=rng.permutation(len(tr));tot=0;parts_list=[]
        repeats=10 if a.overfit else 1
        for _ in range(repeats):
            for at in range(0,len(idx),a.batch_size):
                ix=idx[at:at+a.batch_size];x,t,_=batch(tr,ix,a.size,rng,strength,this_bank,executor)
                v,parts=step(x,t);tot+=float(v)*len(ix);parts_list.append(parts.numpy())
        row=dict(epoch=epoch,train_loss=tot/(len(tr)*repeats),learning_rate=lr,augmentation_strength=strength,loss_components=dict(zip(['balanced_foreground_bce','foreground_dice','boundary_bce','center_focal','offset_huber','family_ce','stuff_ce'],np.mean(parts_list,0).tolist())))
        if epoch%a.eval_every==0 or epoch in [1,a.epochs] or a.overfit:
            raw,ev=evaluate_raw(model,va,a.size,a.batch_size,weights);metrics,rows=score_raw(raw,va)
            row.update(val_loss=ev['loss'],val_binary_iou=ev['pill_binary_iou'],validation=metrics)
            if metrics['instance_f1_iou50']>best:
                best=metrics['instance_f1_iou50'];chosen_epoch=epoch;model.save(a.out/'best.keras');(a.out/'best-val-scenes.json').write_text(json.dumps(rows))
            del raw
        row['seconds']=time.time()-before;hist.append(row);(a.out/'history.json').write_text(json.dumps(hist,indent=2));print('EPOCH',json.dumps(row),flush=True)
        if epoch%6==0 or epoch==a.epochs:model.save(a.out/'last.keras')
    executor.shutdown();model.load_weights(a.out/'best.keras')
    raw,ev=evaluate_raw(model,va,a.size,a.batch_size,weights);search=[]
    for ct in [.15,.25,.35,.45]:
        for mt in [.4,.5,.6]:
            m,_=score_raw(raw,va,ct,mt);search.append(dict(center_threshold=ct,mask_threshold=mt,**m))
    picked=max(search,key=lambda r:r['instance_f1_iou50']);ct,mt=picked['center_threshold'],picked['mask_threshold'];m,rows=score_raw(raw,va,ct,mt)
    result=dict(selected_epoch=chosen_epoch,training_seconds=time.time()-before_all,center_threshold=ct,mask_threshold=mt,validation_threshold_search=search,val=dict(**ev,instances=m,scenes=rows),scope='Synthetic only. Validation-selected checkpoint and thresholds. Test/stress held until model selection is frozen.')
    (a.out/'validation.json').write_text(json.dumps(result,indent=2));print('VALIDATION_DONE',json.dumps({k:v for k,v in result.items() if k not in ['val','validation_threshold_search']}),json.dumps(m),flush=True)

if __name__=='__main__':main()
