"""Compact single-pass panoptic model with MobileNetV3 + FPN and dense attribute heads.
Inspired by Panoptic-DeepLab center/offset grouping; not a reproduction or SOTA claim.
All weights random initialized. Requires the isolated TensorFlow Metal environment.
"""
import argparse,json,os,time,sys
from pathlib import Path
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL','1')
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import maximum_filter,label
import tensorflow as tf
from .metrics import semantic_metrics,match_instances
from .visibility import score_is_presented
FINISHES=['chalky_uncoated','matte_film','satin_film','gelatin_shell','softgel_shell']

def build_model(h=256,w=512):
    L=tf.keras.layers
    encoder=tf.keras.applications.MobileNetV3Small(input_shape=(h,w,3),alpha=.75,include_top=False,weights=None,include_preprocessing=False)
    # Keras application default .999 assumes a long large-data run; small scratch training needs faster moving statistics.
    for layer in encoder.layers:
        if isinstance(layer,L.BatchNormalization):layer.momentum=.9
    # Last feature before each spatial downsample; preserve fine edges for small tablets.
    stages={}
    for layer in encoder.layers:
        shape=layer.output.shape
        if len(shape)==4 and shape[1] in [h//2,h//4,h//8,h//16,h//32]:stages[int(shape[1])]=layer.output
    def block(x,n,name):
        x=L.SeparableConv2D(n,3,padding='same',use_bias=False,name=name+'_conv')(x)
        x=L.BatchNormalization(momentum=.9,name=name+'_bn')(x);return L.Activation('swish',name=name+'_act')(x)
    x=stages[h//32];x=block(x,96,'context')
    for stride,n in [(16,80),(8,64),(4,48),(2,32)]:
        x=L.Resizing(h//stride,w//stride,interpolation='bilinear',name=f'up_{stride}')(x)
        skip=L.Conv2D(n,1,padding='same',name=f'lateral_{stride}')(stages[h//stride]);x=L.Concatenate()([x,skip]);x=block(x,n,f'fpn_{stride}')
        if stride==2:instance=x
    semantic=L.Conv2D(16,1,name='semantic_low')(x);semantic=L.Resizing(h,w,interpolation='bilinear',name='semantic')(semantic)
    z=block(instance,48,'instance_features');centers=L.Conv2D(1,1,bias_initializer=tf.keras.initializers.Constant(-2.19),name='centers')(z);offsets=L.Conv2D(2,1,name='offsets')(z)
    attrs=L.Conv2D(18,1,name='attributes')(z)
    pillness=L.Resizing(h,w,interpolation='bilinear',name='pillness')(L.Conv2D(1,1,name='pillness_low')(x))
    graphic=L.Resizing(h,w,interpolation='bilinear',name='graphic')(L.Conv2D(1,1,name='graphic_low')(x))
    return tf.keras.Model(encoder.input,{'semantic':semantic,'centers':centers,'offsets':offsets,'attributes':attrs,'pillness':pillness,'graphic':graphic},name='MedTray_V46_Stride2_Panoptic')

def targets(fullids,sem,meta,graphics):
    fh,fw=fullids.shape;h,w=fh//2,fw//2;ids=np.array(Image.fromarray(fullids).resize((w,h),Image.Resampling.NEAREST));yy,xx=np.mgrid[:h,:w]
    center=np.zeros((h,w,1),np.float32);offset=np.zeros((h,w,2),np.float32);attrs=np.zeros((h,w,10),np.float32);fg=np.zeros((h,w,1),np.float32)
    for o in meta['objects']:
        if not 2<=o['class_id']<=13:continue
        full=fullids==o['instance_id'];area=full.sum()
        if area<10:continue
        fy,fx=np.where(full);cy=int(np.clip(np.round((fy.mean()+.5)/2-.5),0,h-1));cx=int(np.clip(np.round((fx.mean()+.5)/2-.5),0,w-1))
        sigma=float(np.clip(np.sqrt(area/np.pi)/7,.65,1.5));center[...,0]=np.maximum(center[...,0],np.exp(-((xx-cx)**2+(yy-cy)**2)/(2*sigma**2)))
        mask=ids==o['instance_id'];offset[mask,0]=(cx-xx[mask])/32;offset[mask,1]=(cy-yy[mask])/32;fg[mask]=1
        second=o['secondary_color'] if o['family']=='hard_capsule' or o.get('two_tone',False) else o['color']
        attrs[mask,:6]=[*o['color'],*second];attrs[mask,6]=FINISHES.index(o['finish']);attrs[mask,7]=o['score'] if score_is_presented(o) else 0;attrs[mask,8]=int(o['chip']>0);attrs[mask,9]=int(o.get('dose_fraction',1)<1)
    return {'center':center,'offset':offset,'attrs':attrs,'fg':fg,'graphic':graphics[...,None].astype(np.float32)}


def load_data(root,split,h,w):
    items=[]
    for f in sorted((root/split).glob('[0-9]*.json')):
        meta=json.loads(f.read_text());rgb=np.array(Image.open(f.with_suffix('.png')).convert('RGB').resize((w,h),Image.Resampling.BILINEAR));sem=np.array(Image.open(f.with_name(f.stem+'_semantic.png')).resize((w,h),Image.Resampling.NEAREST),np.int32)
        ids=np.array(Image.open(f.with_name(f.stem+'_instance.png')).resize((w,h),Image.Resampling.NEAREST));print_ids=[g['instance_id'] for g in meta.get('printed_graphics',[]) if g['kind']!='sticker_paper'];graphics=np.isin(ids,print_ids)
        t=targets(ids,sem,meta,graphics);items.append((rgb,sem,t,f))
    return items

def batch(items,indices,rng=None):
    xs=[];ys=[];ts={k:[] for k in ['center','offset','attrs','fg','graphic']}
    for i in indices:
        rgb,sem,t,_=items[i];x=rgb.astype(np.float32)/127.5-1;y=sem;t={k:v.copy() for k,v in t.items()}
        if rng is not None:
            if rng.random()<.5:
                x=x[:,::-1];y=y[:,::-1];t={k:v[:,::-1].copy() for k,v in t.items()};t['offset'][...,0]*=-1
            if rng.random()<.5:
                x=x[::-1];y=y[::-1];t={k:v[::-1].copy() for k,v in t.items()};t['offset'][...,1]*=-1
            x=np.clip((x+1)*rng.uniform(.8,1.2)*rng.uniform(.94,1.06,(1,1,3))-1,-1,1)
            if rng.random()<.3:x=np.clip(x+rng.normal(0,.018,x.shape),-1,1)
        xs.append(x);ys.append(y)
        for k in ts:ts[k].append(t[k])
    return np.stack(xs).astype(np.float32),np.stack(ys),{k:np.stack(v) for k,v in ts.items()}

def losses(out,y,t):
    weights=tf.constant([.15,.25]+[2.]*12+[1.,.2],tf.float32)
    ce=tf.nn.sparse_softmax_cross_entropy_with_logits(labels=y,logits=out['semantic']);pixelweights=tf.gather(weights,y)*(1+9*t['graphic'][...,0]);ce=tf.reduce_sum(ce*pixelweights)/tf.reduce_sum(pixelweights)
    p=tf.nn.softmax(out['semantic']);pf=tf.reduce_sum(p[...,2:14],-1);yf=tf.cast((y>=2)&(y<=13),tf.float32);dice=1-(2*tf.reduce_sum(pf*yf)+1)/(tf.reduce_sum(pf)+tf.reduce_sum(yf)+1)
    cp=tf.clip_by_value(tf.sigmoid(out['centers']),1e-5,1-1e-5);ct=t['center'];positive=tf.cast(ct>.999,tf.float32);negative=tf.cast(ct<.999,tf.float32)
    focal=-tf.reduce_sum(positive*(1-cp)**2*tf.math.log(cp)+negative*(1-ct)**4*cp**2*tf.math.log(1-cp))/tf.maximum(tf.reduce_sum(positive),1.)
    fg=t['fg'];den=tf.maximum(tf.reduce_sum(fg),1.);offset=tf.reduce_sum(tf.abs(out['offsets']-t['offset'])*fg)/(2*den)
    a=out['attributes'];truth=t['attrs'];color=tf.reduce_sum(tf.abs(tf.sigmoid(a[...,:6])-truth[...,:6])*fg)/(6*den)
    attr=color
    for start,end,col in [(6,11,6),(11,14,7),(14,16,8),(16,18,9)]:
        c=tf.nn.sparse_softmax_cross_entropy_with_logits(labels=tf.cast(truth[...,col],tf.int32),logits=a[...,start:end]);attr+=.15*tf.reduce_sum(c*fg[...,0])/den
    # Family-specific overlap prevents a good generic pill silhouette from masking class collapse.
    onehot=tf.one_hot(y,16)[...,2:14];pp=p[...,2:14];axes=[0,1,2];intersection=tf.reduce_sum(pp*onehot,axes);union=tf.reduce_sum(pp+onehot,axes);family_dice=1-tf.reduce_mean((2*intersection+1)/(union+1))
    binary=tf.nn.sigmoid_cross_entropy_with_logits(labels=yf,logits=out['pillness'][...,0]);bw=1+2*yf+5*t['graphic'][...,0];binary=tf.reduce_sum(binary*bw)/tf.reduce_sum(bw)
    gp=t['graphic'];graphic=tf.nn.weighted_cross_entropy_with_logits(labels=gp,logits=out['graphic'],pos_weight=12.);graphic=tf.reduce_mean(graphic)
    total=ce+.4*dice+.3*family_dice+.08*focal+.5*offset+.2*attr+.5*binary+.12*graphic
    return total,tf.stack([ce,dice,focal,offset,attr,family_dice,binary,graphic])

def decode(out,threshold=.25):
    sem=out['semantic'].argmax(-1).astype(np.uint8);heat=1/(1+np.exp(-np.clip(out['centers'][...,0],-30,30)));oh,ow=heat.shape;h,w=sem.shape
    cy,cx=np.where((heat>=maximum_filter(heat,size=3))&(heat>=threshold));order=np.argsort(-heat[cy,cx])[:60];cy=cy[order];cx=cx[order]
    off=np.stack([np.array(Image.fromarray(out['offsets'][...,k]).resize((w,h),Image.Resampling.BILINEAR)) for k in range(2)],-1)
    ids=np.zeros((h,w),np.int32);fg=(sem>=2)&(sem<=13)&(out['pillness'][...,0]>-.2);ys,xs=np.where(fg);observations=[]
    if len(cx) and len(xs):
        vx=xs/(w/ow)+off[ys,xs,0]*32;vy=ys/(h/oh)+off[ys,xs,1]*32;distance=(vx[:,None]-cx)**2+(vy[:,None]-cy)**2;group=distance.argmin(1);valid=distance.min(1)<=12**2
        prob=tf.nn.softmax(out['semantic']).numpy()
        for k in range(len(cx)):
            idx=(group==k)&valid
            if idx.sum()<10:continue
            component=np.zeros((h,w),bool);component[ys[idx],xs[idx]]=True;components,n=label(component,np.ones((3,3)))
            # Keep connected support nearest the detected center, with area tie-breaker.
            choices=[]
            for j in range(1,n+1):
                yy,xx=np.where(components==j)
                if len(xx)<10:continue
                dist=((xx-cx[k]*(w/ow))**2+(yy-cy[k]*(h/oh))**2).min();choices.append((dist+.5/len(xx),j))
            if not choices:continue
            keep=min(choices)[1];yy,xx=np.where(components==keep);iid=len(observations)+1;ids[yy,xx]=iid;cls=int(np.bincount(sem[yy,xx],minlength=16).argmax());confidence=float(prob[yy,xx,cls].mean())
            observations.append({'instance_id':iid,'class_id':cls,'confidence':confidence,'center_score':float(heat[cy[k],cx[k]]),'bbox_xyxy':[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)]})
    return sem,ids,observations

def summarize(rows):
    tp=sum(r['tp'] for r in rows);fp=sum(r['fp'] for r in rows);fn=sum(r['fn'] for r in rows)
    return {'images':len(rows),'instance_precision_iou50':tp/max(tp+fp,1),'instance_recall_iou50':tp/max(tp+fn,1),'instance_f1_iou50':2*tp/max(2*tp+fp+fn,1),'count_mae':float(np.mean([abs(r['count_error']) for r in rows])),'exact_count_rate':float(np.mean([r['count_error']==0 for r in rows])),'matched_family_accuracy':sum(r['correct_family'] for r in rows)/max(tp,1)}

def evaluate(model,items,batch_size=16,threshold=None,outdir=None):
    conf=np.zeros((16,16),np.int64);total=0;rows=[];finconf=np.zeros((5,5),np.int64);colorerror=0;fgcount=0
    for at in range(0,len(items),batch_size):
        x,y,t=batch(items,range(at,min(len(items),at+batch_size)));o=model(x,training=False);loss,_=losses(o,y,t);total+=float(loss)*len(x);outputs={k:v.numpy() for k,v in o.items()};pred=outputs['semantic'].argmax(-1);conf+=np.bincount((y*16+pred).ravel(),minlength=256).reshape(16,16)
        fg=t['fg'][...,0]>0;true=t['attrs'][...,6].astype(int)[fg];predfinish=outputs['attributes'][...,6:11].argmax(-1)[fg];finconf+=np.bincount(true*5+predfinish,minlength=25).reshape(5,5);col=1/(1+np.exp(-outputs['attributes'][...,:6]));colorerror+=float(np.abs(col-t['attrs'][...,:6])[fg].sum());fgcount+=int(fg.sum())
        if threshold is not None:
            for j in range(len(x)):
                sem,ids,obs=decode({k:v[j] for k,v in outputs.items()},threshold);f=items[at+j][3];meta=json.loads(f.read_text());truth={z['instance_id']:z for z in meta['objects'] if 2<=z['class_id']<=13};gt=np.array(Image.open(f.with_name(f.stem+'_instance.png')).resize((y.shape[2],y.shape[1]),Image.Resampling.NEAREST));gt[~np.isin(gt,list(truth))]=0;r=match_instances(gt,ids,min_area=10);lookup={z['instance_id']:z for z in obs};r.update(scene=f.stem,correct_family=sum(truth[g]['class_id']==lookup[p]['class_id'] for g,p,_ in r['pairs']),lighting=meta['lighting'],film=meta['transparent_film']);rows.append(r)
                if outdir and at+j<12:
                    outdir.mkdir(exist_ok=True);palette=np.array([[24,32,46],[120,134,147],[239,111,108],[247,174,93],[246,215,105],[139,205,119],[75,193,162],[77,173,215],[105,139,233],[170,134,225],[222,135,202],[236,153,157],[165,186,89],[244,72,107],[245,240,223],[97,102,113]],np.uint8);im=Image.fromarray(items[at+j][0]);overlay=Image.blend(im,Image.fromarray(palette[sem]),.3);draw=ImageDraw.Draw(overlay)
                    for ob in obs:draw.rectangle(ob['bbox_xyxy'],outline='white',width=1)
                    overlay.save(outdir/f'{f.stem}_prediction.png');Image.fromarray(sem).save(outdir/f'{f.stem}_semantic.png');Image.fromarray(ids.astype(np.uint16)).save(outdir/f'{f.stem}_instances.png');Image.fromarray((np.clip(1/(1+np.exp(-outputs['centers'][j,...,0])),0,1)*255).astype(np.uint8)).resize(im.size).save(outdir/f'{f.stem}_centers.png')
    result={'loss':total/len(items),**semantic_metrics(conf),'images':len(items),'dense_finish_accuracy':float(np.trace(finconf)/max(finconf.sum(),1)),'dense_color_mae':colorerror/max(fgcount*6,1),'finish_confusion':finconf.tolist(),'confusion':conf.tolist()}
    if rows:result.update(instances=summarize(rows),scenes=rows)
    return result

def main():
    p=argparse.ArgumentParser();p.add_argument('--data',type=Path,default=Path('artifacts/dataset-v46-combined'));p.add_argument('--out',type=Path,default=Path('artifacts/tf-panoptic-v46'));p.add_argument('--epochs',type=int,default=48);p.add_argument('--batch-size',type=int,default=16);p.add_argument('--size',type=int,default=512);p.add_argument('--warmstart',type=Path);p.add_argument('--smoke',action='store_true');a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True);tf.keras.utils.set_random_seed(91);rng=np.random.default_rng(91)
    assert tf.config.list_physical_devices('GPU'),'Metal GPU required';h=a.size//2;w=a.size
    with tf.device('/GPU:0'):model=build_model(h,w);opt=tf.keras.optimizers.Adam(learning_rate=.002,global_clipnorm=5.)
    warmup_history=[]
    if a.warmstart:
        model.load_weights(a.warmstart)
        hf=a.warmstart.parent/'history.json'
        if hf.exists():warmup_history=json.loads(hf.read_text())
    manifest={'architecture':model.name,'design':'MobileNetV3Small alpha .75 + FPN with stride-2 centers/offsets/properties + full-resolution semantic/pillness/print heads; bounded connected grouping; Panoptic-DeepLab inspired','parameters':model.count_params(),'batchnorm_momentum':.9,'epochs':a.epochs,'warmstart_synthetic_checkpoint':str(a.warmstart) if a.warmstart else None,'warmup_history':warmup_history,'target_contract':'center eligibility from >=10 full-input-resolution visible pixels; stride 2; evaluation min_area remains 10','loss_design':'weighted CE with exact print negatives, foreground/family Dice, center focal, offsets, visible attributes, pillness BCE and auxiliary graphic BCE','tensorflow':tf.__version__,'device':[str(x) for x in tf.config.list_physical_devices('GPU')],'input':[h,w,3],'pretrained':False,'output_tensors':['semantic','centers','offsets','attributes','pillness','graphic'],'heads':['16-class semantic','instance-center heatmap','2D pixel-to-center offsets','two nominal material color parameters','surface finish','score','damage','fraction'],'seed':91,'training_splits':['train'],'checkpoint_selection':'val pill-class mean IoU','grouping_threshold_selection':'val instance F1, grid .1/.2/.3/.4; 3x3 NMS at stride2','scope':'synthetic only; no medicine identity recognition','decoder':'max vote distance 12 head pixels; connected support; pillness logit > -.2','dataset':str(a.data)};(a.out/'manifest.json').write_text(json.dumps(manifest,indent=2));print('TF_START',json.dumps(manifest),flush=True)
    tr=load_data(a.data,'train',h,w);va=load_data(a.data,'val',h,w)
    if a.smoke:tr=tr[:16];va=va[:8]
    @tf.function(reduce_retracing=True,jit_compile=False)
    def step(x,y,t):
        with tf.device('/GPU:0'):
            with tf.GradientTape() as tape:
                out=model(x,training=True);loss,parts=losses(out,y,t)
            grads=tape.gradient(loss,model.trainable_variables);opt.apply_gradients(zip(grads,model.trainable_variables))
        return loss,parts
    history=[];best=-1;startall=time.time()
    for epoch in range(1,a.epochs+1):
        start=time.time();idx=rng.permutation(len(tr));total=0;partslist=[];lr=.00015+.00185*(1+np.cos(np.pi*(epoch-1)/a.epochs))/2;opt.learning_rate.assign(lr)
        for at in range(0,len(tr),a.batch_size):
            x,y,t=batch(tr,idx[at:at+a.batch_size],rng);loss,parts=step(x,y,t);total+=float(loss)*len(x);partslist.append(parts.numpy())
        v=evaluate(model,va,a.batch_size);row={'epoch':epoch,'train_loss':total/len(tr),'val_loss':v['loss'],'pill_binary_iou':v['pill_binary_iou'],'pill_class_mean_iou':v['pill_class_mean_iou'],'loss_components':dict(zip(['cross_entropy','foreground_dice','center_focal','offset_l1','attributes','family_dice','pillness','graphic'],np.mean(partslist,0).tolist())),'learning_rate':float(lr),'seconds':time.time()-start};history.append(row);(a.out/'history.json').write_text(json.dumps(history,indent=2));print('TF_EPOCH',json.dumps(row),flush=True)
        if v['pill_class_mean_iou']>best:best=v['pill_class_mean_iou'];selected=epoch;model.save(a.out/'best.keras')
    model.load_weights(a.out/'best.keras');thresholds=[]
    for threshold in [.1,.2,.3,.4]:
        v=evaluate(model,va,a.batch_size,threshold);thresholds.append({'threshold':threshold,**v['instances']})
    chosen=max(thresholds,key=lambda x:x['instance_f1_iou50']);threshold=chosen['threshold'];results={'selected_epoch':selected,'training_seconds':time.time()-startall,'warmup_seconds':sum(r['seconds'] for r in warmup_history),'center_threshold':threshold,'validation_threshold_search':thresholds,'scope':'Single learned forward pass + center/offset grouping; all evaluation synthetic. Input loading and grouping use CPU; TensorFlow model training uses Metal GPU.'}
    for split in ['val','test','stress']:
        items=va if split=='val' else load_data(a.data,split,h,w)
        if a.smoke:items=items[:4]
        results[split]=evaluate(model,items,a.batch_size,threshold,a.out/split);print('TF_EVAL',split,json.dumps({k:v for k,v in results[split].items() if k not in ['scenes','confusion','finish_confusion']}),flush=True)
    # Synchronize output copies to measure actual batch-1 forward time, excluding warmup.
    bx=batch(va,[0])[0]
    for _ in range(5):z=model(bx,training=False);z['semantic'].numpy()
    times=[]
    for _ in range(20):
        start=time.perf_counter();z=model(bx,training=False);[v.numpy() for v in z.values()];times.append((time.perf_counter()-start)*1000)
    results['latency']={'batch':1,'median_ms':float(np.median(times)),'p95_ms':float(np.percentile(times,95)),'scope':'All model heads forward + device-to-host output sync, excludes file load and grouping; GPU may be shared with rendering'};(a.out/'metrics.json').write_text(json.dumps(results,indent=2));print('TF_DONE',json.dumps(results['latency']),flush=True)
if __name__=='__main__':main()
