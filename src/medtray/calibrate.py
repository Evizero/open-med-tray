"""Frozen embedding reference bank. Returns ranked candidates with review, never dose approval.
Input manifest is explicitly labeled object crops plus masks; no patient information is needed.
"""
import argparse
import json
import hashlib
from pathlib import Path
import numpy as np
from PIL import Image,ImageOps
import torch
from .attributes import PillEncoder,FINISHES,MARKINGS


def load_encoder(path):
    device='mps' if torch.backends.mps.is_available() else 'cpu';state=torch.load(path,map_location='cpu',weights_only=False);m=PillEncoder().to(device);m.load_state_dict(state['model']);m.eval();return m,device


def encode(model,device,image,mask,mm_per_pixel=None):
    if mm_per_pixel is not None and (not np.isfinite(mm_per_pixel) or mm_per_pixel<=0):raise ValueError('mm_per_pixel must be finite and positive')
    im=Image.open(image).convert('RGB');mk=Image.open(mask).convert('L')
    if im.size!=mk.size:raise ValueError('image and object mask must have identical dimensions')
    box=mk.getbbox()
    if not box:raise ValueError('empty object mask')
    box=(max(0,box[0]-3),max(0,box[1]-3),min(im.width,box[2]+3),min(im.height,box[3]+3))
    w,h=box[2]-box[0],box[3]-box[1]
    im=ImageOps.pad(im.crop(box),(96,96),method=Image.Resampling.BILINEAR,color=(114,114,114));mk=ImageOps.pad(mk.crop(box),(96,96),method=Image.Resampling.NEAREST,color=0)
    x=np.concatenate([np.array(im,dtype=np.float32)/255,(np.array(mk)>0)[...,None]],2).astype(np.float32)
    cal=torch.tensor([[(mm_per_pixel or .3)/.5,w/100,h/100]],dtype=torch.float32,device=device)
    with torch.inference_mode():o=model(torch.from_numpy(x.transpose(2,0,1))[None].to(device),cal)
    result={'embedding':o['embedding'][0].cpu().tolist(),'appearance_family':int(o['family'].argmax(1))+2,'finish':FINISHES[int(o['finish'].argmax(1))],'reflectance_rgb':o['color'][0,:3].cpu().tolist(),'score_lines':int(o['score'].argmax(1)),'marking_candidate':MARKINGS[int(o['marking'].argmax(1))],'marking_is_general_ocr':False,'dimensions_mm':(o['dimensions'][0].exp()*10).cpu().tolist() if mm_per_pixel else None,'dimensions_note':'Requires calibrated scale; thickness is a learned prior, not a measurement.'}
    return result


def main():
    p=argparse.ArgumentParser();p.add_argument('--checkpoint',default='artifacts/embedding/best.pt');sub=p.add_subparsers(dest='action',required=True);b=sub.add_parser('build');b.add_argument('manifest',type=Path);b.add_argument('--out',type=Path,default=Path('artifacts/calibration.json'));q=sub.add_parser('query');q.add_argument('image');q.add_argument('mask');q.add_argument('--bank',type=Path,required=True);q.add_argument('--mm-per-pixel',type=float);q.add_argument('--out',type=Path,default=Path('artifacts/candidates.json'));a=p.parse_args();model,device=load_encoder(a.checkpoint)
    if a.action=='build':
        samples=json.loads(a.manifest.read_text())['samples'];rows=[]
        for s in samples:
            if not s.get('product_id') or not s.get('label_verified'):raise ValueError('Each reference needs a product ID and explicit label verification')
            f=encode(model,device,a.manifest.parent/s['image'],a.manifest.parent/s['mask'],s.get('mm_per_pixel'));rows.append({'product_id':s['product_id'],'strength':s.get('strength'),'manufacturer':s.get('manufacturer'),'source_image':s['image'],**f})
        bank={'references':rows,'model_checkpoint':str(a.checkpoint),'model_sha256':hashlib.sha256(Path(a.checkpoint).read_bytes()).hexdigest(),'clinical_validation':False,'threshold_calibrated':False,'note':'Candidate retrieval only. Validate on separate products, lots, cameras, and unknowns before choosing an acceptance threshold.'};a.out.write_text(json.dumps(bank,indent=2));print(f'Wrote {len(rows)} reference embeddings to {a.out}')
    else:
        bank=json.loads(a.bank.read_text())
        if bank.get('model_sha256')!=hashlib.sha256(Path(a.checkpoint).read_bytes()).hexdigest():raise ValueError('Reference bank encoder does not match this checkpoint; rebuild the bank')
        if not bank.get('references'):raise ValueError('Reference bank is empty')
        f=encode(model,device,a.image,a.mask,a.mm_per_pixel);e=np.array(f['embedding']);ranks=[]
        for r in bank['references']:ranks.append({'product_id':r['product_id'],'strength':r.get('strength'),'manufacturer':r.get('manufacturer'),'cosine_similarity':float(e@np.array(r['embedding']))})
        ranks.sort(key=lambda r:-r['cosine_similarity']);result={'status':'REVIEW_REQUIRED','identity_verified':False,'candidates':ranks[:5],'attributes':f,'note':'Cosine similarity is not a probability. Milligrams come only from the reference label, not from visual size.'};a.out.write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
if __name__=='__main__':main()
