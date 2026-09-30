"""Coherent daily, hinged, weekly and cup geometries; versioned procedural priors."""
import math
import bpy
import numpy as np
from mathutils import Matrix,Vector
import container_geometry as legacy
import printed_graphics as P
import cover_wear
import wear_v46

STYLES=legacy.STYLES+['rigid_organizer','weekly_2x7','twin_compact','round_cups']
WEIGHTS=[25,12,10,8,8,4,13,10,7,3]
DAYS={'de':['MO','DI','MI','DO','FR','SA','SO'],'en':['MON','TUE','WED','THU','FRI','SAT','SUN'],'fr':['LUN','MAR','MER','JEU','VEN','SAM','DIM'],'it':['LUN','MAR','MER','GIO','VEN','SAB','DOM']}


def parameters(rng,c):
    style=c.get('preview_tray_style') or rng.choices(STYLES,c.get('tray_style_weights',WEIGHTS))[0]
    old=style in legacy.STYLES
    p=legacy.parameters(rng,dict(c,preview_tray_style=style if old else 'moulded_daily'))
    p['style']=style;p['revision']='mechanisms_v46';p['rows']=2 if style in ['weekly_2x7','four_pods'] else 1
    if style=='rigid_organizer':p.update(width=rng.uniform(.18,.23),depth=rng.uniform(.060,.078),height=rng.uniform(.014,.023),compartments=rng.choice([5,6,7]),rim=rng.uniform(.0035,.0055),web=rng.uniform(.0014,.0024),thickness=rng.uniform(.0009,.0016),draft=.0015)
    elif style=='weekly_2x7':p.update(width=rng.uniform(.17,.205),depth=rng.uniform(.080,.10),height=rng.uniform(.012,.019),compartments=14,rim=rng.uniform(.004,.006),web=rng.uniform(.002,.0032),thickness=rng.uniform(.0008,.0014),draft=.0014)
    elif style=='twin_compact':p.update(width=rng.uniform(.095,.135),depth=rng.uniform(.046,.062),height=rng.uniform(.012,.018),compartments=2,rim=rng.uniform(.0035,.0055),web=rng.uniform(.002,.0032),thickness=rng.uniform(.0009,.0015))
    elif style=='round_cups':p.update(width=rng.uniform(.16,.20),depth=rng.uniform(.043,.053),height=rng.uniform(.013,.021),compartments=4,rim=.004,web=.002,thickness=.0006)
    if c.get('preview_compartments') and style not in ['weekly_2x7','four_pods']:p['compartments']=int(c['preview_compartments'])
    # New manufactured mechanisms put brand on a narrow flange, leaving plausible cell sizes.
    if not old:
        w,d,r=p['width'],p['depth'],p['rim'];place=c.get('preview_brand_placement') or rng.choice(['top','bottom'])
        if place in ['left','right'] and style in ['weekly_2x7','twin_compact','round_cups']:place='bottom'
        panel=w*rng.uniform(.12,.17) if place in ['left','right'] and p['brand_panel'] else 0
        x0,y0,x1,y1=-w/2+r,-d/2+r,w/2-r,d/2-r
        bp=None
        if p['brand_panel']:
            if place=='left':bp=[x0+panel/2,0,panel*.9,d-2*r];x0+=panel+p['web']
            elif place=='right':bp=[x1-panel/2,0,panel*.9,d-2*r];x1-=panel+p['web']
            else:bp=[w*rng.uniform(-.15,.15),(1 if place=='top' else -1)*(d/2-r*.50),w*rng.uniform(.35,.55),r*.76]
        p.update(brand_panel=bp,branding_placement=place if bp else None,panel_width=panel,well_region_bounds=[x0,y0,x1,y1])
    p['columns']=p['compartments']//p['rows'];p['body_kind']='thermoformed_shell' if style=='thin_blister' else 'rigid_compartment_body' if style in ['rigid_organizer','weekly_2x7','twin_compact'] else 'moulded_shell'
    return p


