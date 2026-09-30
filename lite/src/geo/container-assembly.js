import * as THREE from 'three';
import { buildTraySkin } from './tray.js';

// Continuous molded skin by default; removable inserts are an explicit mechanism.
// Returns individual mesh parts so metadata never calls a multi-piece carrier one-piece.
export function containerAssembly(p, mat) {
  const group=new THREE.Group(), parts=[];
  function add(params,name,x=0,y=0,z=0) {
    const {geometry}=buildTraySkin(params);
    // Every part uses the same global artwork coordinates, including separate inserts.
    const pos=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
    for(let i=0;i<pos.count;i++)uv.setXY(i,(pos.getX(i)+x)/p.width+.5,(pos.getY(i)+y)/p.depth+.5);
    const mesh=new THREE.Mesh(geometry,mat);mesh.name=name;mesh.position.set(x,y,z);
    mesh.castShadow=true;mesh.receiveShadow=true;
    mesh.userData.label={instance:1,semantic:1,object:name};group.add(mesh);parts.push(mesh);
  }
  if(p.removable) {
    const [x0,y0,x1,y1]=p.region;
    add({...p,round:false,floorZ:.15,skirt:'full',cells:[{x:(x0+x1)/2,y:(y0+y1)/2,w:x1-x0,h:y1-y0,draft:2}]},'insert carrier');
    for(const [i,c] of p.cells.entries()) {
      const w=c.w-.7,h=c.h-.7;
      add({...p,width:w,depth:h,height:p.height-.6,thickness:.5,rim:1.2,floorZ:.15,skirt:0,
        outerRound:p.round,corner:p.round?Math.min(w,h)*.499:p.corner,
        cells:[{x:0,y:0,w:c.w-3,h:c.h-3,draft:c.draft}]},`removable ${p.round?'cup':'insert'} ${i+1}`,c.x,c.y,.8);
    }
  } else add(p,'continuous moulded tray');
  if(p.paperBacking) {
    const paper=new THREE.MeshPhysicalMaterial({color:0xe6e8df,roughness:.74,specularIntensity:.35});
    const strips=[];
    for(const side of [-1,1]) {
      strips.push([0,side*(p.depth/2-p.rim*.5),p.width-.8,p.rim*.9]);
      strips.push([side*(p.width/2-p.rim*.5),0,p.rim*.9,p.depth-.8]);
    }
    for(let i=0;i<p.cols-1;i++) {
      const c=p.cells[i];strips.push([c.x+c.w/2+p.web/2,(p.region[1]+p.region[3])/2,p.web*.82,p.region[3]-p.region[1]]);
    }
    for(const [x,y,w,h] of strips) {
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,.10),paper);mesh.position.set(x,y,p.height-.10);
      mesh.name='blister paper flange';mesh.userData.label={instance:1,semantic:1,object:mesh.name};group.add(mesh);parts.push(mesh);
    }
  }
  return {group,parts,record:{one_piece_skin:!p.removable,parts:parts.map(m=>m.name),paper_backing:!!p.paperBacking}};
}
