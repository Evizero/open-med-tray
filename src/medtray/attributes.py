"""Compact supervised pill embedding with rich attribute heads.
Size needs calibrated scene scale; thickness is only a learned appearance prior.
The marking head covers six synthetic strings. It is not general OCR.
"""
import argparse
import json
import random
import time
from pathlib import Path
import numpy as np
from PIL import Image,ImageEnhance,ImageOps
import torch
from torch import nn
from torch.nn import functional as F
from torch.utils.data import Dataset,DataLoader

FINISHES=['chalky_uncoated','matte_film','satin_film','gelatin_shell','softgel_shell']
MARKINGS=['','A1','B2','10','25','50']

class PillEncoder(nn.Module):
    def __init__(self):
        super().__init__();layers=[];ci=4
        for co in [16,32,64,96]:layers.extend([nn.Conv2d(ci,co,3,stride=2,padding=1,bias=False),nn.GroupNorm(4,co),nn.SiLU(),nn.Conv2d(co,co,3,padding=1,groups=co),nn.SiLU()]);ci=co
        self.features=nn.Sequential(*layers,nn.AdaptiveAvgPool2d(1),nn.Flatten());self.embedding=nn.Linear(96,128)
        self.family=nn.Linear(128,12);self.finish=nn.Linear(128,5);self.color=nn.Linear(128,6);self.score=nn.Linear(128,3);self.damage=nn.Linear(128,2);self.fraction=nn.Linear(128,2);self.marking=nn.Linear(128,6);self.dimensions=nn.Sequential(nn.Linear(131,64),nn.SiLU(),nn.Linear(64,3))
    def forward(self,x,calibration):
        e=F.normalize(self.embedding(self.features(x)),dim=1)
        return {'embedding':e,'family':self.family(e*4),'finish':self.finish(e*4),'color':self.color(e*4).sigmoid(),'score':self.score(e*4),'damage':self.damage(e*4),'fraction':self.fraction(e*4),'marking':self.marking(e*4),'dimensions':self.dimensions(torch.cat([e,calibration],1))}

class Crops(Dataset):
    def __init__(self,root,split,augment=False):
        self.items=[];self.augment=augment
        for f in sorted((Path(root)/split).glob('[0-9]*.json')):
            m=json.loads(f.read_text());im=Image.open(f.with_suffix('.png')).convert('RGB');ids=np.array(Image.open(f.with_name(f.stem+'_instance.png')))
            for o in m['objects']:
                if not 2<=o['class_id']<=13 or o.get('visible_pixels',0)<30 or not o.get('bbox_xyxy'):continue
                x0,y0,x1,y1=o['bbox_xyxy'];pad=3;x0=max(0,x0-pad);y0=max(0,y0-pad);x1=min(im.width,x1+pad);y1=min(im.height,y1+pad)
                crop=ImageOps.pad(im.crop((x0,y0,x1,y1)),(96,96),method=Image.Resampling.BILINEAR,color=(114,114,114));mask=ImageOps.pad(Image.fromarray((ids[y0:y1,x0:x1]==o['instance_id']).astype(np.uint8)*255),(96,96),method=Image.Resampling.NEAREST,color=0)
                scale=o.get('local_mm_per_pixel');scale_valid=scale is not None
                calibration=[(scale or .3)/.5,(x1-x0)/100,(y1-y0)/100]
                marking=o.get('imprint','') if o.get('imprint_rendered') else ''
                target={'family':o['class_id']-2,'finish':FINISHES.index(o['finish']),'color':list(o['color'])+list(o['secondary_color'] if o['family']=='hard_capsule' else o['color']),'score':o['score'],'damage':int(o['chip']>0),'fraction':int(o.get('dose_fraction',1)<1),'marking':MARKINGS.index(marking),'marking_valid':int('imprint_rendered' in o and not m['transparent_film'] and not o['stacked']),'dimensions':np.log(np.array([o['length_mm'],o['width_mm'],o['height_mm']])/10).tolist(),'dimensions_valid':int(scale_valid)}
                self.items.append((np.array(crop),np.array(mask),np.array(calibration,np.float32),target))
        if not self.items:raise ValueError('No crop targets')
    def __len__(self):return len(self.items)
    def __getitem__(self,i):
        rgb,mask,cal,t=self.items[i];im=Image.fromarray(rgb)
        if self.augment:
            im=ImageEnhance.Brightness(im).enhance(random.uniform(.82,1.18));im=ImageEnhance.Color(im).enhance(random.uniform(.85,1.15))
        x=np.concatenate([np.array(im,dtype=np.float32)/255,mask[...,None]/255],axis=2).astype(np.float32)
        targets={k:torch.tensor(v,dtype=torch.float32 if isinstance(v,list) else torch.long) for k,v in t.items()}
        return torch.from_numpy(x.transpose(2,0,1).copy()),torch.from_numpy(cal),targets


def objective(out,t):
    loss=F.cross_entropy(out['family'],t['family'])+.45*F.cross_entropy(out['finish'],t['finish'])+2*F.mse_loss(out['color'],t['color'])+.3*F.cross_entropy(out['score'],t['score'])+.2*F.cross_entropy(out['damage'],t['damage'])+.25*F.cross_entropy(out['fraction'],t['fraction'])
    valid=t['dimensions_valid'].bool()
    if valid.any():loss+=.3*F.smooth_l1_loss(out['dimensions'][valid],t['dimensions'][valid])
    valid=t['marking_valid'].bool()
    if valid.any():loss+=.3*F.cross_entropy(out['marking'][valid],t['marking'][valid])
    # Attribute similarity shapes the embedding across independent scenes; no drug identity is implied.
    e=out['embedding'];sim=e@e.T;target=((t['family'][:,None]==t['family'][None,:]).float()*.65+.35*torch.exp(-5*torch.cdist(t['color'][:,:3],t['color'][:,:3])))
    off=~torch.eye(len(e),dtype=torch.bool,device=e.device)
    if off.any():loss+=.2*F.mse_loss(sim[off],target[off])
    return loss