def skin(G,w,d,h,openings,mat,thickness,radius=.004,rigid=False,name='continuous moulded tray'):
    # Rounded outer contour and every well share one connected heightfield mesh.
    nx=math.ceil(w/.00045);ny=math.ceil(d/.00045);y=np.linspace(-d/2,d/2,ny+1)
    radius=min(radius,w*.08,d*.15);inset=np.maximum(np.abs(y)-(d/2-radius),0);extent=w/2-radius+np.sqrt(np.maximum(0,radius**2-inset**2))
    xx=np.linspace(-1,1,nx+1)[None,:]*extent[:,None];yy=np.repeat(y[:,None],nx+1,axis=1);zz=np.full_like(xx,h)
    for x,y,cw,ch,r,draft in openings:
        r=min(r,cw*.49,ch*.49);qx=np.abs(xx-x)-(cw/2-r);qy=np.abs(yy-y)-(ch/2-r)
        dist=np.hypot(np.maximum(qx,0),np.maximum(qy,0))+np.minimum(np.maximum(qx,qy),0)-r
        t=np.clip((dist+draft)/draft,0,1);zz=np.minimum(zz,.00015+(h-.00015)*t*t*(3-2*t))
    vv=np.stack([xx,yy,zz],-1).reshape(-1,3).tolist();ff=[(j*(nx+1)+i,j*(nx+1)+i+1,(j+1)*(nx+1)+i+1,(j+1)*(nx+1)+i) for j in range(ny) for i in range(nx)]
    if rigid:
        boundary=list(range(nx+1))+[j*(nx+1)+nx for j in range(1,ny+1)]+[ny*(nx+1)+i for i in range(nx-1,-1,-1)]+[j*(nx+1) for j in range(ny-1,0,-1)]
        start=len(vv);vv.extend([(vv[i][0],vv[i][1],.00015) for i in boundary])
        for j,i in enumerate(boundary):k=(j+1)%len(boundary);ff.append((i,start+j,start+k,boundary[k]))
    o=G.mesh_obj(name,vv,ff,mat,1,smooth=True);mod=o.modifiers.new('physical plastic thickness','SOLIDIFY');mod.thickness=thickness;mod.offset=-1;mod.use_even_offset=True
    o['container_revision']='rounded_connected_skin_v46';return o


