"""MedTray v4.8: compact direct whole-instance masks with one-to-one supervision.

Four controlled variants share the v4.7 residual depthwise encoder, data and augmentation:
  unet_orig    the exact v4.7 network, losses and center/offset grouping (reference)
  bifpn_orig   BiFPN pixel decoder + the v4.7 heads, losses and grouping
  unet_query   v4.7 U-Net pixel decoder + direct instance-mask query head
  bifpn_query  BiFPN pixel decoder + the same query head
The query head is FastInst-inspired: instance-activation-guided queries from a stride-4 map,
two masked-attention decoder layers, one objectness score and one whole-instance mask per query.
Masks are a dynamic 1x1 product with full-resolution mask features plus a learned elliptical
location prior. Training uses Hungarian one-to-one matching (scipy on CPU), mask BCE + Dice and a
no-object penalty. Inference paints masks by score; there is no NMS or merge heuristic.
Not an implementation of FastInst or EfficientDet, and no benchmark claim. Random initialization.
"""
import argparse,datetime,io,json,os,queue,threading,time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL','2')
import numpy as np
from PIL import Image,ImageFilter
from scipy.optimize import linear_sum_assignment
import tensorflow as tf
from . import tf_panoptic_v47 as v47
from . import instance_eval_v48 as ev

L=tf.keras.layers
VARIANTS=('unet_orig','bifpn_orig','unet_query','bifpn_query')
QUERIES=80          # 1.7x the largest augmented training scene (44 eligible + <=3 pasted)
MIN_TRAIN_PIXELS=12 # visible pixels at 640x320; eligibility (10px at 512x256) is ~15.6px here
MASK_DIM=32;DIM=64;UNIT=32.  # prior coordinates are in units of 32 input pixels
NO_OBJECT_WEIGHT=.1  # only for --objectness bce (rejected in the pilot: duplicates kept high scores)
OBJECTNESS='focal'
PRIOR_SCALE=1.  # 1 = elliptical location prior; 0 = plain dynamic 1x1 masks (--mask-prior none)
PRIOR_MAX_LOG=4.  # upper clip of log precision; 4 => sigma >= 0.59 input px. --prior-min-sigma sets log(UNIT/sigma)


def configure(manifest):
    """Apply run-specific mask formulation before building/using a saved query run."""
    global PRIOR_SCALE,PRIOR_MAX_LOG
    PRIOR_SCALE=0. if manifest.get('mask_prior')=='none' else 1.
    PRIOR_MAX_LOG=float(np.log(UNIT/manifest['prior_min_sigma_px'])) if manifest.get('prior_min_sigma_px') else 4.


class CapacityError(ValueError):
    pass


# ---------------------------------------------------------------- networks
def conv(x,c,k=3,stride=1,name='conv'):
    x=L.Conv2D(c,k,strides=stride,padding='same',use_bias=False,name=name)(x)
    x=L.BatchNormalization(momentum=.9,name=name+'_bn')(x)
    return L.Activation('swish',name=name+'_act')(x)


def residual(x,c,name):
    z=L.DepthwiseConv2D(5,padding='same',use_bias=False,name=name+'_spatial')(x)
    z=L.BatchNormalization(momentum=.9,name=name+'_bn')(z)
    z=L.Conv2D(c*2,1,activation='swish',name=name+'_expand')(z)
    z=L.Conv2D(c,1,name=name+'_project')(z)
    return L.Add(name=name+'_residual')([x,z])


class Up2(L.Layer):
    """2x bilinear upsampling identical to UpSampling2D(interpolation='bilinear') / tf.image.resize
    (half-pixel centers, edge clamp). Channels are folded into the batch and upsampled by a fixed
    [.25,.75,.75,.25] transposed convolution; dividing by the same transform of ones restores the
    edge clamp exactly. ResizeBilinearGrad has no Metal kernel here (v4.7's backward ran it on CPU),
    and slice/concat formulations aborted MPSGraph compilation in the SplitV gradient."""
    def build(self,shape):
        k=np.array([.25,.75,.75,.25],np.float32);self.k=tf.constant(np.outer(k,k)[:,:,None,None])
    def call(self,x):
        b,h,w=tf.shape(x)[0],tf.shape(x)[1],tf.shape(x)[2];c=x.shape[-1]
        z=tf.reshape(tf.transpose(x,(0,3,1,2)),(b*c,h,w,1))
        up=lambda t,n:tf.nn.conv2d_transpose(t,self.k,tf.stack([n,2*h,2*w,1]),2,'SAME')
        z=up(z,b*c)/up(tf.ones((1,h,w,1)),1)
        return tf.transpose(tf.reshape(z,(b,c,2*h,2*w)),(0,2,3,1))


class FastFusion(L.Layer):
    """EfficientDet fast normalized fusion: sum relu(w_i) x_i / (sum relu(w_i) + eps)."""
    def __init__(self,n,**kw):
        super().__init__(**kw);self.n=n
    def build(self,shapes):
        self.w=self.add_weight(name='w',shape=(self.n,),initializer='ones')
    def call(self,xs):
        w=tf.nn.relu(self.w);w=w/(tf.reduce_sum(w)+1e-4)
        return tf.add_n([w[i]*x for i,x in enumerate(xs)])


def bifpn(feats,width=64,repeats=2):
    """Weighted bidirectional fusion over strides 4/8/16 (EfficientDet-style, 3 levels)."""
    def lateral(x,name):
        x=L.Conv2D(width,1,use_bias=False,name=name)(x);return L.BatchNormalization(momentum=.9,name=name+'_bn')(x)
    def node(xs,name):
        x=FastFusion(len(xs),name=name+'_fuse')(xs);x=L.Activation('swish',name=name+'_act')(x)
        x=L.DepthwiseConv2D(3,padding='same',use_bias=False,name=name+'_dw')(x)
        x=L.Conv2D(width,1,use_bias=False,name=name+'_pw')(x)
        return L.BatchNormalization(momentum=.9,name=name+'_bn')(x)
    up=lambda x,n:Up2(name=n)(x)
    down=lambda x,n:L.MaxPooling2D(3,2,padding='same',name=n)(x)
    p4,p8,p16=[lateral(f,f'bifpn_lateral_s{s}') for f,s in zip(feats,[4,8,16])]
    for r in range(repeats):
        n=f'bifpn_{r}'
        p8td=node([p8,up(p16,n+'_up16')],n+'_p8_td')
        p4o=node([p4,up(p8td,n+'_up8')],n+'_p4_out')
        p8o=node([p8,p8td,down(p4o,n+'_down4')],n+'_p8_out')
        p16o=node([p16,down(p8o,n+'_down8')],n+'_p16_out')
        p4,p8,p16=p4o,p8o,p16o
    return p4,p8,p16


def pixel_features(inp,backbone):
    """v4.7 encoder; then either the v4.7 U-Net decoder or BiFPN + the same stride-2/1 detail path."""
    s0=conv(inp,16,name='detail_stem');stages=[s0];x=s0
    for i,c in enumerate([32,64,96,160],1):
        x=conv(x,c,stride=2,name=f'encoder_{i}_down')
        for j in range(2 if i>1 else 1):x=residual(x,c,f'encoder_{i}_block_{j}')
        stages.append(x)
    if backbone=='unet':
        feats={}
        for i,c in [(3,96),(2,64),(1,40),(0,24)]:
            x=Up2(name=f'decoder_{i}_up')(x)
            x=L.Concatenate(name=f'decoder_{i}_fuse')([x,stages[i]])
            x=conv(x,c,name=f'decoder_{i}_mix');x=residual(x,c,f'decoder_{i}_block');feats[i]=x
        return dict(f8=feats[3],f4=feats[2],fine=feats[1],s1=feats[0])
    f4,f8,_=bifpn(stages[2:5])
    x=f4
    for i,c in [(1,40),(0,24)]:
        x=Up2(name=f'decoder_{i}_up')(x)
        x=L.Concatenate(name=f'decoder_{i}_fuse')([x,stages[i]])
        x=conv(x,c,name=f'decoder_{i}_mix');x=residual(x,c,f'decoder_{i}_block')
        if i==1:fine=x
    return dict(f8=f8,f4=f4,fine=fine,s1=x)


