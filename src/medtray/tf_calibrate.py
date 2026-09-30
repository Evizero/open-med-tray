"""Small verified-reference banks for the new TensorFlow embedding.
Returns visual candidates, never prescription/administration approval.
"""
import argparse,json
from pathlib import Path
import numpy as np
from PIL import Image,ImageOps
import tensorflow as tf
from .appearance_scale import extent_features


def encode(model,image,mask,mm_per_pixel):
 if not np.isfinite(mm_per_pixel) or mm_per_pixel<=0:raise ValueError('mm_per_pixel must be a finite positive camera calibration')
 im=Image.open(image).convert('RGB');ma=Image.open(mask).convert('L')
 if ma.size!=im.size:raise ValueError('RGB and mask must have identical original dimensions')
 ids=np.array(ma)>127;ys,xs=np.where(ids)
 if len(xs)==0:raise ValueError('Reference mask is empty')
 a=max(0,int(xs.min())-3);b=max(0,int(ys.min())-3);c=min(im.width,int(xs.max())+4);d=min(im.height,int(ys.max())+4)
 rgb=ImageOps.pad(im.crop((a,b,c,d)),(96,96),method=Image.Resampling.BILINEAR,color=(114,114,114));m=ImageOps.pad(ma.crop((a,b,c,d)),(96,96),method=Image.Resampling.NEAREST,color=0)
 x=np.concatenate([np.array(rgb,dtype=np.float32)/127.5-1,np.array(m,dtype=np.float32)[...,None]/255],-1)[None];cal=extent_features(int(xs.max()-xs.min()+1),int(ys.max()-ys.min()+1),mm_per_pixel)[None]
 return model([x,cal],training=False)['embedding'].numpy()[0]


def main():
 p=argparse.ArgumentParser();p.add_argument('--model',type=Path,default=Path('artifacts/tf-embedding-v44/best.keras'));sub=p.add_subparsers(dest='command',required=True)
 b=sub.add_parser('build');b.add_argument('manifest',type=Path);b.add_argument('--out',type=Path,required=True)
 q=sub.add_parser('query');q.add_argument('image',type=Path);q.add_argument('mask',type=Path);q.add_argument('--mm-per-pixel',type=float,required=True);q.add_argument('--bank',type=Path,required=True)
 a=p.parse_args();model=tf.keras.models.load_model(a.model,compile=False)
 import hashlib
 checkpoint_hash=hashlib.sha256(a.model.read_bytes()).hexdigest()
 if a.command=='build':
  records=json.loads(a.manifest.read_text());groups={}
  if not isinstance(records,list) or not records:raise ValueError('Reference manifest must be a nonempty list of verified samples')
  for record in records:
   for field in ['product_id','name','manufacturer','strength','image','mask','mm_per_pixel','verified_reference']:
    if field not in record:raise ValueError(f'Missing {field}')
   if record['verified_reference'] is not True:raise ValueError('Reference metadata must be independently verified before adding a medicine identity')
   for field in ['product_id','name','manufacturer','strength']:
    if not isinstance(record[field],str) or not record[field].strip():raise ValueError(f'{field} must be a nonempty verified string')
   if record['product_id'] in groups and any(groups[record['product_id']][key]!=record[key] for key in ['name','manufacturer','strength']):raise ValueError('Conflicting product metadata under one product_id; use distinct IDs for different strengths or manufacturers')
   vec=encode(model,a.manifest.parent/record['image'],a.manifest.parent/record['mask'],float(record['mm_per_pixel']));g=groups.setdefault(record['product_id'],{'product_id':record['product_id'],'name':record['name'],'manufacturer':record['manufacturer'],'strength':record['strength'],'vectors':[]});g['vectors'].append(vec)
  for g in groups.values():
   v=g.pop('vectors');proto=np.mean(v,0);g['references']=len(v);g['prototype']=(proto/max(np.linalg.norm(proto),1e-9)).tolist()
  result={'model_sha256':checkpoint_hash,'products':list(groups.values()),'identity_threshold_fitted':False,'scope':'Visual reference retrieval; confidence and rejection threshold require separate validation. No clinical approval.'};a.out.write_text(json.dumps(result,indent=2));print('BANK_CREATED',len(groups))
 else:
  bank=json.loads(a.bank.read_text())
  if bank['model_sha256']!=checkpoint_hash:raise ValueError('Reference bank was built with a different embedding checkpoint')
  vec=encode(model,a.image,a.mask,a.mm_per_pixel);candidates=[{k:v for k,v in row.items() if k!='prototype'}|{'cosine_similarity':float(vec@np.array(row['prototype']))} for row in bank['products']];candidates.sort(key=lambda row:-row['cosine_similarity'])
  print(json.dumps({'status':'review_required','identity_verified':False,'similarity_is_probability':False,'candidates':candidates[:8]},indent=2))
if __name__=='__main__':main()