def build(G,rng,p,mat,ink,config=None,split=None):
    c=dict(config or {});w,d,h,n,rim,web=[p[k] for k in ['width','depth','height','compartments','rim','web']];style=p['style'];lang=p['language']
    font,_,_=P.choose_font(rng,split,c.get('holdout_font_families',False));c['_time_font_file']=font.filepath;c['_time_case']=rng.choice(['upper','upper','title']);c['_time_style']=c.get('preview_time_style') or rng.choices(['icon_left','icon_right','text_only','icon_only','clock_and_text'],[35,20,20,10,15])[0]
    x0,y0,x1,y1=p['well_region_bounds'];aw,ah=x1-x0,y1-y0;rows=p['rows'];cols=p['columns'];cells=[]
    widths=[1.]*cols if rows>1 else [rng.uniform(.84,1.16) for _ in range(cols)]
    if style=='adjustable':widths=[rng.uniform(.65,1.4) for _ in range(cols)]
    avail=aw-(cols-1)*web;widths=[v/sum(widths)*avail for v in widths];ch=(ah-(rows-1)*web)/rows
    for j in range(rows):
        x=x0;y=y1-ch/2-j*(ch+web)
        for k,cw in enumerate(widths):cells.append((x+cw/2,y,cw,ch));x+=cw+web
    p['cells_m']=[list(cell) for cell in cells];slots=[];openings=[]
    for j,(x,y,cw,ch) in enumerate(cells):
        draft=min(p['draft'],cw*.10,ch*.10);r=min(p['corner_radius'],cw*.24,ch*.24)
        if style=='round_cups':cw=ch=min(cw,ch)*.94;r=cw*.499
        openings.append((x,y,cw,ch,r,draft));column=j%cols;row=j//cols
        name=(DAYS[lang][column]+(' AM' if row==0 else ' PM')) if style=='weekly_2x7' else legacy.TEXTS[lang][j] if j<len(legacy.TEXTS[lang]) else str(j+1)
        margin=draft+.0006
        if style=='round_cups':margin=cw*(1-1/math.sqrt(2))*.5+draft
        sp={'name':name,'language':lang,'x_min_m':x-cw/2+margin,'x_max_m':x+cw/2-margin,'y_min_m':y-ch/2+margin,'y_max_m':y+ch/2-margin,'floor_z_m':.00095 if style in ['removable_inserts','round_cups'] else .00015,'row':row,'column':column,'cell_bounds_m':[x-cw/2,y-ch/2,x+cw/2,y+ch/2]}
        if rows==2:
            label_y=y+ch/2+rim*.45 if row==0 else y-ch/2-rim*.45;lh=rim*.70
        else:
            label_y=y-ch/2-rim*.47 if p['branding_placement']=='top' else y+ch/2+rim*.47;lh=rim*.76
        before=set(bpy.data.objects)
        sp['printed_header']=P.time_label(G,rng,name,j,x,label_y,cw,lh,h,ink,c,split)
        if style=='rigid_organizer' and rng.random()<.35:
            transform=Matrix.Translation((x,-d/2-.000025,h*.58))@Matrix.Rotation(math.pi/2,4,'X')@Matrix.Translation((-x,-label_y,-h))
            for ob in set(bpy.data.objects)-before:ob.matrix_world=transform@ob.matrix_world
            sp['header_surface']='outer front wall'
        if c.get('preview_floor_icons',rng.random()<.28):
            before=set(bpy.data.objects);design=['sunrise','sun','sunset','moon'][j%4]
            glyph_ink=ink if rng.random()<.8 else G.material('coloured time icon',rng.choice([(.10,.36,.13),(.60,.24,.035),(.06,.2,.48)]),.58,noise=0)
            P.glyph(G,rng,design,(x,y+ch*.22),min(.003,cw*.13),glyph_ink,kind='time_icon')
            for ob in set(bpy.data.objects)-before:ob.location.z+=sp['floor_z_m']+.000008
            sp['floor_icon']=design
        slots.append(sp)
        if style=='weekly_2x7':
            tab=G.material('weekday colour tab',[(.12,.35,.6),(.12,.5,.26),(.56,.4,.12),(.58,.2,.36),(.24,.3,.64),(.3,.5,.56),(.54,.33,.6)][column],.5,noise=0)
            G.cube('small weekday tab',(x+(cw*.35),label_y,h+.00002),(cw*.09,rim*.48,.00005),tab,1,.00012)
    if style in ['removable_inserts','round_cups']:
        skin(G,w,d,h,[((x0+x1)/2,(y0+y1)/2,aw,ah,.004,.002)],mat,p['thickness'],rigid=True,name='insert carrier')
        for x,y,cw,ch,r,draft in openings:
            o=skin(G,cw-.0007,ch-.0007,h-.0006,[(0,0,cw-.003,ch-.003,r,draft)],mat,.0005,radius=r,rigid=False,name='separate removable cup');o.location=(x,y,.0008)
    else:skin(G,w,d,h,openings,mat,p['thickness'],radius=p['corner_radius'],rigid=p['body_kind']=='rigid_compartment_body')
    if style=='thin_blister' and (c.get('preview_card_backing',rng.random()<.7)):
        card=G.material('white printed blister flange',(.89,.90,.86),.74,noise=.04)
        for yy in [-d/2+rim*.5,d/2-rim*.5]:G.cube('paper flange horizontal',(0,yy,h-.00010),(w-.0008,rim*.9,.00010),card,1,.00015)
        for xx in [-w/2+rim*.5,w/2-rim*.5]:G.cube('paper flange vertical',(xx,0,h-.00010),(rim*.9,d-.0008,.00010),card,1,.00015)
        for j in range(len(cells)-1):
            x=cells[j][0]+cells[j][2]/2+web/2
            G.cube('paper separator band',(x,(y0+y1)/2,h-.00010),(web*.82,ah,.00010),card,1,.00010)
        p['printed_backing']='white cellulose flange and separator bands'
    return slots