def build_orig(backbone):
    # unet_orig is the v4.7 graph and layer names with the GPU-friendly (numerically equal) upsampler.
    inp=L.Input((None,None,3),name='image');f=pixel_features(inp,backbone)
    mask=conv(f['s1'],24,name='mask_features')
    inst=residual(conv(f['fine'],48,name='instance_features'),48,'instance_refine')
    family=conv(f['fine'],40,name='appearance_features')
    out={'foreground':L.Conv2D(1,1,name='foreground')(mask),'boundary':L.Conv2D(1,1,name='boundary')(mask),
         'centers':L.Conv2D(1,1,bias_initializer=tf.keras.initializers.Constant(-2.19),name='centers')(inst),
         'offsets':L.Conv2D(2,1,name='offsets')(inst),'family':L.Conv2D(12,1,name='family')(family),'stuff':L.Conv2D(4,1,name='stuff')(mask)}
    return tf.keras.Model(inp,out,name='MedTray_V47_Decoupled_ResidualUNet' if backbone=='unet' else f'MedTray_V48_{backbone}_orig')


def build_pixel_query(backbone):
    inp=L.Input((None,None,3),name='image');f=pixel_features(inp,backbone)
    mask=conv(f['s1'],24,name='mask_features');family=conv(f['fine'],40,name='appearance_features')
    emb=L.Conv2D(MASK_DIM,1,name='instance_embedding')(conv(f['s1'],32,name='instance_mask_features'))
    out={'foreground':L.Conv2D(1,1,name='foreground')(mask),'boundary':L.Conv2D(1,1,name='boundary')(mask),
         'family':L.Conv2D(12,1,name='family')(family),'stuff':L.Conv2D(4,1,name='stuff')(mask),
         'mask_features':emb,'f4':f['f4'],'f8':f['f8']}
    return tf.keras.Model(inp,out,name=f'MedTray_V48_{backbone}_pixels')


def sine(xy,n=8):
    """Fixed sinusoidal code for normalized (x,y); returns 4n channels."""
    a=xy[...,None]*tf.constant(np.pi*2.**np.arange(n),tf.float32)
    s=tf.concat([tf.sin(a),tf.cos(a)],-1)
    return tf.reshape(s,tf.concat([tf.shape(xy)[:-1],[4*n]],0))


def attend(q,k,v,heads,bias=None):
    """Multi-head attention with matmul only (Einsum has no Metal kernel in this stack)."""
    b=tf.shape(q)[0];nq=tf.shape(q)[1];nk=tf.shape(k)[1];d=q.shape[-1]//heads
    split=lambda t,n:tf.transpose(tf.reshape(t,(b,n,heads,d)),(0,2,1,3))
    a=tf.matmul(split(q,nq),split(k,nk),transpose_b=True)/np.sqrt(d)
    if bias is not None:a=a+bias[:,None]
    o=tf.matmul(tf.nn.softmax(a,-1),split(v,nk))
    return tf.reshape(tf.transpose(o,(0,2,1,3)),(b,nq,heads*d))


def softplus(x):
    return tf.nn.relu(x)+tf.math.log1p(tf.exp(-tf.abs(x)))  # Softplus kernel is CPU-only here


def mask_logits(feat,emb,prior,loc,stride):
    """Whole-instance mask logits (B,Q,h,w) on a feature grid of the given input stride.
    Dynamic 1x1 product plus an elliptical location prior -0.5|L^T (p-c)|^2 whose center c and
    Cholesky factor L are predicted per query. Average-pooled features give pooled logits."""
    b=tf.shape(feat)[0];h=tf.shape(feat)[1];w=tf.shape(feat)[2];c=feat.shape[-1]
    lin=tf.matmul(emb[...,:-1],tf.reshape(feat,(b,h*w,c)),transpose_b=True)+emb[...,-1:]
    lin=tf.reshape(lin,(b,-1,h,w))
    ctr=loc/UNIT+prior[...,:2];lp=tf.clip_by_value(prior[...,2:4],-3.,PRIOR_MAX_LOG)
    xs=(tf.cast(tf.range(w),tf.float32)+.5)*stride/UNIT;ys=(tf.cast(tf.range(h),tf.float32)+.5)*stride/UNIT
    rx=xs[None,None,None,:]-ctr[...,0,None,None];ry=ys[None,None,:,None]-ctr[...,1,None,None]
    l11=tf.exp(lp[...,0])[...,None,None];l22=tf.exp(lp[...,1])[...,None,None];l21=prior[...,4,None,None]
    return lin-PRIOR_SCALE*.5*((l11*rx+l21*ry)**2+(l22*ry)**2)


class DecoderBlock(L.Layer):
    """Masked cross-attention -> query self-attention -> FFN, post-norm (Mask2Former order)."""
    def __init__(self,dim,heads,**kw):
        super().__init__(**kw);self.heads=heads
        self.cq,self.ck,self.cv,self.co=[L.Dense(dim,name=f'cross_{n}') for n in 'qkvo']
        self.sq,self.sk,self.sv,self.so=[L.Dense(dim,name=f'self_{n}') for n in 'qkvo']
        self.f1=L.Dense(2*dim,activation='swish',name='ffn_1');self.f2=L.Dense(dim,name='ffn_2')
        self.n1,self.n2,self.n3=[L.LayerNormalization(name=f'norm_{i}') for i in range(3)]
    def call(self,q,qpos,mem,mpos,bias):
        q=self.n1(q+self.co(attend(self.cq(q+qpos),self.ck(mem+mpos),self.cv(mem),self.heads,bias)))
        z=q+qpos;q=self.n2(q+self.so(attend(self.sq(z),self.sk(z),self.sv(q),self.heads)))
        return self.n3(q+self.f2(self.f1(q)))


