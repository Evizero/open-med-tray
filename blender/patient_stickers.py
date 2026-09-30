"""Fictional paper identification labels, never real patient data or functional codes.
Opaque labels stay in the ground-truth view when transparent covers are excluded.
"""
import math
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector,Matrix
import printed_graphics as P


def paper_material(G,rng):
    col=rng.choice([(.88,.87,.79),(.94,.93,.88),(.77,.84,.84),(.89,.87,.71)])
    mat=G.material('matte cellulose label paper',col,rng.uniform(.78,.94),noise=.15)
    nodes=mat.node_tree.nodes;links=mat.node_tree.links;p=nodes.get('Principled BSDF')
    tc=nodes.new('ShaderNodeTexCoord');tex=nodes.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=6800;tex.inputs['Detail'].default_value=2;links.new(tc.outputs['Object'],tex.inputs['Vector'])
    bump=nodes.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.000004;bump.inputs['Strength'].default_value=.2;links.new(tex.outputs['Fac'],bump.inputs['Height']);links.new(bump.outputs[0],p.inputs['Normal'])
    return mat

def cover_z(x,y,p,cover):
    z=p['height']+.00080;u=(x-cover.get('displacement_mm',0)/1000)/(p['width']-.0015)+.5;v=y/((p['depth']-.0015)/2);envelope=max(0,1-v*v)
    bow=cover.get('bow_mm',0)/1000;ripple=cover.get('ripple_amplitude_mm',0)/1000;phase=cover.get('phase_rad',0);cross=cover.get('cross_phase_rad',0);mode=cover.get('profile','nearly_flat')
    broad=bow*(.82+.18*math.cos((u-.5)*math.pi));wave=ripple*(.68*math.sin(cover.get('ripple_cycles',1)*math.tau*u+phase)+.32*math.sin(1.7*math.tau*u+1.4*v+cross))
    fine=(.00009 if cover['kind']=='flexible_film' else .000025)*math.sin(u*math.tau*7.3+v*2+phase) if mode in ['rippled','bowed_rippled'] else 0
    return z+envelope*max(0,broad+wave+fine)+cover.get('thickness_mm',0)*.0005

