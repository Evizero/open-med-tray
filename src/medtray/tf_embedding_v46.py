"""TensorFlow Metal appearance embeddings, supervised with procedural attributes.
Oracle visible-instance crops; no drug identities, milligram inference, or text OCR.
"""
import argparse,base64,io,json,os,time
from pathlib import Path
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL','1')
import numpy as np
from PIL import Image,ImageOps
import tensorflow as tf
from .appearance_scale import extent_features
from .visibility import score_is_presented,imprint_is_presented
FINISHES=['chalky_uncoated','matte_film','satin_film','gelatin_shell','softgel_shell']
LAYOUTS=['none','printed','text','cross','stacked','boxed','symbol_code','custom']
CLASS_WEIGHTS={}
HEADS={'family':12,'finish':5,'score':3,'damage':2,'fraction':2,'layout':8}


def build_model():
 L=tf.keras.layers
 image=L.Input((96,96,4),name='rgb_mask');cal=L.Input((3,),name='calibrated_extent')
 # MobileNetV3 keeps local texture, SE channel gates and compact inverted residual blocks.
 enc=tf.keras.applications.MobileNetV3Small(input_shape=(96,96,4),alpha=.35,include_top=False,weights=None,include_preprocessing=False,pooling='avg')
 for layer in enc.layers:
  if isinstance(layer,L.BatchNormalization):layer.momentum=.9
 z=enc(image);z=L.Concatenate(name='appearance_and_scale')([z,cal]);z=L.Dense(128,name='appearance_projection')(z);emb=L.UnitNormalization(axis=-1,name='embedding')(z)
 out={'embedding':emb,**{k:L.Dense(n,name=k)(emb) for k,n in HEADS.items()},'color':L.Dense(6,activation='sigmoid',name='color')(emb)}
 out['dimensions']=L.Dense(3,name='dimensions')(L.Dense(48,activation='swish')(L.Concatenate()([emb,cal])))
 out['profile']=L.Dense(4,name='profile')(emb)
 return tf.keras.Model([image,cal],out,name='MedTray_Appearance_MobileNetV3_128')


def load_crops(root,split):
 xs=[];cs=[];ts={k:[] for k in [*HEADS,'color','dimensions','profile','profile_valid','layout_valid','score_valid']};rows=[]
 for f in sorted((Path(root)/split).glob('[0-9]*.json')):
  m=json.loads(f.read_text());im=Image.open(f.with_suffix('.png')).convert('RGB');ids=np.array(Image.open(f.with_name(f.stem+'_instance.png')))
  for o in m['objects']:
   if not 2<=o['class_id']<=13 or o.get('visible_pixels',0)<30 or not o.get('bbox_xyxy'):continue
   a,b,c,d=o['bbox_xyxy'];object_w,object_h=c-a,d-b;a=max(0,a-3);b=max(0,b-3);c=min(im.width,c+3);d=min(im.height,d+3)
   rgb=ImageOps.pad(im.crop((a,b,c,d)),(96,96),method=Image.Resampling.BILINEAR,color=(114,114,114))
   mask=ImageOps.pad(Image.fromarray((ids[b:d,a:c]==o['instance_id']).astype(np.uint8)*255),(96,96),method=Image.Resampling.NEAREST,color=0)
   xs.append(np.concatenate([np.array(rgb,dtype=np.float32)/127.5-1,np.array(mask)[...,None]/255],-1).astype(np.float32))
   scale=o['local_mm_per_pixel'];cs.append(extent_features(object_w,object_h,scale))
   mark=o.get('imprint_parameters') or {};layout=mark.get('layout','text') if o.get('imprint_rendered') else 'none'
   if o.get('imprint_style')=='printed':layout='printed'
   values={'family':o['class_id']-2,'finish':FINISHES.index(o['finish']),'score':o['score'],'damage':int(o['chip']>0),'fraction':int(o.get('dose_fraction',1)<1),'layout':LAYOUTS.index(layout),'color':[*o['color'],*(o['secondary_color'] if o['family']=='hard_capsule' or o.get('two_tone',False) else o['color'])],'dimensions':np.log(np.array([o['length_mm'],o['width_mm'],o['height_mm']])/10),'profile':[o.get('score_width_mm',0),o.get('score_depth_mm',0),o.get('face_rim_width_mm',0),o.get('crown_height_mm',0)],'profile_valid':[float(score_is_presented(o)),float(score_is_presented(o)),float(o['family'] not in ['hard_capsule','softgel','ring_tablet']),float(o['family'] not in ['hard_capsule','softgel','ring_tablet'])],'score_valid':float((o.get('face_up',True) or o.get('score_faces')=='both') and not o['stacked']),'layout_valid':float((not o.get('imprint_rendered') or imprint_is_presented(o)) and not o['stacked'] and o.get('glare_pixel_fraction',0)<.3)}
   for k,v in values.items():ts[k].append(v)
   thumb=io.BytesIO();rgb.resize((48,48)).save(thumb,format='JPEG',quality=75)
   rows.append({'id':f'{split}/{f.stem}/{o["instance_id"]}','split':split,'scene':f.stem,'instance_id':o['instance_id'],'family':o['family'],'class_id':o['class_id'],'finish':o['finish'],'color':o['color'],'layout':layout,'score':o['score'],'damage':bool(o['chip']),'fraction':o.get('dose_fraction',1),'dimensions_mm':[o['length_mm'],o['width_mm'],o['height_mm']],'color_family':o.get('color_family'),'secondary_color':o['secondary_color'],'two_tone':o.get('two_tone',False),'softgel_shape':o.get('softgel_parameters',{}).get('shape'),'softgel_opacity':o.get('softgel_opacity'),'lighting':m['lighting'],'film':m['transparent_film'],'thumbnail':'data:image/jpeg;base64,'+base64.b64encode(thumb.getvalue()).decode()})
 return np.stack(xs),np.array(cs,np.float32),{k:np.array(v,np.int32 if k in HEADS else np.float32) for k,v in ts.items()},rows


