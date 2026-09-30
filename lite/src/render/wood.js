// Generated oak albedo, loaded before the workbench boots and embedded offline.
// Microrelief/roughness are appearance approximations, not measured scan maps.
import * as THREE from 'three';
import oakURL from '../assets/oak-imagegen-v3.png';
let image=null,ready=null;
export function prepareWood(){
 if(!ready)ready=new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{image=img;resolve();};img.onerror=()=>reject(new Error('Embedded worktop texture could not load'));img.src=oakURL;});
 return ready;
}
export function oakMaterial(){
 if(!image)throw new Error('Wood texture must be prepared before scene construction');
 const map=new THREE.Texture(image);map.needsUpdate=true;map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.anisotropy=8;
 const m=new THREE.MeshPhysicalMaterial({map,roughnessMap:map,bumpMap:map,bumpScale:.085,roughness:.66,clearcoat:.1,clearcoatRoughness:.48,specularIntensity:.6});
 m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`float roughnessFactor = roughness;
 #ifdef USE_ROUGHNESSMAP
 roughnessFactor *= .75 + .25 * (1.0-texture2D(roughnessMap,vRoughnessMapUv).g);
 #endif`);};
 m.customProgramCacheKey=()=> 'oak_imagegen_v3_finish';
 m.userData.repeat=1/600;m.userData.repeatY=1/600;m.userData.surfaceRevision='oak_imagegen_v3';return m;
}
