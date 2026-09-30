// Geometry-scale face recesses: imprints and rare granule pull-outs. Fine grain
// and microscopic pores stay in shading (as in Blender). Uses the same physical
// height field as shading; keeps fixed topology for parametric morphs.
export function sampleRelief(field, rect, size, x, y) {
  const u=(x-rect[0])/rect[2]*size-.5, v=(y-rect[1])/rect[3]*size-.5;
  if(u<-.5 || v<-.5 || u>size-.5 || v>size-.5)return 0;
  const x0=Math.floor(u), y0=Math.floor(v), tx=u-x0,ty=v-y0;
  const at=(i,j)=>field[Math.max(0,Math.min(size-1,j))*size+Math.max(0,Math.min(size-1,i))];
  return (at(x0,y0)*(1-tx)+at(x0+1,y0)*tx)*(1-ty)+(at(x0,y0+1)*(1-tx)+at(x0+1,y0+1)*tx)*ty;
}
export function displaceFaceRelief(built, relief, spec) {
  if(spec.outline==='ring')return {revision:'physical_face_relief_v1',disabled:'ring',affectedVertices:0};
  const {positions:p,dims:d}=built, {rect,size,geometryTop,geometryBottom}=relief;
  let affected=0,maxDepth=0,topCount=0,bottomCount=0;
  // Pre-score height prevents a deep score from disabling imprint displacement.
  // Preserve manufactured normals: shader analytic gradients supply the high-
  // resolution surface normals once, instead of adding them twice.
  const ref=built.referencePositions ?? p;
  for(let i=0;i<p.length;i+=3) {
    const z=ref[i+2], sign=z>=0?1:-1;
    const weight=Math.max(0,Math.min(1,(Math.abs(z)-d.shoulder)/Math.max(d.bevel,1e-6)));
    if(weight===0)continue;
    const field=sign>0?geometryTop:geometryBottom;
    if(!field)continue;
    const h=Math.max(-d.H*.2,Math.min(0,sampleRelief(field,rect,size,p[i],p[i+1])))*weight;
    if(h<-.000001){p[i+2]+=sign*h;affected++;maxDepth=Math.max(maxDepth,-h);if(sign>0)topCount++;else bottomCount++;}
  }
  return {revision:'physical_face_relief_v1',affectedVertices:affected,topVertices:topCount,bottomVertices:bottomCount,maxDepthMm:maxDepth,textureResolution:size,method:'bilinear height-field displacement on fixed face mesh; sub-vertex detail retained in shader'};
}
