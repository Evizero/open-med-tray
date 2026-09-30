// NumPy v1.0, little-endian float32, C order. Avoids a Python/server dependency.
export function encodeFloat32NPY(data,width,height) {
 if(!(data instanceof Float32Array)||data.length!==width*height)throw new Error('NPY shape mismatch');
 const header=`{'descr': '<f4', 'fortran_order': False, 'shape': (${height}, ${width}), }`;
 const pad=(64-(10+header.length+1)%64)%64;
 const h=new TextEncoder().encode(header+' '.repeat(pad)+'\n'),out=new Uint8Array(10+h.length+data.length*4);
 out.set([147,78,85,77,80,89,1,0,h.length&255,h.length>>8]);out.set(h,10);
 const dv=new DataView(out.buffer);for(let i=0;i<data.length;i++)dv.setFloat32(10+h.length+i*4,data[i],true);
 return out;
}