class QueryDecoder(L.Layer):
    def __init__(self,queries=QUERIES,dim=DIM,heads=4,layers=2,**kw):
        super().__init__(**kw);self.queries=queries
        self.ia_conv=L.Conv2D(dim,3,padding='same',activation='swish',name='activation_conv')
        self.ia_out=L.Conv2D(1,1,bias_initializer=tf.keras.initializers.Constant(-4.6),name='activation_logit')
        self.q_in=L.Dense(dim,name='query_in');self.q_norm=L.LayerNormalization(name='query_norm')
        self.m_in=L.Dense(dim,name='memory_in');self.qpos=L.Dense(dim,name='query_pos');self.mpos=L.Dense(dim,name='memory_pos')
        self.blocks=[DecoderBlock(dim,heads,name=f'block_{i}') for i in range(layers)]
        self.h_norm=L.LayerNormalization(name='head_norm')
        self.obj=L.Dense(1,bias_initializer=tf.keras.initializers.Constant(-2.2),name='objectness')
        self.e1=L.Dense(dim,activation='swish',name='mask_mlp_1');self.e2=L.Dense(dim,activation='swish',name='mask_mlp_2')
        self.e3=L.Dense(MASK_DIM+1,name='mask_mlp_3')
        self.prior=L.Dense(5,kernel_initializer='zeros',name='location_prior')
    def head(self,q):
        h=self.h_norm(q);return self.obj(h)[...,0],self.e3(self.e2(self.e1(h))),self.prior(h)
    def call(self,f4,f8,feat):
        b=tf.shape(f4)[0];h4=tf.shape(f4)[1];w4=tf.shape(f4)[2]
        ia=self.ia_out(self.ia_conv(f4))[...,0]
        # Instance-activation-guided proposals: 3x3 local maxima, top-Q. Duplicates are resolved by
        # the decoder and one-to-one loss, not by suppressing final masks.
        peak=tf.equal(ia,tf.nn.max_pool2d(ia[...,None],3,1,'SAME')[...,0])
        _,idx=tf.math.top_k(tf.stop_gradient(tf.reshape(tf.where(peak,ia,-1e9),(b,-1))),self.queries)
        q=self.q_norm(self.q_in(tf.gather(tf.reshape(f4,(b,-1,f4.shape[-1])),idx,batch_dims=1)))
        loc=tf.cast(tf.stack([idx%w4*4+2,idx//w4*4+2],-1),tf.float32)
        size=tf.cast(tf.stack([w4*4,h4*4]),tf.float32);qpos=self.qpos(sine(loc/size))
        h8=tf.shape(f8)[1];w8=tf.shape(f8)[2]
        gy,gx=tf.meshgrid((tf.cast(tf.range(h8),tf.float32)+.5)/tf.cast(h8,tf.float32),(tf.cast(tf.range(w8),tf.float32)+.5)/tf.cast(w8,tf.float32),indexing='ij')
        mpos=self.mpos(sine(tf.reshape(tf.stack([gx,gy],-1),(1,-1,2))));mem=self.m_in(tf.reshape(f8,(b,-1,f8.shape[-1])))
        feat8=tf.nn.avg_pool2d(feat,8,8,'VALID')
        obj,emb,prior=self.head(q);out={'activation':ia,'query_loc':loc,'obj_0':obj,'emb_0':emb,'prior_0':prior}
        for i,blk in enumerate(self.blocks,1):
            m=tf.cast(tf.stop_gradient(tf.reshape(mask_logits(feat8,emb,prior,loc,8),(b,self.queries,-1)))<0,tf.float32)
            bias=-1e4*m*(1-tf.reduce_min(m,-1,keepdims=True))  # fully masked query attends everywhere
            q=blk(q,qpos,mem,mpos,bias);obj,emb,prior=self.head(q)
            out.update({f'obj_{i}':obj,f'emb_{i}':emb,f'prior_{i}':prior})
        return out


class QueryModel(tf.keras.Model):
    def __init__(self,backbone,queries=QUERIES,**kw):
        super().__init__(name=f'MedTray_V48_{backbone}_query',**kw)
        self.pixels=build_pixel_query(backbone);self.decoder=QueryDecoder(queries,name='query_decoder');self.layers_out=len(self.decoder.blocks)+1
    def call(self,x,training=False):
        o=dict(self.pixels(x,training=training));o.update(self.decoder(o.pop('f4'),o.pop('f8'),o['mask_features']))
        return o


def build(variant,queries=QUERIES):
    assert variant in VARIANTS,variant
    backbone,form=variant.split('_')
    model=build_orig(backbone) if form=='orig' else QueryModel(backbone,queries)
    model(tf.zeros((1,320,640,3)),training=False)
    return model


# ---------------------------------------------------------------- data
CAPSULE_AUG=None  # dict(palette=..., p_recolor, p_touch) when --capsule-aug is enabled (training only)


def capsule_palette(items):
    """Rendered (sRGB) median colors of uncovered single-color training capsules."""
    pal=[]
    for it in items:
        if it['meta'].get('transparent_film'):continue
        for ob in it['meta']['objects']:
            if ob['family']!='hard_capsule' or np.max(np.abs(np.array(ob['color'])-np.array(ob['secondary_color'])))>.02:continue
            m=(it['ids']==ob['instance_id'])&(it['sem']==6)
            if m.sum()>=60:pal.append(np.median(it['rgb'][m],0))
    return np.array(pal,np.float32)


def _lin(c):return (np.asarray(c,np.float32)/255)**2.2
def _srgb(c):return np.clip(c,0,1)**(1/2.2)*255


def recolor_capsules(x,y,inst,meta,palette,rng,max_caps=2,p_each=.7):
    """Synthetic two-tone capsules: split an uncovered single-color capsule across its principal
    axis at a random seam (35-65% of length) and swap one side's diffuse color for a rendered capsule
    color, keeping per-pixel shading (luminance ratio) and the specular/chroma residual in linear RGB.
    One instance ID and the capsule class are kept: a color boundary is not an instance boundary."""
    if meta.get('transparent_film') or not len(palette):return 0
    single={o['instance_id'] for o in meta['objects'] if o['family']=='hard_capsule' and not o.get('stacked') and (o.get('glare_pixel_fraction') or 0)<=.1
            and np.max(np.abs(np.array(o['color'])-np.array(o['secondary_color'])))<=.02}
    ids=[i for i in np.unique(inst[y==6]) if i in single];rng.shuffle(ids);done=0
    for iid in ids[:max_caps]:
        if rng.random()>p_each:continue
        m=(inst==iid)&(y==6);yy,xx=np.where(m)
        if len(xx)<80:continue
        pts=np.stack([xx,yy],1).astype(np.float32);c=pts.mean(0);u,sv,vt=np.linalg.svd(pts-c,full_matrices=False)
        n=len(xx);fill=n/(np.pi*(2*sv[0]/np.sqrt(n))*(2*sv[1]/np.sqrt(n)))
        if not 1.4*sv[1]<=sv[0]<=3.8*sv[1] or fill<.8:continue  # whole capsules only: no end-on views or occluded slivers
        proj=(pts-c)@vt[0];seam=np.quantile(proj,rng.uniform(.35,.65));side=proj>seam if rng.random()<.5 else proj<=seam
        if side.sum()<15 or (~side).sum()<15:continue
        px=_lin(x[yy[side],xx[side]]);src=np.median(px,0);dst=_lin(palette[int(rng.integers(len(palette)))])
        if np.abs(_srgb(dst)-_srgb(src)).max()<40:continue  # need a visible second color
        lum=lambda v:v@np.array([.2126,.7152,.0722],np.float32)
        k=(lum(px)/max(float(lum(src)),1e-4))[:,None];new=dst*k+(px-src*k)
        x[yy[side],xx[side]]=_srgb(new).astype(np.uint8);done+=1
    return done


def paste_touching(x,y,inst,bank,rng,size,max_pairs=2):
    """Hard negatives for two-tone capsules: slide a training donor pill toward an existing pill until
    first contact (1 px), without occluding any pill; the donor gets a new, separate instance ID."""
    from scipy.ndimage import binary_dilation
    h,w=y.shape;fg=(y>=2)&(y<14);ids,counts=np.unique(np.where(fg,inst,0),return_counts=True);cand=ids[(ids>0)&(counts>=30)];done=0
    for _ in range(int(rng.integers(1,max_pairs+1))):
        if not len(cand):break
        target=int(rng.choice(cand));tm=inst==target;ty,tx=np.where(tm);cy,cx=ty.mean(),tx.mean()
        donor,mask,cls=bank[int(rng.integers(len(bank)))];k=int(rng.integers(4));donor=np.rot90(donor,k);mask=np.rot90(mask,k)
        ds=rng.uniform(.75,1.35)*size/768;dw=max(3,round(mask.shape[1]*ds));dh=max(3,round(mask.shape[0]*ds))
        if dw>=w//3 or dh>=h//3:continue
        mask=np.array(Image.fromarray(mask.astype(np.uint8)).resize((dw,dh),Image.Resampling.NEAREST))>0
        donor=np.array(Image.fromarray(np.ascontiguousarray(donor)).resize((dw,dh),Image.Resampling.BILINEAR))
        near=binary_dilation(tm,np.ones((3,3),bool));ang=rng.uniform(0,2*np.pi);d=np.array([np.cos(ang),np.sin(ang)])
        for t in np.arange(max(dw,dh)+max(np.ptp(tx),np.ptp(ty)),0,-1.):
            a=int(round(cx+d[0]*t-dw/2));b=int(round(cy+d[1]*t-dh/2))
            if a<0 or b<0 or a+dw>w or b+dh>h:continue
            if (fg[b:b+dh,a:a+dw]&mask).any():break  # would occlude a pill: give up this direction
            if (near[b:b+dh,a:a+dw]&mask).any():
                if np.mean(y[b:b+dh,a:a+dw][mask]==1)>.6:
                    x[b:b+dh,a:a+dw][mask]=donor[mask];y[b:b+dh,a:a+dw][mask]=cls;inst[b:b+dh,a:a+dw][mask]=int(inst.max())+1;fg=(y>=2)&(y<14);done+=1
                break
    return done


def augment(it,size,seed=None,strength=0.,bank=None):
    """v4.7 `prepare` augmentation with identical RNG consumption; returns image, semantic, instances.
    Target construction is separate so the query formulation does not compute centers/offsets."""
    rng=np.random.default_rng(seed);h,w=size//2,size
    rgb=Image.fromarray(it['rgb']);sem=Image.fromarray(it['sem'].astype(np.int32));ids=Image.fromarray(it['ids'].astype(np.int32))
    iw,ih=rgb.size
    if strength>0 and rng.random()<.85:
        angle=np.deg2rad(rng.uniform(-35,35)*strength + (rng.choice([0,90,180,270]) if rng.random()<.25 else 0))
        zoom=np.exp(rng.uniform(np.log(.8),np.log(1+1.3*strength)))
        scale=(iw/w)/zoom;ca,sa=np.cos(angle),np.sin(angle)
        tx=rng.uniform(-.14,.14)*iw*strength;ty=rng.uniform(-.14,.14)*ih*strength
        matrix=(scale*ca,scale*sa,iw/2+tx-scale*ca*w/2-scale*sa*h/2,-scale*sa,scale*ca,ih/2+ty+scale*sa*w/2-scale*ca*h/2)
        rgb=rgb.transform((w,h),Image.Transform.AFFINE,matrix,resample=Image.Resampling.BILINEAR,fillcolor=(114,114,114))
        sem=sem.transform((w,h),Image.Transform.AFFINE,matrix,resample=Image.Resampling.NEAREST,fillcolor=0)
        ids=ids.transform((w,h),Image.Transform.AFFINE,matrix,resample=Image.Resampling.NEAREST,fillcolor=0)
    else:
        rgb=rgb.resize((w,h),Image.Resampling.BILINEAR);sem=sem.resize((w,h),Image.Resampling.NEAREST);ids=ids.resize((w,h),Image.Resampling.NEAREST)
    x=np.array(rgb);y=np.array(sem);inst=np.array(ids)
    if strength>0:
        if rng.random()<.5:x=x[:,::-1].copy();y=y[:,::-1].copy();inst=inst[:,::-1].copy()
        if rng.random()<.5:x=x[::-1].copy();y=y[::-1].copy();inst=inst[::-1].copy()
        if bank and rng.random()<.25*strength:
            for _ in range(int(rng.integers(1,4))):
                donor,mask,cls=bank[int(rng.integers(len(bank)))];dh,dw=mask.shape
                ds=rng.uniform(.75,1.35)*size/768;dw=max(3,round(dw*ds));dh=max(3,round(dh*ds))
                if dw>=w or dh>=h:continue
                mask=np.array(Image.fromarray(mask.astype(np.uint8)).resize((dw,dh),Image.Resampling.NEAREST))>0
                donor=np.array(Image.fromarray(donor).resize((dw,dh),Image.Resampling.BILINEAR))
                for attempt in range(10):
                    a=int(rng.integers(0,w-dw));b=int(rng.integers(0,h-dh));region=y[b:b+dh,a:a+dw]
                    if np.mean(region[mask]==1)>.75:break
                else:continue
                patch=x[b:b+dh,a:a+dw];patch[mask]=donor[mask];region[mask]=cls
                inst[b:b+dh,a:a+dw][mask]=int(inst.max())+1
        if CAPSULE_AUG and bank and seed is not None:
            # Separate RNG stream: the v4.7-equivalent augmentation above is unchanged.
            crng=np.random.default_rng([seed,48])
            if crng.random()<CAPSULE_AUG['p_recolor']:recolor_capsules(x,y,inst,it['meta'],CAPSULE_AUG['palette'],crng)
            if crng.random()<CAPSULE_AUG['p_touch']:paste_touching(x,y,inst,bank,crng,size)
        rgb=Image.fromarray(x)
        if rng.random()<.18*strength:rgb=rgb.filter(ImageFilter.GaussianBlur(rng.uniform(.15,.85)*strength))
        if rng.random()<.15*strength:
            k=rng.uniform(.65,.95);rgb=rgb.resize((round(w*k),round(h*k)),Image.Resampling.BILINEAR).resize((w,h),Image.Resampling.BILINEAR)
        if rng.random()<.22*strength:
            z=io.BytesIO();rgb.save(z,format='JPEG',quality=int(rng.uniform(45,95)));z.seek(0);rgb=Image.open(z).convert('RGB')
        x=np.asarray(rgb,dtype=np.float32)/255
        exposure=np.exp(rng.uniform(-.4,.4)*strength);wb=np.exp(rng.uniform(-.12,.12,3)*strength)
        gamma=np.exp(rng.uniform(-.25,.25)*strength)
        x=np.clip(x**gamma*exposure*wb,0,1)
        sat=1+rng.uniform(-.35,.35)*strength;gray=x.mean(-1,keepdims=True);x=np.clip(gray+(x-gray)*sat,0,1)
        if rng.random()<.3*strength:x=np.clip(x+rng.normal(0,rng.uniform(.003,.02)*strength,x.shape),0,1)
        x=x*2-1
    else:x=x.astype(np.float32)/127.5-1
    return x.astype(np.float32),y,inst


def query_targets(inst,sem,capacity=QUERIES,min_pixels=MIN_TRAIN_PIXELS):
    """Dense auxiliary targets as v4.7 plus a per-pixel instance index (-1 = no target instance).
    Pills with fewer than `min_pixels` visible pixels stay foreground but are not instance targets."""
    h,w=sem.shape;fg=(sem>=2)&(sem<14)
    ids,counts=np.unique(np.where(fg,inst,0),return_counts=True)
    keep=ids[(ids>0)&(counts>=min_pixels)]
    if len(keep)>capacity:raise CapacityError(f'{len(keep)} instance targets exceed query capacity {capacity}; refusing to drop any')
    idx=np.full((h,w),-1,np.int32)
    if len(keep):
        pos=np.searchsorted(keep,inst);hit=fg&(pos<len(keep));hit&=keep[np.minimum(pos,len(keep)-1)]==inst;idx[hit]=pos[hit]
    lowsem=np.array(Image.fromarray(sem.astype(np.uint8)).resize((w//2,h//2),Image.Resampling.NEAREST))
    boundary=np.zeros((h,w),np.float32)
    for dy,dx in [(1,0),(-1,0),(0,1),(0,-1)]:
        boundary=np.maximum(boundary,((inst!=np.roll(inst,(dy,dx),(0,1)))&fg).astype(np.float32))
    stuff=np.zeros((h,w),np.int32);stuff[sem==1]=1;stuff[sem==14]=2;stuff[sem==15]=3
    return dict(foreground=fg.astype(np.float32)[...,None],boundary=boundary[...,None],family=np.maximum(lowsem.astype(np.int32)-2,0).clip(0,11),
        family_valid=((lowsem>=2)&(lowsem<14)).astype(np.float32),stuff=stuff,instance_index=idx,count=len(keep))


def example(it,size,seed,strength,bank,form,capacity):
    x,y,inst=augment(it,size,seed,strength,bank)
    return x,(v47.targets(inst,y) if form=='orig' else query_targets(inst,y,capacity))


def collate(examples,form):
    x=np.stack([e[0] for e in examples])
    if form=='orig':return x,{k:np.stack([e[1][k] for e in examples]) for k in examples[0][1]}
    t={k:np.stack([e[1][k] for e in examples]) for k in ['foreground','boundary','family','family_valid','stuff','instance_index']}
    g=max(1,max(e[1]['count'] for e in examples));t['target_valid']=np.array([[j<e[1]['count'] for j in range(g)] for e in examples],np.float32)
    return x,t


class Prefetch:
    """Background producer so CPU augmentation overlaps GPU steps; RNG draws stay sequential."""
    def __init__(self,items,order,size,bs,rng,strength,bank,form,capacity,executor,depth=3):
        self.q=queue.Queue(depth);seeds=[int(rng.integers(2**32)) for _ in order]
        def run():
            try:
                for at in range(0,len(order),bs):
                    ix=order[at:at+bs];args=[(items[i],size,s,strength,bank,form,capacity) for i,s in zip(ix,seeds[at:at+bs])]
                    self.q.put(collate(list(executor.map(lambda a:example(*a),args)),form))
                self.q.put(None)
            except BaseException as e:self.q.put(e)
        threading.Thread(target=run,daemon=True).start()
    def __iter__(self):
        while True:
            v=self.q.get()
            if v is None:return
            if isinstance(v,BaseException):raise v
            yield v


# ---------------------------------------------------------------- losses
def hungarian(cost,valid):
    """One-to-one assignment per image. Returns (B,G) query index, -1 for padded target slots."""
    b,nq,g=cost.shape;out=np.full((b,g),-1,np.int32)
    for i in range(b):
        cols=np.flatnonzero(valid[i])
        if not len(cols):continue
        if len(cols)>nq:raise CapacityError(f'{len(cols)} targets exceed {nq} queries')
        c=cost[i][:,cols]
        if not np.isfinite(c).all():raise FloatingPointError('non-finite matching cost')
        r,k=linear_sum_assignment(c);out[i,cols[k]]=r
    return out


def focal(logits,target,alpha=.25,gamma=2.):
    p=tf.sigmoid(logits);pt=p*target+(1-p)*(1-target)
    return tf.nn.sigmoid_cross_entropy_with_logits(labels=target,logits=logits)*(1-pt)**gamma*(alpha*target+(1-alpha)*(1-target))


def match(obj,x4,t4,valid,objectness='focal'):
    """Stride-4 area-fraction mask cost (5 BCE + 5 Dice) plus a class term: focal (4x, DINO/Mask DINO
    style) or -2*probability (Mask2Former style, used with the rejected BCE objectness)."""
    p4=tf.sigmoid(x4);n=tf.cast(tf.shape(x4)[-1],tf.float32)
    bce=tf.reduce_mean(softplus(x4),-1)[...,None]-tf.matmul(x4,t4)/n
    dice=1-(2*tf.matmul(p4,t4)+1)/(tf.reduce_sum(p4,-1)[...,None]+tf.reduce_sum(t4,1)[:,None,:]+1)
    if objectness=='focal':
        p=tf.sigmoid(obj);cls=4*(.25*(1-p)**2*-tf.math.log(p+1e-8)-.75*p**2*-tf.math.log(1-p+1e-8))
    else:cls=-2*tf.sigmoid(obj)
    cost=tf.stop_gradient(cls[...,None]+5*bce+5*dice)
    a=tf.numpy_function(hungarian,[cost,valid>0],tf.int32,stateful=False);a.set_shape(valid.shape)
    return a


def pair_mask_losses(x,t,ok):
    bce=tf.reduce_mean(tf.nn.sigmoid_cross_entropy_with_logits(labels=t,logits=x),[2,3])
    p=tf.sigmoid(x);dice=1-(2*tf.reduce_sum(p*t,[2,3])+1)/(tf.reduce_sum(p,[2,3])+tf.reduce_sum(t,[2,3])+1)
    n=tf.maximum(tf.reduce_sum(ok),1.)
    return tf.reduce_sum(bce*ok)/n,tf.reduce_sum(dice*ok)/n


def dense_losses(out,t,family_weights):
    fg=t['foreground'];p=tf.sigmoid(out['foreground'])
    bce=v47.balanced_bce(out['foreground'],fg);dice=1-(2*tf.reduce_sum(p*fg)+1)/(tf.reduce_sum(p)+tf.reduce_sum(fg)+1)
    boundary=v47.balanced_bce(out['boundary'],t['boundary'])
    fc=tf.nn.sparse_softmax_cross_entropy_with_logits(labels=t['family'],logits=out['family'])
    fw=tf.gather(family_weights,t['family'])*t['family_valid'];family=tf.reduce_sum(fc*fw)/tf.maximum(tf.reduce_sum(fw),1.)
    sc=tf.nn.sparse_softmax_cross_entropy_with_logits(labels=t['stuff'],logits=out['stuff']);stuff=tf.reduce_sum(sc*(1-fg[...,0]))/tf.maximum(tf.reduce_sum(1-fg),1.)
    return bce+dice+.15*boundary+.25*family+.1*stuff,[bce,dice,boundary,family,stuff]


QUERY_PARTS=['instance_total','objectness_bce','mask_bce','mask_dice','activation_focal','dense_total','foreground_bce','foreground_dice','boundary_bce','family_ce','stuff_ce',
             'final_objectness_bce','final_mask_bce','final_mask_dice','proposal_recall','predicted_per_gt','matched_mean_iou_s4']
ORIG_PARTS=['balanced_foreground_bce','foreground_dice','boundary_bce','center_focal','offset_huber','family_ce','stuff_ce']


def query_losses(out,t,family_weights,layers,objectness=None):
    objectness=objectness or OBJECTNESS
    feat=out['mask_features'];b=tf.shape(feat)[0];H=tf.shape(feat)[1];W=tf.shape(feat)[2]
    idx=t['instance_index'];valid=t['target_valid'];g=tf.shape(valid)[1];nq=tf.shape(out['obj_0'])[1];loc=out['query_loc']
    onehot=tf.one_hot(idx,g)  # -1 -> all zeros
    frac2=tf.nn.avg_pool2d(onehot,2,2,'VALID');frac4=tf.nn.avg_pool2d(onehot,4,4,'VALID')
    t4=tf.reshape(frac4,(b,-1,g));feat2=tf.nn.avg_pool2d(feat,2,2,'VALID');feat4=tf.nn.avg_pool2d(feat,4,4,'VALID')
    inst=[];finals=None
    for l in range(layers):
        obj,emb,prior=out[f'obj_{l}'],out[f'emb_{l}'],out[f'prior_{l}']
        x4=tf.reshape(mask_logits(feat4,emb,prior,loc,4),(b,nq,-1));a=match(obj,x4,t4,valid,objectness)
        ok=tf.cast(a>=0,tf.float32)*valid;a=tf.maximum(a,0)
        matched=tf.reduce_max(tf.one_hot(a,nq)*ok[...,None],1)
        if objectness=='focal':  # sigmoid focal over all queries, normalized by matched targets (>=1)
            objl=tf.reduce_sum(focal(obj,matched))/tf.maximum(tf.reduce_sum(ok),1.)
        else:
            w=matched+NO_OBJECT_WEIGHT*(1-matched)
            objl=tf.reduce_sum(w*tf.nn.sigmoid_cross_entropy_with_logits(labels=matched,logits=obj))/tf.reduce_sum(w)
        e=tf.gather(emb,a,batch_dims=1);pr=tf.gather(prior,a,batch_dims=1);lc=tf.gather(loc,a,batch_dims=1)
        if l==layers-1:
            # Final layer: full input resolution against exact transformed instance masks.
            target=tf.cast(tf.equal(idx[:,None],tf.range(g)[None,:,None,None]),tf.float32);xm=mask_logits(feat,e,pr,lc,1)
        else:
            target=tf.transpose(frac2,(0,3,1,2));xm=mask_logits(feat2,e,pr,lc,2)
        mb,md=pair_mask_losses(xm,target,ok);inst.append([objl,mb,md])
        if l==layers-1:
            p4=tf.sigmoid(tf.gather(x4,a,batch_dims=1));tt=tf.transpose(t4,(0,2,1))
            iou=tf.reduce_sum(p4*tt,-1)/tf.maximum(tf.reduce_sum(p4+tt-p4*tt,-1),1e-6)
            finals=[objl,mb,md,tf.reduce_sum(iou*ok)/tf.maximum(tf.reduce_sum(ok),1.)]
    inst=tf.reduce_mean(tf.stack(inst),0);instance=tf.reduce_sum(tf.constant([4. if objectness=='focal' else 2.,5.,5.])*inst)  # logged parts unweighted
    # Instance-activation map: per target, the highest-scoring stride-4 cell inside its mask is the
    # single positive (FastInst-style dynamic assignment); everything else is negative. Focal loss.
    ia=tf.reshape(out['activation'],(b,-1));pia=tf.sigmoid(ia)
    inside=(t4>=.5)|((t4>=tf.reduce_max(t4,1,keepdims=True))&(t4>0))
    score=tf.stop_gradient(tf.where(inside,pia[...,None],-1.))
    _,best=tf.math.top_k(tf.transpose(score,(0,2,1)),1)
    pos=tf.reduce_max(tf.one_hot(best[...,0],tf.shape(ia)[1])*valid[...,None],1)
    ce=tf.nn.sigmoid_cross_entropy_with_logits(labels=pos,logits=ia);pt=pia*pos+(1-pia)*(1-pos)
    ia_focal=tf.reduce_sum(ce*(1-pt)**2*(.25*pos+.75*(1-pos)))/tf.maximum(tf.reduce_sum(pos),1.)
    dense,dparts=dense_losses(out,t,family_weights)
    # Diagnostics only (no gradient): proposal recall and final predicted-object ratio.
    li=tf.cast(loc,tf.int32);flat=tf.reshape(idx,(b,-1));hit=tf.gather(flat,li[...,1]*W+li[...,0],batch_dims=1)
    rec=tf.reduce_sum(tf.reduce_max(tf.one_hot(hit,g),1)*valid)/tf.maximum(tf.reduce_sum(valid),1.)
    ratio=tf.reduce_sum(tf.cast(tf.sigmoid(out[f'obj_{layers-1}'])>.5,tf.float32))/tf.maximum(tf.reduce_sum(valid),1.)
    total=instance+ia_focal+dense
    return total,tf.stack([instance,inst[0],inst[1],inst[2],ia_focal,dense,*dparts,*finals[:3],rec,ratio,finals[3]])


# ---------------------------------------------------------------- inference
def paint(out,obj_thresholds,layer):
    """GPU painting per objectness threshold: each pixel takes the kept query maximizing
    score*mask probability. Returns winner indices and their mask probabilities (B,T,H,W)."""
    feat=out['mask_features'];score=tf.sigmoid(out[f'obj_{layer}'])
    prob=tf.sigmoid(mask_logits(feat,out[f'emb_{layer}'],out[f'prior_{layer}'],out['query_loc'],1))
    prob=tf.transpose(prob,(0,2,3,1));wins=[];probs=[]
    for th in obj_thresholds:
        keep=tf.cast(score>=th,tf.float32)[:,None,None,:]
        v,i=tf.math.top_k(prob*score[:,None,None,:]*keep,1);i=i[...,0]
        wins.append(tf.where(v[...,0]>0,i,-1));probs.append(tf.where(v[...,0]>0,tf.gather(prob,i[...,None],batch_dims=3)[...,0],0.))
    return tf.stack(wins,1),tf.stack(probs,1),score


def query_instances(win,prob,score,family,mask_threshold,min_pixels=5):
    """CPU relabelling of a painted map: consecutive IDs, drop <5px leftovers like v4.7, family vote."""
    ids=np.where(prob>=mask_threshold,win+1,0).astype(np.int32);h,w=ids.shape
    fam=np.array(Image.fromarray(family.argmax(-1).astype(np.uint8)).resize((w,h),Image.Resampling.NEAREST))+2
    out=np.zeros_like(ids);obs=[]
    labels,counts=np.unique(ids,return_counts=True)
    for q,c in zip(labels,counts):
        if not q or c<min_pixels:continue
        m=ids==q;iid=len(obs)+1;out[m]=iid;yy,xx=np.where(m)
        obs.append(dict(instance_id=iid,query=int(q-1),class_id=int(np.bincount(fam[m],minlength=16).argmax()),objectness=float(score[q-1]),confidence=float(prob[m].mean()),
                        bbox_xyxy=[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)]))
    return out,obs


def semantic_from(o,ids):
    h,w=ids.shape;fam=np.array(Image.fromarray(o['family'].argmax(-1).astype(np.uint8)).resize((w,h),Image.Resampling.NEAREST))+2
    stuff=np.array([0,1,14,15],np.uint8)[o['stuff'].argmax(-1)]
    return np.where(ids>0,fam,stuff).astype(np.uint8)


def predict_batch(model,variant,x,grid,layer=None):
    """Returns per image a dict {threshold_key: (ids640, objects)} plus raw dense heads.
    grid: orig -> [(center_threshold, mask_threshold)], query -> [(objectness_threshold, mask_threshold)]."""
    out=model(x,training=False);form=variant.split('_')[1];res=[]
    if form=='orig':
        raw={k:v.numpy() for k,v in out.items()}
        for j in range(len(x)):
            o={k:v[j] for k,v in raw.items()};d={}
            for ct,mt in grid:
                sem,ids,obs=v47.decode(o,ct,mt);d[(ct,mt)]=(ids,obs,sem)
            res.append(dict(maps=d,foreground=o['foreground'][...,0]))
        return res
    layer=model.layers_out-1 if layer is None else layer
    obj_th=sorted({g[0] for g in grid});win,prob,score=paint(out,obj_th,layer)
    win,prob,score=win.numpy(),prob.numpy(),score.numpy();fam=out['family'].numpy();stuff=out['stuff'].numpy();fg=out['foreground'].numpy()
    for j in range(len(x)):
        d={}
        for ot,mt in grid:
            k=obj_th.index(ot);ids,obs=query_instances(win[j,k],prob[j,k],score[j],fam[j],mt)
            d[(ot,mt)]=(ids,obs,semantic_from(dict(family=fam[j],stuff=stuff[j]),ids))
        res.append(dict(maps=d,foreground=fg[j,...,0],scores=score[j]))
    return res


# ---------------------------------------------------------------- training
def default_grid(form,final=False):
    if form=='orig':
        return [(c,m) for c in [.15,.25,.35,.45] for m in [.4,.5,.6,.7,.8,.9]] if final else [(.25,.5),(.35,.5),(.25,.9),(.35,.9)]
    return [(o,m) for o in [.2,.3,.4,.5,.6,.7,.8] for m in [.4,.5,.6]] if final else [(.3,.5),(.5,.5),(.7,.5)]


def validate(model,variant,items,size,bs,grid,gt_cache,keep_best=False):
    """Validation-only metrics on the frozen 512x256 grid for every threshold pair in `grid`."""
    rows={g:[] for g in grid};objs={g:[] for g in grid};fgstat=[0,0]
    for at in range(0,len(items),bs):
        sub=items[at:at+bs];x=np.stack([augment(it,size)[0] for it in sub])
        for it,r in zip(sub,predict_batch(model,variant,x,grid)):
            gt=gt_cache(it);p=ev.to_grid((r['foreground']>0).astype(np.uint8))>0
            fg=gt['sem_pill'];fgstat[0]+=int((p&fg).sum());fgstat[1]+=int((p|fg).sum())
            for g in grid:
                ids,obs,_=r['maps'][g];row,ob=ev.scene_eval(it,gt,ev.to_grid(ids),obs);rows[g].append(row);objs[g]+=ob
    table=[]
    for g in grid:
        s=ev.summary(rows[g],objs[g]);table.append(dict(thresholds=list(g),**s))
    best=max(range(len(grid)),key=lambda i:table[i]['instance_f1_iou50'])
    out=dict(grid=table,best=table[best],pill_binary_iou_foreground_head=fgstat[0]/max(fgstat[1],1))
    if keep_best:out['scenes']=rows[grid[best]];out['objects']=objs[grid[best]]
    return out


def write_json(p,d):
    tmp=Path(str(p)+'.tmp');tmp.write_text(json.dumps(d,indent=2,default=float));tmp.replace(p)


def main():
    ap=argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--variant',choices=VARIANTS,required=True);ap.add_argument('--data',type=Path,default=Path('artifacts/dataset-v46-combined'))
    ap.add_argument('--out',type=Path,required=True);ap.add_argument('--size',type=int,default=640);ap.add_argument('--batch-size',type=int,default=16)
    ap.add_argument('--epochs',type=int,default=30);ap.add_argument('--seed',type=int,default=4801);ap.add_argument('--eval-every',type=int,default=3)
    ap.add_argument('--queries',type=int,default=QUERIES);ap.add_argument('--lr',type=float,default=.0015);ap.add_argument('--warmup-steps',type=int,default=44)
    ap.add_argument('--augmentation',choices=['none','strong'],default='strong');ap.add_argument('--overfit',type=int,default=0,help='N training images, no augmentation, evaluated on the same images')
    ap.add_argument('--overfit-repeats',type=int,default=10);ap.add_argument('--workers',type=int,default=6)
    ap.add_argument('--objectness',choices=['focal','bce'],default='focal',help='query objectness loss; bce = weighted BCE with no-object weight .1 (rejected pilot)')
    ap.add_argument('--mask-prior',choices=['ellipse','none'],default='ellipse',help='none: plain dynamic 1x1 masks (prior term multiplied by 0)')
    ap.add_argument('--prior-min-sigma',type=float,default=0.,help='lower bound on prior sigma in input px (0: default clip, ~0.6 px)')
    ap.add_argument('--capsule-aug',action='store_true',help='targeted synthetic two-tone recolor + touching-pair paste (training only, full-strength epochs)')
    a=ap.parse_args();a.out.mkdir(parents=True,exist_ok=True);assert a.size%32==0
    assert tf.config.list_physical_devices('GPU'),'TensorFlow Metal required'
    tf.keras.utils.set_random_seed(a.seed);rng=np.random.default_rng(a.seed);form=a.variant.split('_')[1]
    tr=v47.load_items(a.data,'train');va=v47.load_items(a.data,'val')
    support=np.zeros(12)
    for it in tr:
        for ob in it['meta']['objects']:
            if 2<=ob['class_id']<14:support[ob['class_id']-2]+=1
    fw=np.clip(np.sqrt(support.sum()/(12*np.maximum(support,1))),.4,4).astype(np.float32);fw/=np.sum(fw*support)/support.sum();weights=tf.constant(fw)
    if a.overfit:
        # Include one empty scene so the no-object path is exercised during the overfit diagnostic.
        busy=[it for it in tr if np.isin(it['sem'],np.arange(2,14)).sum()>1000];empty=[it for it in tr if not any(2<=o['class_id']<14 for o in it['meta']['objects'])]
        tr=busy[:a.overfit-1]+empty[:1];va=tr
    bank=v47.make_bank(tr) if a.augmentation=='strong' and not a.overfit else []
    global CAPSULE_AUG,PRIOR_SCALE,PRIOR_MAX_LOG
    PRIOR_SCALE=0. if a.mask_prior=='none' else 1.
    if a.prior_min_sigma:PRIOR_MAX_LOG=float(np.log(UNIT/a.prior_min_sigma))
    if a.capsule_aug:CAPSULE_AUG=dict(palette=capsule_palette(tr),p_recolor=.5,p_touch=.35)
    with tf.device('/GPU:0'):
        model=build(a.variant,a.queries);opt=tf.keras.optimizers.AdamW(a.lr,weight_decay=.00005,global_clipnorm=5)
    layers=getattr(model,'layers_out',0)
    params=int(sum(np.prod(v.shape) for v in model.trainable_variables)+sum(np.prod(v.shape) for v in model.non_trainable_variables))
    gtc=ev.GTCache()
    manifest=dict(variant=a.variant,architecture=model.name,parameters=params,trainable_parameters=int(sum(np.prod(v.shape) for v in model.trainable_variables)),
        tensorflow=tf.__version__,gpu=[str(x) for x in tf.config.list_physical_devices('GPU')],size=a.size,epochs=a.epochs,batch_size=a.batch_size,seed=a.seed,
        learning_rate=dict(peak=a.lr,final=.0001,schedule='linear warmup then cosine per step',warmup_steps=a.warmup_steps),optimizer='AdamW wd 5e-5, global clipnorm 5',
        augmentation=a.augmentation,copy_paste_donors=len(bank),random_initialization=True,family_class_weights=fw.tolist(),training_splits=['train'],
        capsule_augmentation=dict(enabled=True,palette_colors=len(CAPSULE_AUG['palette']),p_recolor=.5,p_touch=.35,scope='only in epochs using the copy-paste bank (full-strength augmentation)',
            method='synthetic seam recolor of uncovered single-color capsules (one ID kept) + touching donor paste (new ID)') if CAPSULE_AUG else dict(enabled=False),
        overfit_diagnostic=bool(a.overfit),evaluation_split='same training images (overfit diagnostic, NOT held out)' if a.overfit else 'val',
        selection='Epoch: max validation instance F1@IoU.5 over a small fixed threshold grid; thresholds: full grid on the selected checkpoint. Validation only.',
        test_status='Not evaluated during training',data=str(a.data))
    if form=='query':
        manifest.update(queries=a.queries,min_train_pixels=MIN_TRAIN_PIXELS,mask_dim=MASK_DIM,decoder_dim=DIM,decoder_layers=layers-1,objectness=a.objectness,mask_prior=a.mask_prior,prior_min_sigma_px=a.prior_min_sigma or None,prior_max_log_precision=PRIOR_MAX_LOG,
            no_object_weight=NO_OBJECT_WEIGHT if a.objectness=='bce' else None,
            loss=('per decoder prediction (3): 4 objectness sigmoid focal (alpha .25, gamma 2, normalized by matched targets)' if a.objectness=='focal' else 'per decoder prediction (3): 2 objectness BCE (no-object weight .1)')
                 +' + 5 mask BCE + 5 mask Dice after Hungarian matching; + activation focal + v4.7 dense aux (fg BCE+Dice, .15 boundary, .25 family, .1 stuff)',
            matching='scipy linear_sum_assignment on CPU via tf.numpy_function; cost '+('4 focal class' if a.objectness=='focal' else '-2 probability')+' + 5 BCE + 5 Dice on stride-4 area-fraction targets')
    write_json(a.out/'manifest.json',manifest);print('START',json.dumps(manifest),flush=True)
    executor=ThreadPoolExecutor(a.workers)
    x,t=collate([example(tr[i],a.size,None,0.,None,form,a.queries) for i in range(min(a.batch_size,len(tr)))],form)
    def loss_fn(o,t):
        return v47.losses(o,t,weights) if form=='orig' else query_losses(o,t,weights,layers,a.objectness)
    with tf.device('/GPU:0'):
        with tf.GradientTape() as tape:o=model(x,training=True);loss,parts=loss_fn(o,{k:tf.constant(v) for k,v in t.items()})
        grads=tape.gradient(loss,model.trainable_variables)
    ver=dict(loss=float(loss),parts=parts.numpy().tolist(),outputs={k:v.device for k,v in o.items()},gradients=len(grads),
             gpu_gradients=sum(g is not None and 'GPU:0' in g.device for g in grads),finite_gradients=sum(g is not None and bool(tf.reduce_all(tf.math.is_finite(g))) for g in grads),
             none_gradients=[v.name for g,v in zip(grads,model.trainable_variables) if g is None])
    assert ver['gpu_gradients']==len(grads)==ver['finite_gradients'],ver
    assert all('GPU:0' in d for d in ver['outputs'].values()),ver
    write_json(a.out/'gpu-verification.json',ver);print('GPU_VERIFIED',json.dumps({k:v for k,v in ver.items() if k!='outputs'}),flush=True)
    spec={'orig':None,'query':{'foreground':tf.TensorSpec((None,None,None,1)),'boundary':tf.TensorSpec((None,None,None,1)),'family':tf.TensorSpec((None,None,None),tf.int32),
          'family_valid':tf.TensorSpec((None,None,None)),'stuff':tf.TensorSpec((None,None,None),tf.int32),'instance_index':tf.TensorSpec((None,None,None),tf.int32),'target_valid':tf.TensorSpec((None,None))}}[form]
    def step(x,t):
        with tf.device('/GPU:0'):
            with tf.GradientTape() as tape:o=model(x,training=True);loss,parts=loss_fn(o,t)
            grads=tape.gradient(loss,model.trainable_variables);opt.apply_gradients(zip(grads,model.trainable_variables))
            finite=tf.reduce_all([tf.reduce_all(tf.math.is_finite(g)) for g in grads])
        return loss,parts,finite
    step=tf.function(step,reduce_retracing=True,input_signature=[tf.TensorSpec((None,None,None,3)),spec]) if spec else tf.function(step,reduce_retracing=True)
    part_names=ORIG_PARTS if form=='orig' else QUERY_PARTS
    steps_per_epoch=-(-len(tr)//a.batch_size)*(a.overfit_repeats if a.overfit else 1);total_steps=steps_per_epoch*a.epochs;gstep=0
    hist=[];best=-1;chosen=0;t0=time.time();small=default_grid(form);max_targets=0
    for epoch in range(1,a.epochs+1):
        before=time.time()
        strength=0 if a.augmentation=='none' or a.overfit else (.45 if epoch<=2 else .25 if epoch>a.epochs*.8 else 1.)
        this_bank=bank if strength>.5 else None;tot=0;n=0;plist=[];wait=0;compute=0;nonfinite=0
        for _ in range(a.overfit_repeats if a.overfit else 1):
            order=rng.permutation(len(tr));tick=time.time()
            for x,t in Prefetch(tr,order,a.size,a.batch_size,rng,strength,this_bank,form,a.queries,executor):
                lr=a.lr*min(1,(gstep+1)/max(a.warmup_steps,1)) if gstep<a.warmup_steps else .0001+(a.lr-.0001)*(1+np.cos(np.pi*(gstep-a.warmup_steps)/max(total_steps-a.warmup_steps,1)))/2
                opt.learning_rate.assign(lr);wait+=time.time()-tick;tick=time.time()
                if form=='query':max_targets=max(max_targets,int(t['target_valid'].sum(1).max()))
                v,parts,finite=step(tf.constant(x),{k:tf.constant(z) for k,z in t.items()});v=float(v);compute+=time.time()-tick
                if not bool(finite) or not np.isfinite(v):nonfinite+=1
                tot+=v*len(x);n+=len(x);plist.append(parts.numpy());gstep+=1;tick=time.time()
        if nonfinite:raise FloatingPointError(f'{nonfinite} non-finite steps in epoch {epoch}')
        row=dict(epoch=epoch,train_loss=tot/n,learning_rate_end=float(lr),augmentation_strength=strength,loss_components=dict(zip(part_names,np.mean(plist,0).tolist())),
                 data_wait_seconds=wait,step_seconds=compute,max_instance_targets_in_batch=max_targets if form=='query' else None)
        if epoch%a.eval_every==0 or epoch==a.epochs or a.overfit:
            e0=time.time();val=validate(model,a.variant,va,a.size,8,small,gtc)
            row.update(validation=val,validation_seconds=time.time()-e0)
            if val['best']['instance_f1_iou50']>best:best=val['best']['instance_f1_iou50'];chosen=epoch;model.save_weights(a.out/'best.weights.h5')
        row['seconds']=time.time()-before;hist.append(row);write_json(a.out/'history.json',hist)
        write_json(a.out/'progress.json',dict(variant=a.variant,epoch=epoch,epochs=a.epochs,best_epoch=chosen,best_small_grid_f1=best,elapsed_seconds=time.time()-t0,updated=datetime.datetime.now().isoformat(timespec='seconds')))
        print('EPOCH',json.dumps({k:v for k,v in row.items() if k!='validation'}),'VAL',json.dumps(row.get('validation',{}).get('best')),flush=True)
    model.save_weights(a.out/'last.weights.h5');executor.shutdown();train_seconds=time.time()-t0
    model.load_weights(a.out/'best.weights.h5');e0=time.time()
    val=validate(model,a.variant,va,a.size,8,default_grid(form,True),gtc,keep_best=True)
    pick=val['best'];result=dict(variant=a.variant,selected_epoch=chosen,training_seconds=train_seconds,thresholds=pick['thresholds'],
        threshold_names=['center_threshold','mask_threshold'] if form=='orig' else ['objectness_threshold','mask_threshold'],
        validation_threshold_search=val['grid'],val=dict(instances=pick,pill_binary_iou_foreground_head=val['pill_binary_iou_foreground_head'],scenes=val['scenes']),
        search_seconds=time.time()-e0,max_instance_targets_seen=max_targets if form=='query' else None,
        scope='Synthetic only. Validation-selected checkpoint and thresholds. Test/stress held until selection is frozen.')
    write_json(a.out/'validation.json',result);write_json(a.out/'val-objects.json',val['objects'])
    print('VALIDATION_DONE',json.dumps({k:result[k] for k in ['variant','selected_epoch','training_seconds','thresholds']}),json.dumps(pick),flush=True)


if __name__=='__main__':main()