def objective(out,t):
 parts=[];weights={'family':1.,'finish':.4,'score':.25,'damage':.25,'fraction':.25,'layout':.20}
 for k in HEADS:
  ce=tf.nn.sparse_softmax_cross_entropy_with_logits(labels=t[k],logits=out[k])
  if k in CLASS_WEIGHTS:ce*=tf.gather(tf.constant(CLASS_WEIGHTS[k],tf.float32),t[k])
  if k in ['layout','score']:ce=tf.reduce_sum(ce*t[k+'_valid'])/tf.maximum(tf.reduce_sum(t[k+'_valid']),1.)
  else:ce=tf.reduce_mean(ce)
  parts.append(ce*weights[k])
 parts.append(2*tf.reduce_mean(tf.square(out['color']-t['color'])))
 parts.append(.3*tf.reduce_mean(tf.abs(out['dimensions']-t['dimensions'])))
 parts.append(.1*tf.reduce_sum(tf.abs(out['profile']-t['profile'])*t['profile_valid'])/tf.maximum(tf.reduce_sum(t['profile_valid']),1.))
 e=out['embedding'];sim=e@tf.transpose(e);same=tf.cast(t['family'][:,None]==t['family'][None,:],tf.float32)
 dist=tf.reduce_sum(tf.square(t['color'][:,None,:3]-t['color'][None,:,:3]),-1)
 size_dist=tf.reduce_sum(tf.square(t['dimensions'][:,None,:2]-t['dimensions'][None,:,:2]),-1)
 target=.55*same+.30*tf.exp(-5*tf.sqrt(dist+1e-8))+.15*tf.exp(-2*size_dist);off=1-tf.eye(tf.shape(e)[0])
 parts.append(.15*tf.reduce_sum(tf.square(sim-target)*off)/tf.maximum(tf.reduce_sum(off),1.))
 return tf.add_n(parts)


def predictions(model,data,batchsize=96):
 x,c,t,rows=data;out={}
 for i in range(0,len(x),batchsize):
  for k,v in model([x[i:i+batchsize],c[i:i+batchsize]],training=False).items():out.setdefault(k,[]).append(v.numpy())
 return {k:np.concatenate(v) for k,v in out.items()}


