"""Small U-Net trained from random initialization; no real-image pretraining."""
import torch
from torch import nn
import torch.nn.functional as F

class Block(nn.Sequential):
    def __init__(self,ci,co):
        super().__init__(nn.Conv2d(ci,co,3,padding=1,bias=False),nn.GroupNorm(4,co),nn.SiLU(),nn.Conv2d(co,co,3,padding=1,bias=False),nn.GroupNorm(4,co),nn.SiLU())

class TinyUNet(nn.Module):
    def __init__(self,classes=16,base=16):
        super().__init__();self.enc1=Block(3,base);self.enc2=Block(base,base*2);self.enc3=Block(base*2,base*4);self.mid=Block(base*4,base*8)
        self.dec3=Block(base*12,base*4);self.dec2=Block(base*6,base*2);self.dec1=Block(base*3,base);self.out=nn.Conv2d(base,classes,1)
    def forward(self,x):
        e1=self.enc1(x);e2=self.enc2(F.max_pool2d(e1,2));e3=self.enc3(F.max_pool2d(e2,2));m=self.mid(F.max_pool2d(e3,2))
        d3=self.dec3(torch.cat([F.interpolate(m,size=e3.shape[-2:],mode='bilinear',align_corners=False),e3],1))
        d2=self.dec2(torch.cat([F.interpolate(d3,size=e2.shape[-2:],mode='bilinear',align_corners=False),e2],1))
        d1=self.dec1(torch.cat([F.interpolate(d2,size=e1.shape[-2:],mode='bilinear',align_corners=False),e1],1))
        return self.out(d1)


def segmentation_loss(logits,target,weights):
    ce=F.cross_entropy(logits,target,weight=weights)
    prob=logits.softmax(1);pill=prob[:,2:14].sum(1);truth=((target>=2)&(target<=13)).float()
    dice=1-(2*(pill*truth).sum((1,2))+1)/(pill.sum((1,2))+truth.sum((1,2))+1)
    return ce+.7*dice.mean()