def add(G,rng,p,cover,config):
    if rng.random()>config.get('sticker_probability',.55):return []
    records=[];tray_parameters=dict(p)
    for index in range(config.get('sticker_count',2 if rng.random()<.18 else 1)):
        p=dict(tray_parameters);label_frame=None;label_panel=None
        on_cover=cover['kind']!='none' and not cover.get('no_label_on_peel',False) and (rng.random()<.78 or p['brand_panel'] is None)
        if config.get('sticker_force_cover') and cover['kind']!='none':on_cover=True
        panels=cover.get('label_surfaces',[])
        if on_cover and panels:
            label_panel=rng.choice(panels);label_frame=Matrix(label_panel['matrix_world']);p.update(width=label_panel['width_m'],depth=label_panel['depth_m'],height=0)
        style=rng.choice(['thermal_barcode','blue_stripe','handwritten','compact_id','qr_like','date_circle'])
        w=rng.uniform(.028,.065);h=rng.uniform(.009,.026);angle=rng.gauss(0,.10)
        if config.get('sticker_large'):w=rng.uniform(.055,.085);h=rng.uniform(.018,.032);style=rng.choice(['thermal_barcode','blue_stripe','handwritten','compact_id','qr_like'])
        if label_frame is not None:w=min(w,p['width']*.80);h=min(h,p['depth']*.55)
        if rng.random()<.18:angle=rng.uniform(-.40,.40)
        if on_cover:
            shift=cover.get('displacement_mm',0)/1000
            cx=rng.uniform(-p['width']*.31,p['width']*.31)+shift
            cy=rng.choice([-1,1])*rng.uniform(p['depth']*.08,p['depth']*.28)
            if rng.random()<.15:cy=rng.uniform(-p['depth']*.12,p['depth']*.12)
            if config.get('sticker_central'):cy=rng.uniform(-p['depth']*.12,p['depth']*.12)
            marginx=(abs(math.cos(angle))*w+abs(math.sin(angle))*h)/2
            marginy=(abs(math.sin(angle))*w+abs(math.cos(angle))*h)/2
            cx=max(shift-p['width']/2+marginx+.001,min(shift+p['width']/2-marginx-.001,cx));cy=max(-p['depth']/2+marginy+.001,min(p['depth']/2-marginy-.001,cy))
        elif p['brand_panel']:
            cx,cy,pw,ph=p['brand_panel']
            if ph>pw*1.6:angle=math.pi/2+rng.uniform(-.035,.035);w=min(w,ph*.87);h=min(h,pw*.78)
            else:w=min(w,pw*.85);h=min(h,ph*.78);angle=rng.uniform(-.035,.035)
        else:
            cx,cy=0,-p['depth']/2+p['rim']*.48;w=min(w,p['width']*.65);h=p['rim']*.7;angle=0;style='compact_id'
        if style=='date_circle':w=h=min(w,h)
        curl=rng.choice([0,0,0,rng.uniform(.00008,.00065)]);wrinkle=rng.uniform(.000005,.000035);phase=rng.uniform(0,6)
        co,si=math.cos(angle),math.sin(angle)
        def surface(x,y,ink=False):
            xx=cx+co*x-si*y;yy=cy+si*x+co*y
            u=x/(w/2);v=y/(h/2)
            lift=curl*max(0,(u+v-1.2)/.8)**2+wrinkle*math.sin(x*900+y*640+phase)**2
            base=label_panel['surface_z_local_m'] if label_frame is not None else cover_z(xx,yy,p,cover) if on_cover else p['height']+.000015
            result=Vector((xx,yy,base+.000065+index*.00009+lift+(.000012 if ink else 0)))
            return tuple(label_frame@result) if label_frame is not None else tuple(result)
        paper=paper_material(G,rng);ink=G.material('fictional label ink',rng.choice([(.02,.022,.028),(.02,.045,.13),(.10,.055,.055)]),.8,noise=0)
        accent=G.material('label colour strip',rng.choice([(.035,.18,.48),(.025,.34,.15),(.40,.10,.18)]),.7,noise=0)
        before=set(bpy.data.objects);nx,ny=64,28;vv=[];ff=[];radius=min(.0009,h*.15)
        for j in range(ny+1):
            y=(j/ny-.5)*h
            if style=='date_circle':half=w*.5*math.sqrt(max(0,1-(y/(h*.5))**2))
            else:
                inset=max(0,abs(y)-(h/2-radius));half=w/2-radius+math.sqrt(max(0,radius*radius-inset*inset))
            for i in range(nx+1):x=(i/nx*2-1)*half;vv.append(surface(x,y))
        for j in range(ny):
            for i in range(nx):a=j*(nx+1)+i;ff.append((a,a+1,a+nx+2,a+nx+1))
        o=P.mark(G.mesh_obj('fictional paper identity sticker',vv,ff,paper,1,smooth=True),'sticker_paper',fictional=True)
        mod=o.modifiers.new('70 micron paper','SOLIDIFY');mod.thickness=.000065;mod.offset=-1
        label_id=f'DEMO-{rng.randrange(100000,999999)}';patient='TESTPATIENT '+chr(65+rng.randrange(26));room=f'STATION {rng.randrange(1,8)} / ZIMMER {rng.randrange(1,35):02d}'
        body=[patient,label_id,room]
        selected='caveat' if style=='handwritten' else rng.choice(['barlowcondensed','manrope','nunito','josefinsans'])
        paths=sorted((Path(__file__).parent/'fonts/branding_static'/selected).glob('*.ttf'))
        fp=next((v for v in paths if 'w600' in v.name and 'Italic' not in v.name),next((v for v in paths if 'Regular' in v.name),paths[0]));font=bpy.data.fonts.load(str(fp),check_existing=True)
        flat_before=set(bpy.data.objects)
        textwidth=w*(.62 if style in ['thermal_barcode','qr_like'] else .84)
        if style=='date_circle':body=[f'{rng.randrange(1,29):02d}.{rng.randrange(1,13):02d}.','DEMO'];textwidth=w*.65
        if h<.004:body=[label_id]
        for j,line in enumerate(body):
            xx=-w*.06 if style not in ['thermal_barcode','qr_like'] else -w*.12;yy=h*.25-j*h*.25
            t=G.text_obj(line,(xx,yy,0),h*(.22 if j==0 else .17),ink,1);t.data.font=font;t.data.extrude=0
            P.mark(t,'sticker_ink',text=line,fictional=True,font=fp.name);bpy.context.view_layer.update()
            if t.dimensions.x>textwidth:t.scale*=textwidth/t.dimensions.x
        if style=='blue_stripe':P.polygon(G,'label stripe',[(-w*.48,-h*.46),(-w*.40,-h*.46),(-w*.40,h*.46),(-w*.48,h*.46)],accent,'sticker_ink')
        if style=='thermal_barcode':
            xx=w*.23;unit=w*.0025
            while xx<w*.46:
                bw=unit*rng.choice([1,1,2,3]);P.polygon(G,'inert barcode bar',[(xx,-h*.34),(xx+bw,-h*.34),(xx+bw,h*.34),(xx,h*.34)],ink,'sticker_code');xx+=bw+unit*rng.choice([1,2])
        if style=='qr_like':
            side=min(h*.7,w*.23);unit=side/21;x0=w*.23;y0=-side/2
            for j in range(21):
                for i in range(21):
                    finder=None
                    for a,b in [(0,0),(14,0),(0,14)]:
                        if a<=i<a+7 and b<=j<b+7:
                            ii,jj=i-a,j-b;finder=(ii in [0,6] or jj in [0,6] or (2<=ii<=4 and 2<=jj<=4))
                    black=finder if finder is not None else rng.random()<.46
                    if black:
                        xx,yy=x0+i*unit,y0+j*unit;P.polygon(G,'nonfunctional matrix cell',[(xx,yy),(xx+unit,yy),(xx+unit,yy+unit),(xx,yy+unit)],ink,'sticker_code')
        if config.get('revision',45)>=46 and rng.random()<.3 and h>.005:
            for j,col in enumerate([(.05,.4,.62),(.74,.55,.06),(.1,.5,.23)]):
                dot=G.material('printed medication label dot',col,.6,noise=0)
                P.disk(G,(-w*.22+j*w*.11,-h*.39),min(.001,h*.055),dot,kind='sticker_ink')
        if config.get('revision',45)>=46 and rng.random()<.22:
            P.stroke(G,'printed label border',[(-w*.46,-h*.43),(w*.46,-h*.43),(w*.46,h*.43),(-w*.46,h*.43)],min(.0004,h*.025),accent,kind='sticker_ink',closed=True)
        # Convert flat ink/text to real meshes, then conform every vertex to the lid and paper lift.
        for obj in list(set(bpy.data.objects)-flat_before):
            dg=bpy.context.evaluated_depsgraph_get();mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(dg));new=bpy.data.objects.new(obj.name+' on paper',mesh);bpy.context.collection.objects.link(new)
            new.data.materials.clear()
            for material in obj.data.materials:new.data.materials.append(material)
            for key in obj.keys():new[key]=obj[key]
            new.pass_index=1
            # Sparse font triangulation otherwise cuts through a bowed/wrinkled paper face.
            for v in mesh.vertices:v.co=obj.matrix_world@v.co
            bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.triangulate(bm,faces=list(bm.faces))
            for _ in range(6):
                edges=[e for e in bm.edges if e.calc_length()>.00045]
                if not edges:break
                bmesh.ops.subdivide_edges(bm,edges=edges,cuts=1,use_grid_fill=True)
            bm.to_mesh(mesh);bm.free()
            for v in mesh.vertices:v.co=surface(v.co.x,v.co.y,True)
            bpy.data.objects.remove(obj,do_unlink=True)
        for obj in set(bpy.data.objects)-before:obj['graphic_sticker_index']=index
        records.append({'fictional':True,'patient_display':patient,'id':label_id,'text':body,'style':style,'font':fp.name,'on_cover':on_cover,'surface_transform':[list(r) for r in label_frame] if label_frame is not None else None,'position_m':list(surface(0,0)),'size_mm':[w*1000,h*1000],'rotation_deg':math.degrees(angle),'curl_mm':curl*1000,'wrinkle_mm':wrinkle*1000,'thickness_mm':.065,'codes_functional':False,'label_contract':'opaque paper retained in geometric label view; covered pills are not labelled through it'})
    return records
