import argparse
import json
import time
from pathlib import Path
import numpy as np
from PIL import Image,ImageOps,ImageDraw
import torch
import torch.nn.functional as F
from .model import TinyUNet
from .metrics import instances_from_prediction
from .prepare import PALETTE,CLASSES
from .reconcile import compare_plan


def load(checkpoint,device='auto'):
    device=('mps' if torch.backends.mps.is_available() else 'cpu') if device=='auto' else device
    c=torch.load(checkpoint,map_location='cpu',weights_only=False);m=TinyUNet(c['classes'],c['base']);m.load_state_dict(c['model']);m.to(device).eval();return m,c,device


def predict(model,image,size,device):
    image=image.convert('RGB');w,h=image.size;tw,th=size,size//2;scale=min(tw/w,th/h);nw,nh=max(1,round(w*scale)),max(1,round(h*scale));left=(tw-nw)//2;top=(th-nh)//2
    canvas=Image.new('RGB',(tw,th),(114,114,114));canvas.paste(image.resize((nw,nh),Image.Resampling.BILINEAR),(left,top));x=torch.from_numpy(np.array(canvas,dtype=np.float32).transpose(2,0,1)/255)[None].to(device)
    with torch.inference_mode():
        z=model(x);z=z[:,:,top:top+nh,left:left+nw];z=F.interpolate(z,size=(h,w),mode='bilinear',align_corners=False);prob=z.softmax(1)[0].cpu().numpy()
    sem=prob.argmax(0).astype(np.uint8);ids,obs=instances_from_prediction(sem,prob,min_area=max(10,round(10/scale**2)))
    for o in obs:
        o['class_name']=CLASSES[o['class_id']]['name'];o['drug_identity']=None;o['uncertain']=o['confidence']<.7 or o['class_id']==13
    return sem,ids,obs,prob


def overlay(image,sem,obs):
    arr=np.array(image.convert('RGB'));mask=(sem>=2)&(sem<=14);color=PALETTE[sem];arr[mask]=(arr[mask]*.45+color[mask]*.55).astype(np.uint8);out=Image.fromarray(arr);draw=ImageDraw.Draw(out)
    for o in obs:
        box=o['bbox_xyxy'];draw.rectangle(box,outline='#ffbf63' if o['uncertain'] else 'white',width=2);draw.text((box[0],max(0,box[1]-12)),f"{o['instance_id']} {o['confidence']:.2f}",fill='white',stroke_width=1,stroke_fill='black')
    return out


def main():
    p=argparse.ArgumentParser();p.add_argument('image',type=Path);p.add_argument('--checkpoint',default='artifacts/run/best.pt');p.add_argument('--out',type=Path,default=Path('artifacts/inference'));p.add_argument('--plan',type=Path);p.add_argument('--device',default='auto');a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    m,c,device=load(a.checkpoint,a.device);im=Image.open(a.image).convert('RGB');predict(m,im,c['size'],device)
    if device=='mps':torch.mps.synchronize()
    start=time.perf_counter();sem,ids,obs,prob=predict(m,im,c['size'],device)
    if device=='mps':torch.mps.synchronize()
    seconds=time.perf_counter()-start;result={'input':str(a.image),'count_visible_candidates':len(obs),'instances':obs,'seconds_including_postprocessing':seconds,'identity_verified':False,'status':'REVIEW_REQUIRED','training_domain':'synthetic','clinical_use':False}
    if a.plan:result['plan_comparison']=compare_plan(obs,json.loads(a.plan.read_text()),im.size)
    Image.fromarray(sem).save(a.out/'semantic.png');Image.fromarray(ids.astype(np.uint16)).save(a.out/'instances.png');overlay(im,sem,obs).save(a.out/'overlay.png');(a.out/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
if __name__=='__main__':main()