def choose_cover(rng,p,c):
    if c.get('preview_cover'):return c['preview_cover']
    style=p['style']
    if style=='weekly_2x7':return 'individual_hinged'
    if style=='rigid_organizer':return rng.choices(['hinged_single','detached_lid','none'],[76,16,8])[0]
    if style=='twin_compact':return rng.choice(['hinged_single','partly_open_sliding','none'])
    if style=='thin_blister':return rng.choices(['peeled_film','flexible_film','none'],[48,32,20])[0]
    if style in ['removable_inserts','round_cups']:return rng.choices(['detached_lid','none','rigid_sliding'],[35,40,25])[0]
    return rng.choices(['rigid_sliding','partly_open_sliding','none'],[55,25,20])[0]


def _to_collection(o,collection):
    for coll in list(o.users_collection):coll.objects.unlink(o)
    collection.objects.link(o)


def _panel(G,rng,w,d,z,center,angle,side,mat,collection,thickness,hinged=True):
    cx,cy=center;hy=cy+side*d/2
    frame=Matrix.Translation((cx,hy,z))@Matrix.Rotation(-side*angle,4,'X')@Matrix.Translation((0,-side*d/2,0))
    outline=G.outline(w,d,min(.003,w*.1,d*.1),16)
    o=G.mesh_obj('transparent moulded lid',[(x,y,0) for x,y in outline],[tuple(range(len(outline)))],mat,2,smooth=False);o.matrix_world=frame
    mod=o.modifiers.new('lid sheet thickness','SOLIDIFY');mod.thickness=thickness;mod.offset=-1;_to_collection(o,collection)
    # Raised peripheral lip, true rounded corners. Local solid rim catches edge reflections.
    outer=G.outline(w,d,min(.003,w*.1,d*.1),16);inner=G.outline(w-.0018,d-.0018,min(.0023,w*.075,d*.075),16);n=len(outer)
    vv=[(x,y,.00045) for x,y in outer]+[(x,y,.00045) for x,y in inner];ff=[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    lip=G.mesh_obj('moulded raised lid lip',vv,ff,mat,2,smooth=True);lip.matrix_world=frame;mod=lip.modifiers.new('lip thickness','SOLIDIFY');mod.thickness=.0008;_to_collection(lip,collection)
    # Latch moves with the cover, hinge barrels stay on the body.
    latch=G.cube('clear snap latch',(0,-side*(d/2+.0014),-.0001),(min(.012,w*.25),.0035,.0014),mat,2,.0006);latch.matrix_world=frame@latch.matrix_world;_to_collection(latch,collection)
    if hinged:
        for xx in [-w*.32,w*.32]:
            bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=.0015,depth=min(.008,w*.18),location=(cx+xx,hy,z-.0005),rotation=(0,math.pi/2,0));hinge=bpy.context.object;hinge.name='stationary hinge barrel';G.assign(hinge,mat,1)
            for f in hinge.data.polygons:f.use_smooth=True
    points=[frame@Vector((x,y,.001)) for x,y in outer]
    label_frame=frame if angle<=math.pi/2 else frame@Matrix.Translation((0,0,-thickness-.00012))@Matrix.Rotation(math.pi,4,'X')
    return {'label_face':'outside' if angle<=math.pi/2 else 'inside','width_m':w,'depth_m':d,'matrix_world':[list(r) for r in label_frame],'surface_z_local_m':.0001,'angle_deg':math.degrees(angle),'bounds_m':[[min(v[k] for v in points) for k in range(3)],[max(v[k] for v in points) for k in range(3)]]}


