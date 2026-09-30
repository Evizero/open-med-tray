import io
import json
import random
from pathlib import Path
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
import torch
from torch.utils.data import Dataset

class TrayDataset(Dataset):
    def __init__(self,root,split,size=320,augment=False):
        self.files=sorted((Path(root)/split).glob('[0-9]*.json'));self.size=size;self.augment=augment
        if not self.files:raise ValueError(f'No prepared scenes in {root}/{split}')
        self.cache=[]
        for f in self.files:
            rgb=Image.open(f.with_suffix('.png')).convert('RGB').resize((size,size//2),Image.Resampling.BILINEAR)
            sem=Image.open(f.with_name(f.stem+'_semantic.png')).resize((size,size//2),Image.Resampling.NEAREST)
            self.cache.append((np.array(rgb),np.array(sem)))
    def __len__(self):return len(self.files)
    def __getitem__(self,i):
        x,y=self.cache[i];x=Image.fromarray(x);y=y.copy()
        if self.augment:
            k=random.choice([0,2]);x=x.rotate(90*k);y=np.rot90(y,k).copy()
            if random.random()<.5:x=x.transpose(Image.Transpose.FLIP_LEFT_RIGHT);y=np.fliplr(y).copy()
            x=ImageEnhance.Brightness(x).enhance(random.uniform(.7,1.3))
            x=ImageEnhance.Contrast(x).enhance(random.uniform(.75,1.25))
            x=ImageEnhance.Color(x).enhance(random.uniform(.6,1.4))
            if random.random()<.25:x=x.filter(ImageFilter.GaussianBlur(random.uniform(.15,.7)))
            if random.random()<.2:
                b=io.BytesIO();x.save(b,format='JPEG',quality=random.randint(45,95));b.seek(0);x=Image.open(b).copy()
        a=np.array(x,dtype=np.float32)/255
        if self.augment:
            a=a*np.random.uniform(.91,1.09,(1,1,3))
            if random.random()<.35:a=a+np.random.normal(0,random.uniform(.002,.025),a.shape)
        return torch.from_numpy(np.clip(a,0,1).astype(np.float32).transpose(2,0,1).copy()),torch.from_numpy(y.astype(np.int64))
