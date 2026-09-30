"""Fictional tray printing and geometrically labelled loose tablet material.
Priors inspired by the supplied photograph, not measured prevalence or mass conservation.
"""
import math
import random
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector

BRANDS=[('VITORA','PFLEGE · LOGISTIK','vitora.example'),('MEDORA','ARZNEI · SERVICE','medora.example'),('NOVA CARE','KLINIKVERSORGUNG','nova-care.example'),('ALPINA','MEDIZINTECHNIK','alpina.example'),('LINDE','APOTHEKEN SERVICE','linde.example')]


def branding(G, rng, panel, z, ink):
    cx,cy,w,h=panel;word,descriptor,url=rng.choice(BRANDS)
    font_name=rng.choice(['DejaVuSans','DejaVuSans-Bold','DejaVuSerif'])
    font=bpy.data.fonts.load(str(Path(__file__).parent/'fonts'/f'{font_name}.ttf'),check_existing=True)
    rows=[]
    for body,y,size in [(word,cy+.003,w*.23),(descriptor,cy-.0025,w*.09),(url,cy-.006,w*.07)]:
        o=G.text_obj(body,(cx,y,z+.000002),size,ink,1)
        o.data.font=font;o.data.extrude=0
        bpy.context.view_layer.update()
        factor=min(1,w*.87/max(o.dimensions.x,1e-6));o.scale=(factor,factor,1)
        rows.append({'text':body,'font':font_name,'position_m':list(o.location)})
    # Simple geometric crest; readable as printing, never a medication object.
    yy=cy+.0105;side=min(w*.14,.003)
    a=rng.uniform(-.3,.3)
    v=[(cx+side*math.cos(a+i*math.pi/2),yy+side*math.sin(a+i*math.pi/2),z+.000003) for i in range(4)]
    G.mesh_obj('fictional printed company crest',v,[(0,1,2,3)],ink,1,smooth=False)
    return {'fictional':True,'company_name':word,'lines':rows,'panel_bounds_m':[cx-w/2,cy-h/2,cx+w/2,cy+h/2],'semantic_class_id':1,'instance_id':1,'kind':'printed_ink','logo':'geometric_crest','no_product_identity':True}


def _angular_piece(G,rng,name,diameter,height,mat,iid):
    # Seeded convex chips with asymmetric fractured facets and a stable contact face.
    points=[];n=rng.randint(5,8)
    for z in [0,height]:
        for j in range(n):
            a=j*math.tau/n+rng.uniform(-.12,.12);r=diameter*.5*rng.uniform(.58,1.)
            points.append((math.cos(a)*r,math.sin(a)*r*rng.uniform(.6,1.),z*rng.uniform(.75,1.)))
    bm=bmesh.new();verts=[bm.verts.new(v) for v in points]
    hull=bmesh.ops.convex_hull(bm,input=verts,use_existing_faces=False)
    bmesh.ops.delete(bm,geom=[v for v in bm.verts if not v.link_faces],context='VERTS')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    me=bpy.data.meshes.new(name);bm.to_mesh(me);bm.free();me.update()
    o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);G.assign(o,mat,iid)
    # 8-micron chipped lips catch light without smoothing the overall fracture shape.
    mod=o.modifiers.new('microscopic fractured edge','BEVEL');mod.width=min(.000008,diameter*.025);mod.segments=1
    return o


def scatter(G,rng,objects,slots,lookup,iid,config):
    sources=[o for o in objects if 2<=o['class_id']<=13 and o['family'] not in ['hard_capsule','softgel','ring_tablet']]
    rng.shuffle(sources);records=[];powder_clouds=0
    for source in sources[:4]:
        damaged=source.get('chip',0)>0 or source.get('dose_fraction',1)<1
        chance=config.get('debris_probability',.42) if damaged else config.get('intact_debris_probability',.12)
        if rng.random()>chance:continue
        sp=slots[source.get('support_slot',source['compartment'])];px,py,_=source['position_m']
        col=source['color'];core_col=tuple(.72*float(x)+.28*.83 for x in col)
        core=G.pill_material('loose pressed core',core_col,'chalky_uncoated',seed=rng.randrange(100000),grain_um=85,relief_um=16,pore_density=.055)
        # Broad, irregularly shaped nearby cluster; some particles may be occluded by the pill.
        scatter_angle=rng.uniform(0,math.tau)
        centre=(px+source['length_mm']*.00048*math.cos(scatter_angle),py+source['width_mm']*.00052*math.sin(scatter_angle))
        def position(spread):
            x=centre[0]+rng.gauss(0,spread);y=centre[1]+rng.gauss(0,spread)
            return (max(sp['x_min_m']+.0015,min(sp['x_max_m']-.0015,x)),max(sp['y_min_m']+.0015,min(sp['y_max_m']-.0015,y)))
        # Fine powder: one semantic group, efficient disconnected grains, not whole pill instances.
        grains=rng.randint(12,55) if damaged else rng.randint(4,18);vv=[];ff=[]
        for _ in range(grains):
            x,y=position(.0034);r=rng.triangular(.00002,.00017,.000045);z=sp.get('floor_z_m',.00015)+.000007;k=len(vv)
            vv.extend([(x-r,y-r*.5,z),(x+r*.8,y-r*.4,z),(x+r*.2,y+r,z),(x-r*.12,y,z+r*.8)])
            ff.extend([(k,k+2,k+1),(k,k+1,k+3),(k+1,k+2,k+3),(k+2,k,k+3)])
        G.mesh_obj('scattered powder grains',vv,ff,core,iid,smooth=False);lookup[iid]=14
        records.append({'instance_id':iid,'class_id':14,'family':'fragment','kind':'powder_cloud','grains':grains,'source_instance_id':source['instance_id'],'compartment':source['compartment'],'counts_as_pill':False,'drug_identity':None});iid+=1;powder_clouds+=1
        for j in range(rng.randint(2,6) if damaged else rng.randint(1,3)):
            chunk=damaged and j==0 and rng.random()<config.get('fragment_probability',.4)
            d=rng.uniform(.0010,.0027) if chunk else rng.uniform(.00022,.00080);height=d*rng.uniform(.28,.62)
            o=_angular_piece(G,rng,'loose tablet chip' if chunk else 'loose angular crumb',d,height,core,iid)
            x,y=position(.004);o.location=(x,y,sp.get('floor_z_m',.00015)+.000007);o.rotation_euler.z=rng.uniform(0,math.tau);lookup[iid]=14
            records.append({'instance_id':iid,'class_id':14,'family':'fragment','kind':'loose_chunk' if chunk else 'crumb','nominal_diameter_mm':d*1000,'height_mm':height*1000,'source_instance_id':source['instance_id'],'compartment':source['compartment'],'position_m':list(o.location),'counts_as_pill':False,'drug_identity':None});iid+=1
    objects.extend(records)
    return iid,powder_clouds
