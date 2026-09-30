"""Real-image inference with the single-pass TensorFlow Metal model; no identity approval."""
import argparse,json,time
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
import tensorflow as tf
from .tf_panoptic_v46 import decode
from .reconcile import compare_plan
FAMILIES=["round_flat","round_biconvex","oval_tablet","caplet","hard_capsule","softgel","oblong_tablet","triangular_tablet","diamond_tablet","hexagonal_tablet","ring_tablet","unknown_shape"]


def predict(model,image,threshold=.2):
    image=image.convert('RGB');ih,iw=model.input_shape[1:3];w,h=image.size;scale=min(iw/w,ih/h);nw,nh=max(1,round(w*scale)),max(1,round(h*scale));left=(iw-nw)//2;top=(ih-nh)//2;canvas=Image.new('RGB',(iw,ih),(114,114,114));canvas.paste(image.resize((nw,nh),Image.Resampling.BILINEAR),(left,top));x=np.array(canvas,dtype=np.float32)[None]/127.5-1
    start=time.perf_counter();raw=model(x,training=False);out={k:v.numpy()[0] for k,v in raw.items()};sem,ids,objects=decode(out,threshold)
    sem=np.array(Image.fromarray(sem[top:top+nh,left:left+nw]).resize((w,h),Image.Resampling.NEAREST));ids=np.array(Image.fromarray(ids[top:top+nh,left:left+nw]).resize((w,h),Image.Resampling.NEAREST));lookup={o['instance_id']:o for o in objects};obs=[]
    for iid in np.unique(ids):
        if not iid:continue
        yy,xx=np.where(ids==iid)
        if len(xx)<10:continue
        original=lookup[int(iid)];cls=original['class_id'];o=dict(original);o.update(class_name=FAMILIES[cls-2],bbox_xyxy=[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)],centroid_xy=[float(xx.mean()),float(yy.mean())],area_pixels=len(xx),uncertain=original['confidence']<.7 or cls==13,drug_identity=None)
        # Pool dense attributes over the predicted instance at head resolution.
        fullmask=np.zeros((ih,iw),np.uint8);fullmask[top:top+nh,left:left+nw]=np.array(Image.fromarray((ids==iid).astype(np.uint8)).resize((nw,nh),Image.Resampling.NEAREST));mk=np.array(Image.fromarray(fullmask).resize((out['attributes'].shape[1],out['attributes'].shape[0]),Image.Resampling.NEAREST))>0
        if mk.any():
            a=out['attributes'][mk].mean(0);o['appearance_attributes']={'material_color_parameters':(1/(1+np.exp(-a[:6]))).reshape(2,3).tolist(),'finish':['chalky_uncoated','matte_film','satin_film','gelatin_shell','softgel_shell'][a[6:11].argmax()],'score_lines':int(a[11:14].argmax()),'damage_candidate':bool(a[14:16].argmax()),'partial_candidate':bool(a[16:18].argmax())}
        obs.append(o)
    return sem,ids,obs,time.perf_counter()-start


def main():
    p=argparse.ArgumentParser();p.add_argument('image',type=Path);p.add_argument('--run',type=Path,default=Path('artifacts/tf-panoptic-v46'));p.add_argument('--out',type=Path,default=Path('artifacts/tf-inference-v46'));p.add_argument('--plan',type=Path);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True);model=tf.keras.models.load_model(a.run/'best.keras',compile=False);threshold=json.loads((a.run/'metrics.json').read_text())['center_threshold'];image=Image.open(a.image).convert('RGB');predict(model,image,threshold);sem,ids,obs,seconds=predict(model,image,threshold);colors=np.array([x['color'] for x in json.loads(Path('configs/classes.json').read_text())],np.uint8);rgb=np.array(image);mask=(sem>=2)&(sem<=13);rgb[mask]=(rgb[mask]*.5+colors[sem[mask]]*.5).astype(np.uint8);overlay=Image.fromarray(rgb);draw=ImageDraw.Draw(overlay)
    for o in obs:draw.rectangle(o['bbox_xyxy'],outline='#ffbc66',width=2);draw.text((o['bbox_xyxy'][0],max(0,o['bbox_xyxy'][1]-12)),str(o['instance_id']),fill='white',stroke_width=1,stroke_fill='black')
    result={'count_visible_candidates':len(obs),'instances':obs,'seconds_including_postprocessing':seconds,'center_threshold':threshold,'status':'REVIEW_REQUIRED','identity_verified':False,'administration_authorized':False,'clinical_use':False,'training_domain':'synthetic','device':[str(g) for g in tf.config.list_physical_devices('GPU')]}
    if a.plan:result['plan_comparison']=compare_plan(obs,json.loads(a.plan.read_text()),image.size)
    Image.fromarray(sem).save(a.out/'semantic.png');Image.fromarray(ids.astype(np.uint16)).save(a.out/'instances.png');overlay.save(a.out/'overlay.png');(a.out/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
if __name__=='__main__':main()
