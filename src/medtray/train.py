import argparse
import csv
import json
import os
import random
import time
from pathlib import Path
import numpy as np
import torch
from torch.utils.data import DataLoader
from .data import TrayDataset
from .model import TinyUNet,segmentation_loss
from .metrics import semantic_metrics


def evaluate(model,loader,device,weights):
    model.eval();conf=np.zeros((16,16),np.int64);loss=0
    with torch.inference_mode():
        for x,y in loader:
            x=x.to(device);y=y.to(device);z=model(x);loss+=float(segmentation_loss(z,y,weights))*len(x)
            p=z.argmax(1).cpu().numpy();t=y.cpu().numpy();conf+=np.bincount((t*16+p).ravel(),minlength=256).reshape(16,16)
    return loss/len(loader.dataset),semantic_metrics(conf),conf


def main():
    p=argparse.ArgumentParser();p.add_argument('--data',default='artifacts/dataset');p.add_argument('--out',default='artifacts/run');p.add_argument('--epochs',type=int,default=35);p.add_argument('--batch-size',type=int,default=12);p.add_argument('--size',type=int,default=320);p.add_argument('--seed',type=int,default=41);p.add_argument('--base',type=int,default=16);p.add_argument('--device',default='auto');a=p.parse_args()
    random.seed(a.seed);np.random.seed(a.seed);torch.manual_seed(a.seed);torch.set_num_threads(8)
    device=('mps' if torch.backends.mps.is_available() else 'cpu') if a.device=='auto' else a.device
    out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
    tr=TrayDataset(a.data,'train',a.size,True);va=TrayDataset(a.data,'val',a.size)
    train=DataLoader(tr,batch_size=a.batch_size,shuffle=True,num_workers=0);val=DataLoader(va,batch_size=a.batch_size,num_workers=0)
    model=TinyUNet(16,a.base).to(device);params=sum(p.numel() for p in model.parameters())
    hist=np.zeros(16)
    for _,y in tr.cache:hist+=np.bincount(y.ravel(),minlength=16)
    weights=1/np.sqrt(np.maximum(hist/hist.sum(),.0005));weights=np.minimum(weights,25);weights/=weights.mean();weights=torch.tensor(weights,dtype=torch.float32,device=device)
    optimizer=torch.optim.AdamW(model.parameters(),lr=.0015,weight_decay=.0001)
    scheduler=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,a.epochs,eta_min=.00008)
    manifest=vars(a)|{'device_actual':device,'parameters':params,'train_images':len(tr),'val_images':len(va),'pretrained':False,'clinical_use':False,'classes':'appearance families; not product identities','torch_version':torch.__version__}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2));print('TRAIN_START '+json.dumps(manifest),flush=True)
    best=-1;history=[];start=time.time()
    for epoch in range(1,a.epochs+1):
        t=time.time();model.train();loss=0
        for x,y in train:
            x=x.to(device);y=y.to(device);optimizer.zero_grad(set_to_none=True);z=model(x);l=segmentation_loss(z,y,weights);l.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),5);optimizer.step();loss+=float(l.detach())*len(x)
        vl,metrics,_=evaluate(model,val,device,weights)
        row={'epoch':epoch,'train_loss':loss/len(tr),'val_loss':vl,**metrics,'lr':scheduler.get_last_lr()[0],'seconds':time.time()-t};history.append(row)
        score=metrics['pill_class_mean_iou']
        state={'model':{k:v.detach().cpu() for k,v in model.state_dict().items()},'base':a.base,'classes':16,'size':a.size,'epoch':epoch,'manifest':manifest}
        if score>best:best=score;torch.save(state,out/'best.pt')
        torch.save(state,out/'last.pt');(out/'history.json').write_text(json.dumps(history,indent=2))
        print('EPOCH '+json.dumps({k:v for k,v in row.items() if k!='per_class_iou'}),flush=True);scheduler.step()
    state=torch.load(out/'best.pt',map_location='cpu',weights_only=False);model.load_state_dict(state['model']);results={}
    for split in ['val','test','stress']:
        ds=TrayDataset(a.data,split,a.size);dl=DataLoader(ds,batch_size=a.batch_size,num_workers=0)
        l,m,c=evaluate(model,dl,device,weights);results[split]={'loss':l,**m,'images':len(ds)};np.save(out/f'{split}_confusion.npy',c)
    results['training_seconds']=time.time()-start;results['selected_epoch']=state['epoch'];results['evaluation_scope']='synthetic only; no real-world performance claim'
    (out/'metrics.json').write_text(json.dumps(results,indent=2));print('TRAIN_DONE '+json.dumps(results),flush=True)
if __name__=='__main__':main()
