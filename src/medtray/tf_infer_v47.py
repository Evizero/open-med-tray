"""Single-image inference for the compact v4.7 model; aspect-preserving input."""
import argparse,hashlib,json,time
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from scipy.special import softmax
import tensorflow as tf
from .tf_panoptic_v47 import decode
from .reconcile import compare_plan
R=Path(__file__).resolve().parents[2]
CLASSES=json.loads((R/'configs/classes.json').read_text())

def native_output(raw,center_threshold,mask_threshold):
    sem,ids,obs=decode(raw,center_threshold,mask_threshold)
    reference=np.array(Image.fromarray(ids).resize((512,256),Image.Resampling.NEAREST))
    keep={int(i) for i in np.unique(reference) if i and (reference==i).sum()>=10}
    ids[~np.isin(ids,list(keep))]=0
    return sem,ids,[o for o in obs if o['instance_id'] in keep]

def predict(model,image,center_threshold,mask_threshold,size=640):
    start=time.perf_counter();image=image.convert('RGB');w,h=image.size;iw,ih=size,size//2
    scale=min(iw/w,ih/h);nw,nh=max(1,round(w*scale)),max(1,round(h*scale));left,top=(iw-nw)//2,(ih-nh)//2
    canvas=Image.new('RGB',(iw,ih),(114,114,114));canvas.paste(image.resize((nw,nh),Image.Resampling.BILINEAR),(left,top))
    x=np.array(canvas,dtype=np.float32)[None]/127.5-1;raw={k:v.numpy()[0] for k,v in model(x,training=False).items()}
    sem,ids,objects=native_output(raw,center_threshold,mask_threshold);family=softmax(raw['family'],axis=-1)
    lookup={}
    for o in objects:
        mask=np.array(Image.fromarray((ids==o['instance_id']).astype(np.uint8)).resize((family.shape[1],family.shape[0]),Image.Resampling.NEAREST))>0
        o=dict(o);o['family_confidence']=float(family[mask,o['class_id']-2].mean()) if mask.any() else 0.;lookup[o['instance_id']]=o
    sem=np.array(Image.fromarray(sem[top:top+nh,left:left+nw]).resize((w,h),Image.Resampling.NEAREST))
    ids=np.array(Image.fromarray(ids[top:top+nh,left:left+nw]).resize((w,h),Image.Resampling.NEAREST));obs=[]
    for iid in np.unique(ids):
        if not iid:continue
        yy,xx=np.where(ids==iid);o=dict(lookup[int(iid)]);cls=o['class_id']
        o.update(class_name=CLASSES[cls]['name'],bbox_xyxy=[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)],centroid_xy=[float(xx.mean()),float(yy.mean())],area_pixels=len(xx),uncertain=o['confidence']<.7 or o['family_confidence']<.55 or cls==13,drug_identity=None)
        obs.append(o)
    return sem,ids,obs,time.perf_counter()-start

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('image',type=Path);p.add_argument('--run',type=Path,default=R/'artifacts/tf-panoptic-v47-strong');p.add_argument('--out',type=Path,default=R/'artifacts/tf-inference-v47');p.add_argument('--plan',type=Path);a=p.parse_args()
    assert tf.config.list_physical_devices('GPU'),'TensorFlow Metal GPU required';a.out.mkdir(parents=True,exist_ok=True)
    man=json.loads((a.run/'manifest.json').read_text());val=json.loads((a.run/'validation.json').read_text());size=val.get('inference_size',man['size']);ct,mt=val['center_threshold'],val['mask_threshold']
    model=tf.keras.models.load_model(a.run/'best.keras',compile=False);im=Image.open(a.image).convert('RGB');predict(model,im,ct,mt,size);sem,ids,obs,seconds=predict(model,im,ct,mt,size)
    colors=np.array([c['color'] for c in CLASSES],np.uint8);rgb=np.array(im);fg=ids>0;rgb[fg]=(rgb[fg]*.55+colors[sem[fg]]*.45).astype(np.uint8);overlay=Image.fromarray(rgb);dr=ImageDraw.Draw(overlay)
    for o in obs:
        b=o['bbox_xyxy'];dr.rectangle(b,outline='#ffbd6b',width=2);dr.text((b[0],max(0,b[1]-12)),str(o['instance_id']),fill='white',stroke_width=1,stroke_fill='#172c33')
    result=dict(candidate_count=len(obs),instances=obs,input_size=[size,size//2],center_threshold=ct,mask_threshold=mt,seconds_including_preprocessing_and_grouping=seconds,checkpoint_sha256=hashlib.sha256((a.run/'best.keras').read_bytes()).hexdigest(),scope='Synthetic-only prototype. Confidence is mean foreground score; family_confidence is mean family-head probability. Neither is calibrated identity confidence. Uncertain flag is a heuristic, not a validated rejection rule.',identity_verified=False,administration_authorized=False)
    if a.plan:
        appearances=[{**o,'confidence':min(o['confidence'],o['family_confidence'])} for o in obs]
        result['plan_comparison']=compare_plan(appearances,json.loads(a.plan.read_text()),im.size)
    Image.fromarray(sem.astype(np.uint8)).save(a.out/'semantic.png');Image.fromarray(ids.astype(np.uint16)).save(a.out/'instances.png');overlay.save(a.out/'overlay.png');(a.out/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='instances'},indent=2))
if __name__=='__main__':main()
