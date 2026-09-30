import * as THREE from 'three';
// Records the actual Canvas artwork at its authored resolution. Geometric label
// pixels use nearest texel / >=50% ink coverage; beauty may filter the same atlas.
export class PrintAtlas {
 constructor(canvas,firstId=2000) {
  this.canvas=canvas;this.ctx=canvas.getContext('2d',{willReadFrequently:true});
  this.previous=this.ctx.getImageData(0,0,canvas.width,canvas.height).data;
  this.base=this.previous.slice();this.ids=new Uint16Array(canvas.width*canvas.height);this.records=[];this.next=firstId;
 }
 capture(kind,details={}) {
  const rgba=this.ctx.getImageData(0,0,this.canvas.width,this.canvas.height).data,id=this.next++;
  let changed=0;
  // A changed pixel belongs to the latest draw. Unchanged overlapping ink keeps
  // the earlier ID: it is the same coplanar ink, with no physical depth ordering.
  let maxDelta=0;
  for(let i=0;i<this.ids.length;i++)for(let c=0;c<3;c++)maxDelta=Math.max(maxDelta,Math.abs(rgba[i*4+c]-this.previous[i*4+c]));
  for(let i=0;i<this.ids.length;i++) {
   let delta=0;for(let c=0;c<3;c++)delta=Math.max(delta,Math.abs(rgba[i*4+c]-this.previous[i*4+c]));
   if(maxDelta>0&&delta>=maxDelta*.5){this.ids[i]=id;changed++;}
  }
  this.records.push({instance_id:id,kind,...details,atlas_pixels:changed,target_method:'authored raster ink, 50% coverage, nearest texel'});
  this.previous=rgba;
 }
 finish() {
  const {width,height}=this.canvas,pixels=new Uint8Array(width*height*4);
  for(let i=0;i<this.ids.length;i++){pixels[i*4]=this.ids[i]&255;pixels[i*4+1]=this.ids[i]>>8;pixels[i*4+3]=255;}
  const texture=new THREE.DataTexture(pixels,width,height,THREE.RGBAFormat);texture.flipY=true;texture.needsUpdate=true;
  texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.colorSpace=THREE.NoColorSpace;
  return {texture,records:this.records,width,height};
 }
}
