// Coverage priors for small cameras, not a calibration of a particular device.
import {RNG,clamp} from '../util/rng.js';
export const CAMERA_DEFAULTS={framing:'fit',sensorWidth:6.4,focalLength:3.6,principalX:0,principalY:0};
export function sampleIntrinsics(seed){
 const r=new RNG(seed^0x73194),sensorWidth=r.pick([4.8,6.4,8.8,13.2]);
 const equivalent=r.uniform(14,32);
 return {framing:'fit',sensorWidth,focalLength:sensorWidth*equivalent/36,principalX:r.uniform(-.012,.012),principalY:r.uniform(-.012,.012),intrinsicsSeed:seed};
}
export function intrinsics(c){return {framing:c.framing==='lens'?'lens':'fit',sensorWidth:clamp(c.sensorWidth??6.4,4.8,13.2),focalLength:clamp(c.focalLength??3.6,1.5,12),principalX:clamp(c.principalX??0,-.03,.03),principalY:clamp(c.principalY??0,-.03,.03)};}