def cover(G,rng,p,collection,kind,tray_material,config):
    w,d,z=p['width'],p['depth'],p['height'];c=config
    if kind=='none':return {'kind':'none','label_surfaces':[],'revision':'mechanisms_v46'}
    if kind in ['rigid_sliding','partly_open_sliding','flexible_film']:
        rec=legacy.cover(G,rng,w,d,z,collection,kind,tray_material,c)
        ob=next(o for o in collection.objects if o.type=='MESH');rec['abrasion']=wear_v46.add_wear(ob.data.materials[0],rng,'plastic');return rec
    mat=G.material('clear hinged PET lid',(.98,.99,1),rng.uniform(.06,.12),transmission=1,noise=0);mat.node_tree.nodes.get('Principled BSDF').inputs['IOR'].default_value=1.49
    oils=cover_wear.smudges(mat,rng,w,d,c.get('cover_smudge_probability',.8));abrasion=wear_v46.add_wear(mat,rng)
    thick=rng.uniform(.0007,.0013);surfaces=[]
    if kind=='individual_hinged':
        for j,(cx,cy,cw,ch) in enumerate(p['cells_m']):
            row=j//p['columns'];side=1 if row==0 else -1
            angle=math.radians(c['preview_lid_angle']) if 'preview_lid_angle' in c else 0 if rng.random()<.42 else math.radians(rng.uniform(115,172))
            surfaces.append(_panel(G,rng,cw+.0007,ch+.0007,z+.001,(cx,cy),angle,side,mat,collection,thick))
    elif kind in ['hinged_single','detached_lid']:
        angle=math.radians(float(c.get('preview_lid_angle',rng.choice([0,0,rng.uniform(125,175)])))) if kind=='hinged_single' else math.radians(rng.uniform(-5,5))
        center=(0,0) if kind=='hinged_single' else (rng.uniform(-.018,.018),d+rng.uniform(.004,.014))
        surf=_panel(G,rng,w-.001,d-.001,z+.001 if kind=='hinged_single' else .0007,center,angle,1,mat,collection,thick,hinged=kind=='hinged_single');surfaces.append(surf)
    elif kind=='peeled_film':
        thick=rng.uniform(.00004,.00007);nx,ny=130,48;frac=rng.uniform(.12,.30);peel=rng.uniform(.006,.022);vv=[];ff=[]
        for j in range(ny+1):
            y=(j/ny-.5)*(d-.0008)
            for i in range(nx+1):
                u=i/nx;x=(u-.5)*w;t=max(0,(u-(1-frac))/frac);lift=peel*t*t
                zz=z+.0004+lift+.00035*math.sin(u*28+j/ny*7)*(math.sin(math.pi*j/ny)**2)
                vv.append((x,y,zz))
        for j in range(ny):
            for i in range(nx):a=j*(nx+1)+i;ff.append((a,a+1,a+nx+2,a+nx+1))
        o=G.mesh_obj('curled partly peeled clear film',vv,ff,mat,2,smooth=True);_to_collection(o,collection);mod=o.modifiers.new('thin peelable film','SOLIDIFY');mod.thickness=thick
        return {'kind':kind,'revision':'mechanisms_v46','thickness_mm':thick*1000,'peel_fraction':frac,'peel_lift_mm':peel*1000,'smudges':oils,'abrasion':abrasion,'label_surfaces':[],'no_label_on_peel':True}
    else:raise ValueError(kind)
    return {'kind':kind,'revision':'mechanisms_v46','thickness_mm':thick*1000,'smudges':oils,'abrasion':abrasion,'label_surfaces':surfaces,'displacement_mm':0,'geometric_model':'rigid hinge transformations and moulded edge priors; not mechanics simulation'}