def evaluate(model,loader,device):
    model.eval();n=0;loss=0;correct={k:0 for k in ['family','finish','score','damage','fraction','marking']};markn=0;color=0;size=0;sizen=0
    confusions={k:np.zeros((nc,nc),dtype=np.int64) for k,nc in [('family',12),('finish',5),('score',3),('damage',2),('fraction',2),('marking',6)]}
    with torch.inference_mode():
        for x,c,t in loader:
            x=x.to(device);c=c.to(device);t={k:v.to(device) for k,v in t.items()};o=model(x,c);bs=len(x);n+=bs;loss+=float(objective(o,t))*bs
            for key in correct:
                v=t['marking_valid'].bool() if key=='marking' else torch.ones(bs,dtype=torch.bool,device=device)
                pred=o[key].argmax(1)[v];truth=t[key][v];correct[key]+=int((pred==truth).sum())
                nc=confusions[key].shape[0];confusions[key]+=np.bincount((truth*nc+pred).cpu().numpy(),minlength=nc*nc).reshape(nc,nc)
            markn+=int(t['marking_valid'].sum());color+=float((o['color']-t['color']).abs().sum())
            v=t['dimensions_valid'].bool()
            if v.any():size+=float((o['dimensions'][v].exp()*10-t['dimensions'][v].exp()*10).abs().sum());sizen+=int(v.sum())
    balanced={}
    for key,conf in confusions.items():
        support=conf.sum(1);valid=support>0;balanced[key+'_balanced_accuracy']=float((np.diag(conf)[valid]/support[valid]).mean()) if valid.any() else None
    mc=confusions['marking'];nonblank=int(mc[1:].sum());balanced['marking_nonblank_accuracy']=float(np.diag(mc)[1:].sum()/nonblank) if nonblank else None
    return {'loss':loss/n,**balanced,'attribute_confusions':{k:v.tolist() for k,v in confusions.items()},'crops':n,**{k+'_accuracy':(None if k=='marking' and not markn else val/max(markn if k=='marking' else n,1)) for k,val in correct.items()},'marking_evaluable_crops':markn,'reflectance_color_mae':color/(n*6),'dimensions_mae_mm':size/(sizen*3) if sizen else None,'dimensions_evaluable_crops':sizen}


def main():
    p=argparse.ArgumentParser();p.add_argument('--data',default='artifacts/dataset-v2');p.add_argument('--out',type=Path,default=Path('artifacts/embedding'));p.add_argument('--epochs',type=int,default=25);p.add_argument('--batch-size',type=int,default=96);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True);torch.manual_seed(12);np.random.seed(12);random.seed(12);torch.set_num_threads(8)
    device='mps' if torch.backends.mps.is_available() else 'cpu';tr=Crops(a.data,'train',True);va=Crops(a.data,'val');dl=DataLoader(tr,batch_size=a.batch_size,shuffle=True);vl=DataLoader(va,batch_size=a.batch_size);model=PillEncoder().to(device);opt=torch.optim.AdamW(model.parameters(),lr=.0015);history=[];best=1e9
    manifest={'embedding_dimensions':128,'parameters':sum(p.numel() for p in model.parameters()),'train_crops':len(tr),'val_crops':len(va),'pretrained':False,'dimensions_require_calibration':True,'thickness_is_learned_prior':True,'marking_vocabulary':MARKINGS,'general_ocr':False,'identity_training':False,'device':device};(a.out/'manifest.json').write_text(json.dumps(manifest,indent=2));print('EMBEDDING_START '+json.dumps(manifest),flush=True)
    for epoch in range(1,a.epochs+1):
        model.train();total=0;start=time.time()
        for x,c,t in dl:
            x=x.to(device);c=c.to(device);t={k:v.to(device) for k,v in t.items()};opt.zero_grad(set_to_none=True);o=model(x,c);loss=objective(o,t);loss.backward();opt.step();total+=float(loss.detach())*len(x)
        metrics=evaluate(model,vl,device);r={'epoch':epoch,'train_loss':total/len(tr),'val':metrics,'seconds':time.time()-start};history.append(r);(a.out/'history.json').write_text(json.dumps(history,indent=2))
        if metrics['loss']<best:best=metrics['loss'];torch.save({'model':{k:v.cpu() for k,v in model.state_dict().items()},'manifest':manifest,'epoch':epoch},a.out/'best.pt')
        print('EMBEDDING_EPOCH '+json.dumps(r),flush=True)
    checkpoint=torch.load(a.out/'best.pt',map_location='cpu',weights_only=False);model.load_state_dict(checkpoint['model']);result={}
    for split in ['test','stress']:result[split]=evaluate(model,DataLoader(Crops(a.data,split),batch_size=a.batch_size),device)
    result['scope']='Oracle synthetic instance crops; end-to-end and real-world calibration performance unvalidated';(a.out/'metrics.json').write_text(json.dumps(result,indent=2));print('EMBEDDING_DONE '+json.dumps(result),flush=True)
if __name__=='__main__':main()