def score(out,data):
 x,c,t,rows=data;metrics={'crops':len(x)}
 for k,n in HEADS.items():
  valid=t[k+'_valid']>0 if k in ['layout','score'] else np.ones(len(x),bool)
  pred=out[k].argmax(-1);conf=np.bincount((t[k][valid]*n+pred[valid]),minlength=n*n).reshape(n,n);support=conf.sum(1);present=support>0
  metrics[k]={'accuracy':float(np.trace(conf)/conf.sum()) if conf.sum()>0 else None,'balanced_accuracy':float((np.diag(conf)[present]/support[present]).mean()) if present.any() else None,'confusion':conf.tolist(),'evaluated':int(valid.sum())}
 metrics['color_mae']=float(np.abs(out['color']-t['color']).mean());metrics['dimensions_mae_mm']=float(np.abs(np.exp(out['dimensions'])*10-np.exp(t['dimensions'])*10).mean())
 valid=t['profile_valid']>0;err=np.abs(out['profile']-t['profile']);metrics['profile_mae_mm']=[float(err[valid[:,j],j].mean()) if valid[:,j].any() else None for j in range(4)]
 return metrics


def main():
 p=argparse.ArgumentParser();p.add_argument('--data',type=Path,default=Path('artifacts/dataset-v46-combined'));p.add_argument('--out',type=Path,default=Path('artifacts/tf-embedding-v46'));p.add_argument('--epochs',type=int,default=28);p.add_argument('--batch-size',type=int,default=96);p.add_argument('--smoke',action='store_true');a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
 assert tf.config.list_physical_devices('GPU'),'TensorFlow Metal required';tf.keras.utils.set_random_seed(719);rng=np.random.default_rng(719)
 with tf.device('/GPU:0'):m=build_model();opt=tf.keras.optimizers.Adam(.002,global_clipnorm=5.)
 if a.smoke:
  x=np.zeros((4,96,96,4),np.float32);cal=np.ones((4,3),np.float32);t={k:np.zeros(4,np.int32) for k in HEADS};t.update(color=np.zeros((4,6),np.float32),dimensions=np.zeros((4,3),np.float32),profile=np.zeros((4,4),np.float32),profile_valid=np.ones((4,4),np.float32),layout_valid=np.ones(4,np.float32),score_valid=np.ones(4,np.float32))
  with tf.device('/GPU:0'):
   with tf.GradientTape() as tape:out=m([x,cal],training=True);loss=objective(out,t)
   grads=tape.gradient(loss,m.trainable_variables);opt.apply_gradients(zip(grads,m.trainable_variables))
  evidence={'parameters':m.count_params(),'heads':{k:v.device for k,v in out.items()},'gradients':len(grads),'gpu_gradients':sum(g is not None and 'GPU:0' in g.device for g in grads),'loss':float(loss)}
  assert evidence['gpu_gradients']==len(grads);assert all('GPU:0' in v for v in evidence['heads'].values());m.save(a.out/'smoke.keras');tf.keras.models.load_model(a.out/'smoke.keras',compile=False);(a.out/'gpu-verification.json').write_text(json.dumps(evidence,indent=2));print('EMBED_GPU_VERIFIED',json.dumps(evidence));return
 tr=load_crops(a.data,'train');va=load_crops(a.data,'val');history=[];best=-1;start=time.time()
 for k,n in HEADS.items():
  support=np.bincount(tr[2][k],minlength=n).astype(float);weights=np.clip(np.sqrt(len(tr[0])/(n*np.maximum(support,1))),.4,4.);weights/=np.sum(weights*support)/len(tr[0]);CLASS_WEIGHTS[k]=weights.tolist()
 manifest={'architecture':m.name,'parameters':m.count_params(),'dimensions':128,'device':[str(g) for g in tf.config.list_physical_devices('GPU')],'tensorflow':tf.__version__,'initialization':'random; no prior weights','dataset':str(a.data),'train_crops':len(tr[0]),'val_crops':len(va[0]),'epochs':a.epochs,'layouts':LAYOUTS,'head_classes':HEADS,'embedding_requires_calibrated_scale':True,'calibration_features':['un-padded object bbox width in mm / 20','un-padded object bbox height in mm / 20','short/long bbox aspect ratio'],'calibration_resolution_invariant':True,'similarity_supervision':'family, nominal material colour and nominal length/width','profile_outputs':['score_width_mm','score_depth_mm','face_rim_width_mm','crown_height_mm'],'scope':'oracle visible-instance crops; synthetic appearance, not drug identity or OCR; dimensions require supplied camera calibration; thickness/profile are learned priors','checkpoint_selection':'val family balanced accuracy','class_weights':CLASS_WEIGHTS,'visibility':'score eligibility respects both-face grooves; imprint eligibility accounts for capsule roll; stacked targets excluded; layout glare fraction < .3; these remain visibility priors','dataset_revision':46}
 (a.out/'manifest.json').write_text(json.dumps(manifest,indent=2))
 @tf.function(jit_compile=False,reduce_retracing=True)
 def step(x,c,t):
  with tf.device('/GPU:0'):
   with tf.GradientTape() as tape:out=m([x,c],training=True);loss=objective(out,t)
   g=tape.gradient(loss,m.trainable_variables);opt.apply_gradients(zip(g,m.trainable_variables))
  return loss
 for epoch in range(1,a.epochs+1):
  before=time.time();idx=rng.permutation(len(tr[0]));total=0;opt.learning_rate.assign(.00015+.00185*(1+np.cos(np.pi*(epoch-1)/a.epochs))/2)
  for at in range(0,len(idx),a.batch_size):
   ix=idx[at:at+a.batch_size];x=tr[0][ix].copy();x[...,:3]=np.clip((x[...,:3]+1)*rng.uniform(.88,1.12,(len(ix),1,1,1))-1,-1,1)
   for j in range(len(x)):
    if rng.random()<.5:x[j]=x[j,:,::-1,:]
    if rng.random()<.5:x[j]=x[j,::-1,:,:]
   loss=step(x,tr[1][ix],{k:v[ix] for k,v in tr[2].items()});total+=float(loss)*len(ix)
  vo=predictions(m,va);vm=score(vo,va);vl=float(objective({k:tf.convert_to_tensor(v) for k,v in vo.items()},va[2]));row={'epoch':epoch,'train_loss':total/len(idx),'val_loss':vl,'family_balanced_accuracy':vm['family']['balanced_accuracy'],'finish_balanced_accuracy':vm['finish']['balanced_accuracy'],'seconds':time.time()-before};history.append(row);(a.out/'history.json').write_text(json.dumps(history,indent=2));print('EMBED_EPOCH',json.dumps(row),flush=True)
  if row['family_balanced_accuracy']>best:best=row['family_balanced_accuracy'];selected=epoch;m.save(a.out/'best.keras')
 m.load_weights(a.out/'best.keras');result={'selected_epoch':selected,'seconds':time.time()-start,'scope':manifest['scope']};all_rows=[];all_embeddings=[]
 for split,data in [('train',tr),('val',va),('test',load_crops(a.data,'test')),('stress',load_crops(a.data,'stress'))]:
  out=predictions(m,data);result[split]=score(out,data)
  choose=np.sort(rng.choice(len(data[0]),min(650 if split=='train' else 200,len(data[0])),replace=False))
  all_embeddings.append(out['embedding'][choose])
  for i in choose:
   row=data[3][i].copy();row['predicted_family_id']=int(out['family'][i].argmax())+2;row['predicted_finish']=FINISHES[int(out['finish'][i].argmax())];all_rows.append(row)
 embeddings=np.concatenate(all_embeddings);ntrain=len(all_embeddings[0]);center=embeddings[:ntrain].mean(0);u,sv,vt=np.linalg.svd(embeddings[:ntrain]-center,full_matrices=False);basis=vt[:3];xyz=(embeddings-center)@basis.T;variance=sv[:3]**2/(sv**2).sum()
 for i,row in enumerate(all_rows):
  sim=embeddings[i]@embeddings[:ntrain].T
  if i<ntrain:sim[i]=-2
  nearest=np.argsort(-sim)[:5];row['xyz']=xyz[i].tolist();row['neighbors']=[{'id':all_rows[j]['id'],'cosine':float(sim[j])} for j in nearest]
 projection={'method':'PCA','fit_split':'train','fit_count':ntrain,'embedding_dimensions':128,'explained_variance':variance.tolist(),'points':all_rows,'note':'Oracle crops; nearest neighbours from training only. Cosine similarity is not identity probability.'}
 (a.out/'projection.json').write_text(json.dumps(projection));np.savez_compressed(a.out/'embeddings.npz',embeddings=embeddings,pca_mean=center,pca_basis=basis,ids=np.array([r['id'] for r in all_rows]));(a.out/'metrics.json').write_text(json.dumps(result,indent=2));print('EMBED_DONE',json.dumps({k:v for k,v in result.items() if k in ['selected_epoch','seconds']}),flush=True)
if __name__=='__main__':main()
