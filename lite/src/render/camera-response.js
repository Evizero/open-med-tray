// Non-geometric camera/ISP priors from src/medtray/camera_response.py.
// The distributions match the source; RNG and browser JPEG implementation do not.
import {RNG,clamp} from '../util/rng.js';
export const CAMERA_PROFILES=['machine_vision','phone_clean','phone_processed','low_light'];
export function cameraParameters(seed, profile='auto', strength=1) {
  if(!Number.isFinite(strength)||strength<0||strength>2)throw new Error('Camera response strength must be in [0, 2]');
  const rng=new RNG(seed+660193);
  if(profile==='auto')profile=rng.weighted(CAMERA_PROFILES,[48,25,20,7]);
  if(profile!=='none'&&!CAMERA_PROFILES.includes(profile))throw new Error(`Unknown camera profile: ${profile}`);
  const machine=profile==='machine_vision';
  return {profile,seed:seed+660193,strength,
    exposure_gain:rng.uniform(...(machine?[.92,1.08]:[.82,1.16])),
    white_balance:Array.from({length:3},()=>Math.exp(rng.gauss(0,machine?.018:.04))),
    gamma:rng.uniform(...(machine?[.96,1.04]:[.9,1.1])),
    vignette:rng.uniform(0,machine?.04:.15)*strength,
    noise_std:rng.uniform(...(machine?[.001,.006]:profile==='low_light'?[.012,.025]:[.003,.012])),
    blur_sigma_pixels:rng.uniform(...(machine?[0,.25]:[.12,.60])),
    sharpen:profile==='phone_processed', sharpen_percent:rng.int(35,79),
    jpeg_quality:machine||profile==='none'?100:rng.int(82,96),calibrated:false,
    geometry:'No warp, crop or radial distortion; target coordinates unchanged',
    implementation:'JS sfc32 RNG; separable Gaussian; browser JPEG codec (subsampling may differ from Pillow)',
    scope:'Appearance priors, not a measured device model'};
}
function gaussian(src,w,h,sigma) {
  if(sigma<.01)return src.slice();
  const r=Math.ceil(3*sigma),kernel=[],tmp=new Float32Array(src.length),dst=new Float32Array(src.length);
  let sum=0;for(let k=-r;k<=r;k++){const v=Math.exp(-k*k/(2*sigma*sigma));kernel.push(v);sum+=v;}
  for(let k=0;k<kernel.length;k++)kernel[k]/=sum;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++) {
    let v=0;for(let k=-r;k<=r;k++)v+=src[(y*w+clamp(x+k,0,w-1))*3+c]*kernel[k+r];tmp[(y*w+x)*3+c]=v;
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++) {
    let v=0;for(let k=-r;k<=r;k++)v+=tmp[(clamp(y+k,0,h-1)*w+x)*3+c]*kernel[k+r];dst[(y*w+x)*3+c]=v;
  }
  return dst;
}
export function cameraPixels(rgb,w,h,p) {
  if(rgb.length!==w*h*3)throw new Error('Camera input dimensions mismatch');
  if(p.profile==='none')return rgb.slice();
  const rng=new RNG(p.seed^0x325acd),arr=new Float32Array(rgb.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const rr=((x-w/2)/(w*.7))**2+((y-h/2)/(h*.9))**2;
    for(let c=0;c<3;c++) {
      const i=(y*w+x)*3+c;
      let v=(rgb[i]/255)**p.gamma*p.exposure_gain*p.white_balance[c]*(1-p.vignette*rr);
      v+=rng.gauss()*p.noise_std*Math.sqrt(clamp(v,0,1)+.06)*p.strength;
      arr[i]=Math.round(clamp(v,0,1)*255);
    }
  }
  let result=p.blur_sigma_pixels>.05?gaussian(arr,w,h,p.blur_sigma_pixels*p.strength):arr;
  if(p.sharpen) {
    const blur=gaussian(result,w,h,.75),out=result.slice();
    for(let i=0;i<out.length;i++)if(Math.abs(result[i]-blur[i])>2)out[i]+=p.sharpen_percent/100*(result[i]-blur[i]);
    result=out;
  }
  return Uint8Array.from(result,v=>Math.round(clamp(v,0,255)));
}
export async function applyCameraResponse(rgb,w,h,seed,profile='auto',strength=1) {
  const record=cameraParameters(seed,profile,strength),pixels=cameraPixels(rgb,w,h,record);
  if(record.jpeg_quality===100)return {pixels,record};
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;
  try {
    const ctx=cv.getContext('2d',{willReadFrequently:true});
    if(!ctx)throw new Error('Camera response canvas allocation failed');
    const im=ctx.createImageData(w,h);
    for(let i=0;i<w*h;i++){im.data.set(pixels.subarray(i*3,i*3+3),i*4);im.data[i*4+3]=255;}
    ctx.putImageData(im,0,0);
    const blob=await new Promise((resolve,reject)=>cv.toBlob(b=>b?resolve(b):reject(new Error('JPEG encode failed')),'image/jpeg',record.jpeg_quality/100));
    await drawJPEG(ctx,blob);
    const rgba=ctx.getImageData(0,0,w,h).data;
    for(let i=0;i<w*h;i++)pixels.set(rgba.subarray(i*4,i*4+3),i*3);
    return {pixels,record};
  } finally {
    // Release the 2D backing store before the next scene, including failures.
    cv.width=0;cv.height=0;
  }
}

// Safari versions/devices can lack ImageBitmap or reject a valid JPEG Blob.
// Decode the same bytes through Image rather than omitting the JPEG response.
async function drawJPEG(ctx,blob) {
  let bitmap;
  if(typeof globalThis.createImageBitmap==='function') {
    try {
      bitmap=await globalThis.createImageBitmap(blob);
      ctx.drawImage(bitmap,0,0);
      return;
    } catch {
      // The ordinary image decoder below still validates the encoded bytes.
    } finally { bitmap?.close(); }
  }
  const url=URL.createObjectURL(blob);
  try {
    const image=new Image();
    await new Promise((resolve,reject)=>{
      image.onload=resolve;
      image.onerror=()=>reject(new Error('JPEG image decode failed'));
      image.src=url;
    });
    ctx.drawImage(image,0,0);
  } finally { URL.revokeObjectURL(url); }
}
