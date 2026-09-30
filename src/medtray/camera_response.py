"""Seeded non-geometric camera-response priors; labels retain their pixel coordinates."""
import io
import numpy as np
from PIL import Image,ImageFilter


def apply_camera_response(rgb,seed,profile=None,strength=1):
    rng=np.random.default_rng(seed+660193);profile=profile or rng.choice(['machine_vision','phone_clean','phone_processed','low_light'],p=[.48,.25,.20,.07])
    h,w=rgb.shape[:2];yy,xx=np.mgrid[:h,:w];rr=((xx-w/2)/(w*.7))**2+((yy-h/2)/(h*.9))**2
    gain=rng.uniform(.92,1.08) if profile=='machine_vision' else rng.uniform(.82,1.16)
    wb=np.exp(rng.normal(0,.018 if profile=='machine_vision' else .04,3));gamma=rng.uniform(.96,1.04) if profile=='machine_vision' else rng.uniform(.9,1.1)
    vignette=rng.uniform(0,.04 if profile=='machine_vision' else .15)*strength
    noise=rng.uniform(.001,.006) if profile=='machine_vision' else rng.uniform(.003,.012) if profile!='low_light' else rng.uniform(.012,.025)
    blur=rng.uniform(0,.25) if profile=='machine_vision' else rng.uniform(.12,.60)
    arr=(rgb.astype(np.float32)/255)**gamma;arr*=gain*wb*(1-vignette*rr)[...,None]
    # Signal-dependent shot-noise approximation plus independent read noise.
    arr+=rng.normal(0,1,arr.shape)*noise*np.sqrt(np.clip(arr,0,1)+.06)*strength
    im=Image.fromarray(np.uint8(np.clip(arr,0,1)*255+.5))
    if blur>.05:im=im.filter(ImageFilter.GaussianBlur(blur*strength))
    sharpen=profile=='phone_processed'
    if sharpen:im=im.filter(ImageFilter.UnsharpMask(radius=.75,percent=int(rng.integers(35,80)),threshold=2))
    jpeg=int(rng.integers(82,97)) if profile!='machine_vision' else 100
    if jpeg<100:
        b=io.BytesIO();im.save(b,format='JPEG',quality=jpeg,subsampling=0);b.seek(0);im=Image.open(b).convert('RGB')
    return np.array(im),{'profile':str(profile),'exposure_gain':gain,'white_balance':wb.tolist(),'gamma':gamma,'vignette':vignette,'noise_std':noise,'blur_sigma_pixels':blur,'sharpen':sharpen,'jpeg_quality':jpeg,'seed':seed+660193,'calibrated':False,'geometry':'No warp, crop or radial distortion; target coordinates unchanged','scope':'Mild camera/ISP appearance priors, not a measured phone model'}
