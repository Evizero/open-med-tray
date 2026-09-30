"""Physically scaled Cycles medication-tray generator (Blender 5.2).
A continuous molded-well surface, actual refraction, geometry scores, and micron-scale wear.
All palette entries and identity markings are synthetic. No clinical identity labels.
"""
import argparse
import json
import math
import random
import sys
import time
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(Path(__file__).resolve().parent))
from environment import surface,illuminate
from pill_surface import pill_material, PRESETS
from tablet_geometry import compression_tablet, deboss, fracture_tablet, chip_tablet
from imprint_geometry import imprint as stamp_imprint
import tray_details
import container_geometry
import printed_graphics
import patient_stickers
import container_v46
import lighting_v46
import placement_v46
import edge_scenarios_v46
import wear_v46
FAMILIES=['round_flat','round_biconvex','oval_tablet','caplet','hard_capsule','softgel','oblong_tablet','triangular_tablet','diamond_tablet','hexagonal_tablet','ring_tablet','unknown_shape']
COLORS=[(.88,.87,.82),(.94,.92,.86),(.92,.89,.76),(.87,.75,.36),(.64,.30,.26),(.76,.51,.45),(.52,.68,.77),(.61,.69,.42),(.27,.12,.065)]


def material(name,color,roughness=.4,transmission=0,metallic=0,noise=.1,subsurface=0):
    m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;p=n.get('Principled BSDF');links=m.node_tree.links
    p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=roughness;p.inputs['Metallic'].default_value=metallic;p.inputs['Transmission Weight'].default_value=transmission;p.inputs['IOR'].default_value=1.47
    p.inputs['Subsurface Weight'].default_value=subsurface;p.inputs['Subsurface Radius'].default_value=(.00025,.00015,.00008)
    if noise:
        tc=n.new('ShaderNodeTexCoord');tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=4800;tex.inputs['Detail'].default_value=3
        links.new(tc.outputs['Object'],tex.inputs['Vector'])
        bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=noise;bump.inputs['Distance'].default_value=.000009
        links.new(tex.outputs['Fac'],bump.inputs['Height']);links.new(bump.outputs['Normal'],p.inputs['Normal'])
        ramp=n.new('ShaderNodeMapRange');ramp.inputs['To Min'].default_value=max(.01,roughness-.08);ramp.inputs['To Max'].default_value=min(1,roughness+.08)
        links.new(tex.outputs['Fac'],ramp.inputs['Value']);links.new(ramp.outputs['Result'],p.inputs['Roughness'])
    return m


def assign(obj,mat,iid):obj.data.materials.append(mat);obj.pass_index=iid;return obj


def mesh_obj(name,verts,faces,mat=None,iid=0,smooth=True):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    for f in mesh.polygons:f.use_smooth=smooth
    if mat:assign(obj,mat,iid)
    return obj


def cube(name,loc,dims,mat,iid=0,bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=dims;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);assign(o,mat,iid)
    if bevel:
        mod=o.modifiers.new('manufactured edge radius','BEVEL');mod.width=bevel;mod.segments=6
        o.modifiers.new('weighted corner normals','WEIGHTED_NORMAL')
    return o


def outline(w,h,r,n=20):
    pts=[]
    for cx,cy,start in [(w/2-r,h/2-r,0),(-w/2+r,h/2-r,90),(-w/2+r,-h/2+r,180),(w/2-r,-h/2+r,270)]:
        for j in range(n):
            a=math.radians(start+j*90/(n-1));pts.append((cx+r*math.cos(a),cy+r*math.sin(a)))
    return pts


def molded_well(cx,w,h,z,mat):
    """Continuous floor, curved floor fillet, drafted wall and rounded rim in one mesh."""
    profiles=[(w-.008,h-.012,.00015,.003),(w-.0055,h-.0095,.0003,.0035),(w-.0038,h-.0078,.001,.004),(w-.0028,h-.0068,.0023,.0045),(w-.0014,h-.0028,z-.002,.0045),(w-.0005,h-.001,z-.0006,.0045),(w,h,z,.0045),(w+.0015,h+.0015,z+.0001,.0048)]
    verts=[]
    for ww,hh,zz,rr in profiles:verts.extend((cx+x,y,zz) for x,y in outline(ww,hh,rr))
    n=len(verts)//len(profiles);faces=[tuple(range(n))]
    for j in range(len(profiles)-1):
        for k in range(n):a=j*n+k;b=j*n+(k+1)%n;faces.append((a,a+n,b+n,b))
    o=mesh_obj('injection molded well',verts,faces,mat,1)
    # The broad floor should be planar, with no smooth-shading interpolation across its ngon.
    o.data.polygons[0].use_smooth=False
    sol=o.modifiers.new('0.6 mm molded shell','SOLIDIFY');sol.thickness=.0006
    return o


def point_at(obj,point):obj.rotation_euler=(Vector(point)-obj.location).to_track_quat('-Z','Y').to_euler()


def _rounded_tablet(family,l,w,h,rng,score,chip):
    n=192;rings=64;verts=[];faces=[];a_chip=rng.uniform(-math.pi,math.pi)
    for j in range(rings+1):
        phi=math.pi*j/rings
        soft=family=='softgel';exponent=1 if soft else (.66 if family in ['round_biconvex','oval_tablet'] else .18)
        radial=math.sin(phi)**exponent;z=h/2*math.cos(phi)
        for k in range(n):
            a=k*2*math.pi/n;c=math.cos(a);s=math.sin(a)
            exp={'caplet':.7,'oblong_tablet':.32,'diamond_tablet':1.7}.get(family,1)
            x=l/2*math.copysign(abs(c)**exp,c)*radial;y=w/2*math.copysign(abs(s)**exp,s)*radial
            sides={'triangular_tablet':3,'hexagonal_tablet':6}.get(family)
            if sides:
                sec=2*math.pi/sides;f=math.cos(math.pi/sides)/math.cos((a+math.pi/sides)%sec-math.pi/sides);x*=f;y*=f
            if family=='unknown_shape':f=1+.18*math.cos(5*a);x*=f;y*=f
            d=math.atan2(math.sin(a-a_chip),math.cos(a-a_chip))
            if chip and abs(d)<.4 and radial>.68:
                f=1-chip*(1-abs(d)/.4);x*=f;y*=f;zv=z+rng.uniform(-1,1)*h*chip*.12
            else:zv=z
            if score and z>0:
                groove=max(0,1-abs(x)/.00048);zv-=min(h*.23,.00065)*groove
                if score==2:zv-=min(h*.23,.00065)*max(0,1-abs(y)/.00048)
            if soft:
                # Fine heat-sealed rim at the softgel equator, with small waviness.
                seam=math.exp(-(z/.000055)**2)*.004
                x*=1+seam;y*=1+seam
            verts.append((x,y,zv))
    for j in range(rings):
        for k in range(n):a=j*n+k;b=j*n+(k+1)%n;faces.append((a,b,b+n,a+n))
    return mesh_obj(family,verts,faces)


def tablet(family,l,w,h,rng,score,chip,**geometry_options):
    if family=='softgel':
        from softgel_geometry import softgel_mesh
        return softgel_mesh(l,w,h,rng,**geometry_options)
    return compression_tablet(family,l,w,h,rng,score,chip,**geometry_options)


def capsule(l,w,h):
    verts=[];faces=[];n=96;r=w/2;straight=max(.001,l/2-r)
    # Capsule shells have hemispherical ends and a cylindrical body, not an ellipsoid.
    xs=[]
    for j in range(17):
        a=-math.pi/2+j*math.pi/2/16;xs.append((-straight+r*math.sin(a),r*math.cos(a)))
    xs.extend([(-.00012,r),(.000015,r),(.000035,r*1.035),(.00013,r*1.035),(.00048,r*1.03),(.00062,r*1.035),(straight,r*1.035)])
    for j in range(1,17):
        a=j*math.pi/2/16;xs.append((straight+r*math.sin(a),r*math.cos(a)*1.035))
    for x,rr in xs:
        for k in range(n):
            a=k*2*math.pi/n
            irregular=.000006*math.sin(a*9+x*520)*math.sin(a*5-x*950)
            local_rr=rr+irregular*min(1.,rr/.001)
            verts.append((x,local_rr*math.cos(a),local_rr*math.sin(a)*h/w))
    for j in range(len(xs)-1):
        for k in range(n):a=j*n+k;b=j*n+(k+1)%n;faces.append((a,b,b+n,a+n))
    return mesh_obj('hard capsule shell with cap overlap',verts,faces)


def make_pill(family,length,width,height,mat,second,idx,rng,chip=0,score=0,**geometry_options):
    if family=='ring_tablet':
        bpy.ops.mesh.primitive_torus_add(major_radius=length*.34,minor_radius=length*.16,major_segments=96,minor_segments=24);o=bpy.context.object;o.scale.z=height/(length*.32);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        for f in o.data.polygons:f.use_smooth=True
    elif family=='hard_capsule':o=capsule(length,width,height)
    else:o=tablet(family,length,width,height,rng,score,0,**geometry_options)
    bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-8);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();o.data.update()
    assign(o,mat,idx)
    if chip and family not in ['hard_capsule','softgel','ring_tablet']:
        core=pill_material('chipped compressed core',json.loads(mat['surface_parameters_json']).get('body_color',(.88,.87,.82)) if json.loads(mat['surface_parameters_json']).get('finish')=='chalky_uncoated' else (.91,.9,.85),'chalky_uncoated',seed=idx,grain_um=170,relief_um=65,pore_density=.42)
        chip_tablet(o,core,seed=rng.randrange(100000),amount=chip,count=2 if chip>.25 else 1)
    if family=='hard_capsule':
        o.data.materials.append(second)
        for f in o.data.polygons:
            if f.center.x>0:f.material_index=1
    if family=='softgel':
        o.data.materials.append(second)
        for f in o.data.polygons:
            if f.center.y>0:f.material_index=1
    return o


def text_obj(text,loc,size,mat,iid=1,angle=0):
    bpy.ops.object.text_add(location=loc);o=bpy.context.object;o.name='mark '+text;o.data.body=text;o.data.align_x='CENTER';o.data.align_y='CENTER';o.data.size=size;o.data.extrude=.000008;o.rotation_euler.z=angle;assign(o,mat,iid);return o


def film_mesh(width,depth,z,rng,collection):
    verts=[];faces=[];nx=100;ny=44
    phase=rng.uniform(0,6)
    for j in range(ny+1):
        for i in range(nx+1):
            x=(i/nx-.5)*width;y=(j/ny-.5)*depth
            # Smooth continuous ridges, not independent random vertex heights.
            zz=z+.00017*math.sin(90*x+40*y+phase)+.00009*math.sin(180*y+phase)+.00005*math.sin(310*x+210*y)
            verts.append((x,y,zz))
    for j in range(ny):
        for i in range(nx):a=j*(nx+1)+i;faces.append((a,a+1,a+nx+2,a+nx+1))
    mat=material('clear polypropylene lid film',(1,1,1),.025,transmission=1,noise=0)
    mat.node_tree.nodes['Principled BSDF'].inputs['IOR'].default_value=1.49
    o=mesh_obj('tensioned clear plastic film',verts,faces,mat,2)
    for c in list(o.users_collection):c.objects.unlink(o)
    collection.objects.link(o);sol=o.modifiers.new('45 micron film','SOLIDIFY');sol.thickness=.000045
    return o


def generate_scene(c,split,index,out):
    c=dict(c);v46=c.get('revision',45)>=46;geometry=container_v46 if v46 else container_geometry
    seed=c['seed']+{'train':0,'val':1000000,'test':2000000,'stress':3000000,'preview':4000000}[split]+index;rng=random.Random(seed);stress=split=='stress'
    if v46 and c.get('edge_suite'):c=edge_scenarios_v46.configure(c,index,split)
    if v46 and stress and not c.get('edge_suite'):
        stress_designs=[
            ('light_ink_empty',dict(preview_tray_style='moulded_daily',preview_container='navy_polypropylene',preview_light_ink=True,empty_probability=1,branding_probability=1,sticker_probability=1,preview_floor_icons=True)),
            ('glare_cover',dict(preview_cover='rigid_sliding',preview_film=True,preview_lighting='chamber_glare')),
            ('weekly_small_objects',dict(preview_tray_style='weekly_2x7',preview_cover='individual_hinged',preview_lid_angle=0,pills_per_scene=[8,15])),
            ('phone_low_light',dict(camera_profile='low_light',preview_lighting='indoor')),
            ('dark_icons',dict(preview_container='navy_polypropylene',preview_light_ink=True,preview_floor_icons=True,branding_probability=1)),
            ('label_occlusion',dict(sticker_probability=1,preview_cover='rigid_sliding',preview_film=True)),
            ('damaged_debris',dict(chip_probability=.65,fragment_probability=.80,debris_probability=1)),
            ('mixed_tinted',dict(preview_container='tinted_clear',preview_lighting='mixed_light',camera_profile='phone_processed'))]
        tag,overrides=stress_designs[index%len(stress_designs)];c.update(overrides);c['stress_factor']=tag
    bpy.ops.wm.read_factory_settings(use_empty=True);s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=c['samples'];s.cycles.use_denoising=True;s.cycles.adaptive_threshold=.008;s.cycles.max_bounces=10;s.cycles.transmission_bounces=8;s.cycles.transparent_max_bounces=8
    if c.get('device')=='METAL':
        prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='METAL';prefs.get_devices()
        for d in prefs.devices:d.use=d.type=='METAL'
        s.cycles.device='GPU'
    if c.get('cpu_threads'):
        s.render.threads_mode='FIXED';s.render.threads=c['cpu_threads']
    resolution=c['resolution'];s.render.resolution_x=resolution;s.render.resolution_y=round(resolution*c.get('aspect_height',.5));s.render.resolution_percentage=100
    s.render.image_settings.file_format='OPEN_EXR';s.render.image_settings.media_type='MULTI_LAYER_IMAGE';s.render.image_settings.color_depth='32';s.render.image_settings.exr_codec='ZIP'
    s.world=bpy.data.worlds.new('enclosure ambient');s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs[0].default_value=(.8,.86,1,1);s.world.node_tree.nodes['Background'].inputs[1].default_value=rng.uniform(.12,.24)
    details_rng=random.Random(seed+928431)
    tray_params=geometry.parameters(details_rng,c)
    width,depth,wallheight,compartments,rim,panel_w=[tray_params[k] for k in ['width','depth','height','compartments','rim','panel_width']]
    branded=tray_params['brand_panel'] is not None;well_h=depth-2*rim
    container=rng.choice(['blue_polypropylene','gray_polypropylene','white_plastic','blue_polypropylene','clear_plastic'])
    palette={'blue_polypropylene':(.035,.23,.47),'gray_polypropylene':(.30,.35,.44),'white_plastic':(.83,.84,.81),'clear_plastic':(.88,.95,.99),'milky_polypropylene':(.80,.85,.89),'tinted_clear':(.43,.68,.82),'pink_polypropylene':(.76,.42,.49),'navy_polypropylene':(.018,.052,.13),'lilac_polypropylene':(.43,.44,.58)}
    if v46:
        container=rng.choices(list(palette),[19,15,20,10,12,8,6,6,4])[0]
        if tray_params['style'] in ['rigid_organizer','weekly_2x7','round_cups']:container=rng.choice(['clear_plastic','milky_polypropylene','tinted_clear'])
        if tray_params['style']=='thin_blister':container=rng.choice(['clear_plastic','clear_plastic','milky_polypropylene'])
    if c.get('preview_container'):container=c['preview_container']
    base=palette[container]
    if v46:base=tuple(min(.98,max(.008,x*rng.uniform(.9,1.10))) for x in base)
    material_evidence={}
    if v46:tm,material_evidence=wear_v46.plastic_material(sys.modules[__name__],details_rng,container,base)
    else:
        tm=material(container,base,.25 if container!='clear_plastic' else .065,transmission=.92 if container=='clear_plastic' else 0,noise=.1 if container!='clear_plastic' else 0)
        tm.node_tree.nodes['Principled BSDF'].inputs['Coat Weight'].default_value=.18;tm.node_tree.nodes['Principled BSDF'].inputs['Coat Roughness'].default_value=.16
    surface_kind=rng.choice(['brushed_steel','smudged_steel','wood','laminate','plastic','quartz','concrete','slate'] if v46 else ['brushed_steel','smudged_steel','wood','laminate','plastic'])
    if c.get('preview_surface'):surface_kind=c['preview_surface']
    desk=(lighting_v46.surface if v46 else surface)(surface_kind,rng)
    worktop_span=2.4 if c.get('edge_suite') else 1
    cube('trolley worktop',(0,0,.00015-tray_params['thickness']-.00304),(worktop_span,worktop_span,.006),desk,0,.001)
    c['light_ink']=c.get('preview_light_ink',bool(v46 and sum(base)/3<.40 and rng.random()<.7))
    ink=material('tray printed ink',(.93,.94,.9) if c['light_ink'] else (.025,.033,.045),.55,noise=0)
    slots=geometry.build(sys.modules[__name__],details_rng,tray_params,tm,ink,c,split)
    if c.get('edge_suite'):slots=edge_scenarios_v46.support_regions(slots,tray_params,c)
    tray_branding=printed_graphics.branding(sys.modules[__name__],details_rng,tray_params['brand_panel'],wallheight,ink,c,split) if branded else None
    hood=material('black matte camera hood',(.025,.03,.035),.85)
    overlay=bpy.data.collections.new('Transparent film');s.collection.children.link(overlay)
    wear_cohort=(rng.random()<.15) if v46 else (split=='train' and index>=480) or (split in ['test','stress'] and index>=80)
    objects=[];positions=[];lookup={0:0,1:1};iid=10
    count=0 if rng.random()<c['empty_probability'] else rng.randint(*c['pills_per_scene'])
    appearance_rows=[]
    if c.get('appearance_preset_probability',0)>0:
        from appearance_presets import load_presets
        appearance_rows=load_presets(c.get('appearance_presets_path'))
    products=placement_v46.product_pool(rng,FAMILIES,appearance_rows,c,split) if v46 else []
    slot_plan=placement_v46.occupied_slots(rng,count,compartments) if v46 else []
    if c.get('edge_suite'):slot_plan=edge_scenarios_v46.slot_plan(rng,count,slots,c,slot_plan)
    placed=[];placement_rejections=0
    for k in range(count):
        proto=rng.choice(products) if v46 else None
        if v46:
            family=proto['family'];cls=FAMILIES.index(family)+2;length=proto['length'];pw=proto['width'];h=proto['height'];col=proto['color'];col2=proto['secondary_color'];finish=proto['finish'];appearance=proto['appearance']
            if appearance:ap=appearance['parameters']
        else:
            family=FAMILIES[(index*7+k)%len(FAMILIES)];cls=FAMILIES.index(family)+2
            elongated=family in ['oval_tablet','caplet','hard_capsule','softgel','oblong_tablet'];length=rng.uniform(10,19)/1000 if elongated else rng.uniform(6,11.5)/1000
            pw=length*rng.uniform(.39,.62) if elongated else length;h=rng.uniform(.002,.0037)
            if family in ['hard_capsule','softgel']:h=pw*rng.uniform(.82,1)
            if family=='round_flat':h*=.7
            col=rng.choice(COLORS);col2=rng.choice(COLORS)
            finish=rng.choice(['chalky_uncoated','matte_film','satin_film']) if family not in ['hard_capsule','softgel'] else ('gelatin_shell' if family=='hard_capsule' else 'softgel_shell')
            appearance=None
            if appearance_rows and rng.random()<c['appearance_preset_probability']:
                appearance=rng.choice(appearance_rows);ap=appearance['parameters']
                family=ap['family'];cls=FAMILIES.index(family)+2
                length,pw,h=[ap[key]/1000 for key in ['length_mm','width_mm','height_mm']]
                col=ap['color'];col2=ap['secondary_color'];finish=ap['finish']
        rough={'chalky_uncoated':rng.uniform(.75,.94),'matte_film':rng.uniform(.58,.77),'satin_film':rng.uniform(.42,.6),'gelatin_shell':rng.uniform(.18,.34),'softgel_shell':rng.uniform(.07,.19)}[finish]
        if v46 and family=='softgel':rough=proto['softgel_roughness']
        softgel_material=dict(softgel_transmission=proto['softgel_transmission'],softgel_scatter=proto['softgel_scatter']) if v46 and family=='softgel' else {}
        surface_wear=rng.uniform(.35,1) if wear_cohort and rng.random()<.6 else 0
        rough=min(.96,rough+surface_wear*.24)
        material_seed=rng.randrange(100000)
        mat=pill_material('pill '+finish,col,finish,seed=material_seed,roughness=rough,wear=surface_wear,grain_um=PRESETS[finish]['grain_um']*rng.uniform(.7,1.5),texture=rng.uniform(.65,1.4),powder=rng.uniform(.15,1.1),scuffs=rng.uniform(.15,1.3),transmission_density=proto['softgel_density'] if v46 and family=='softgel' else rng.uniform(150,700),**softgel_material,speckles=appearance['parameters'].get('speckles',0) if appearance else 0)
        mat2=pill_material('capsule cap',col2,finish,seed=material_seed+1,roughness=rough,wear=surface_wear,transmission_density=proto['softgel_density'] if v46 and family=='softgel' else 350,**softgel_material)
        rough=json.loads(mat['surface_parameters_json'])['roughness']
        chip=rng.uniform(.12,.34) if rng.random()<(.55 if wear_cohort else c['chip_probability']) and family not in ['hard_capsule','softgel','ring_tablet'] else 0
        score=proto['score'] if v46 else rng.choice([0,1,1,2]) if family not in ['hard_capsule','softgel','ring_tablet'] else 0
        shape_options=dict(outline_variant='family',score_layout='auto',score_faces='top')
        if appearance:
            score=ap['score'];shape_options={key:ap[key] for key in shape_options}
        if family not in ['hard_capsule','softgel','ring_tablet'] and rng.random()<c.get('face_rim_probability',0):
            shape_options.update(face_rim_width_mm=rng.triangular(.08,.55,.16),crown_height_mm=h*1000*rng.triangular(.025,.18,.065),crown_curve=rng.uniform(1.2,2.0),crown_edge_blend_mm=rng.uniform(.02,.18))
        if v46 and family=='softgel':shape_options.update({k:v for k,v in proto.items() if k.startswith('softgel_')})
        o=make_pill(family,length,pw,h,mat,mat2,iid,random.Random(proto['geometry_seed']) if v46 else rng,chip,score,**shape_options,breakout_density=rng.uniform(.008,.065),breakout_size_mm=rng.uniform(.11,.22),score_width_mm=proto['score_width_mm'] if v46 else rng.uniform(.14,.70),score_depth_mm=proto['score_depth_mm'] if v46 else rng.uniform(.06,.24),press_defects=rng.uniform(.4,1.3) if finish=='chalky_uncoated' else rng.uniform(.1,.5),edge_wear=rng.uniform(0,1) if chip else rng.uniform(0,.25));fraction=1.
        if rng.random()<.08 and family not in ['hard_capsule','softgel','ring_tablet','unknown_shape']:
            core=pill_material('exposed compressed core',col if finish=='chalky_uncoated' else (.91,.9,.85),'chalky_uncoated',seed=material_seed+2,grain_um=180,relief_um=75,pore_density=.48)
            fracture_tablet(o,core,seed=material_seed+3,waviness_mm=rng.uniform(.12,.45),lip_mm=rng.uniform(.15,.9),tilt_deg=rng.uniform(-35,35));fraction=.5
        pose=None
        if v46:
            pose=placement_v46.place(o,rng,slots,slot_plan[k],placed,family,c)
            if pose is None:bpy.data.objects.remove(o,do_unlink=True);placement_rejections+=1;continue
            slot=pose['slot'];x,y,z,angle,stacked=[pose[key] for key in ['x','y','z','angle','stacked']];lookup[iid]=cls
            bpy.context.view_layer.update()
        else:
            slot=k%compartments;sp=slots[slot];angle=rng.uniform(0,2*math.pi)
            if sp['x_max_m']-sp['x_min_m']<length*1.15 and length>pw*1.2:angle=math.pi/2+rng.uniform(-.13,.13)
            ca,sa=math.cos(angle),math.sin(angle)
            xs=[v.co.x*ca-v.co.y*sa for v in o.data.vertices];ys=[v.co.x*sa+v.co.y*ca for v in o.data.vertices]
            xmin,xmax,ymin,ymax=min(xs),max(xs),min(ys),max(ys)
            for attempt in range(100):
                lo,hi=sp['x_min_m']-xmin,sp['x_max_m']-xmax;bo,to=sp['y_min_m']-ymin,sp['y_max_m']-ymax
                x=rng.uniform(lo,hi) if lo<=hi else (lo+hi)/2;y=rng.uniform(bo,to) if bo<=to else (bo+to)/2
                if all(math.hypot(x-px,y-py)>(length+pl)*.48 for px,py,pl,ph in positions):break
            stacked=False;z=sp.get('floor_z_m',.00015)+.00003-min(v.co.z for v in o.data.vertices)
            if positions and rng.random()<(0.24 if stress else c['overlap_probability']):
                px,py,pl,ph=positions[-1];x=px+length*.22;y=py;z+=ph;stacked=True;slot=objects[-1]['compartment']
            o.location=(x,y,z);o.rotation_euler.z=angle;positions.append((x,y,length,h));lookup[iid]=cls
        # Recessed imprint on tablets. On capsules a printed mark is physically plausible.
        imprint=proto['imprint'] if v46 else ap['synthetic_marking'] if appearance else rng.choice(['A1','B2','10','25','50',''])
        imprint_rendered=False;imprint_style=None
        if imprint and fraction==1 and family not in ['ring_tablet','unknown_shape']:
            if family=='hard_capsule' or (v46 and family=='softgel'):
                if v46:
                    pill_ink=material('capsule contrasting ink',(.92,.92,.88) if sum(col)/3<.35 else (.025,.03,.035),.56,noise=0)
                    imprint_rendered=placement_v46.capsule_print(sys.modules[__name__],o,imprint,min(length*.14,.0019),pill_ink,iid)
                else:text_obj(imprint,(x,y,z+h/2+.00002),min(length*.17,.0022),ink,iid,angle);imprint_rendered=True
                imprint_style='printed' if imprint_rendered else None
            elif family!='softgel' and rng.random()<.7:
                if rng.random()<c.get('imprint_layout_probability',.5):
                    layout=proto['imprint_layout'] if v46 else rng.choice(['text','text','cross','stacked','boxed','symbol_code'])
                    if layout=='cross':imprint=rng.choice(['MED','METER','TAT'])
                    elif layout=='stacked':imprint=rng.choice(['AB/125','M/25','RX/50'])
                    elif layout=='boxed':imprint=rng.choice(['M','A','8'])
                    elif layout=='symbol_code':imprint=rng.choice(['25','50','AB'])
                    else:imprint=rng.choice(['8','25','AB','125'])
                    span=min(length,pw)*1000*rng.uniform(.55,.78);xy=(0.,0.)
                    if score:
                        span=min(length*.29,pw*.56)*1000;xy=(length*220,pw*180 if score==2 else 0.)
                    imprint_style=rng.choice(['debossed']*9+['embossed'])
                    imprint_rendered=stamp_imprint(o,imprint,layout=layout,span_mm=span,xy_mm=xy,depth_mm=rng.uniform(.07,.17),font=rng.choice(['sans','bold','serif','mono']),symbol=rng.choice(['diamond','shield','triangle','circle']),wear=rng.uniform(0,.4),style=imprint_style)
                    if not imprint_rendered:imprint_style=None
                else:
                    imprint_rendered=deboss(o,imprint,min(length*.12,pw*.20,.0019),xy=(length*.22,0),depth_mm=.12)
                    if imprint_rendered:imprint_style='debossed'
        objects.append({'instance_id':iid,'class_id':cls,'family':family,'length_mm':length*1000,'width_mm':pw*1000,'height_mm':h*1000,'color':col,'secondary_color':col2,'roughness':rough,'surface_wear':surface_wear,'surface_parameters':json.loads(mat['surface_parameters_json']),'edge_wear':o.get('edge_wear',0),'press_defects_strength':o.get('press_defects_strength',0),'press_depressions':o.get('press_depressions',0),'breakout_revision':o.get('breakout_revision'),'breakout_density_per_mm2':o.get('breakout_density_per_mm2',0),'breakout_size_mm':o.get('breakout_size_mm',0),'geometry_revision':o.get('geometry_revision','shell_v4'),'outline_variant':o.get('outline_variant','family'),'score_layout':o.get('score_layout','none'),'score_faces':o.get('score_faces','none'),'face_rim_width_mm':o.get('face_rim_width_mm',0),'crown_height_mm':o.get('crown_mm',0),'crown_curve':o.get('crown_curve',0),'crown_edge_blend_mm':o.get('crown_edge_blend_mm',0),'appearance_reference':{key:appearance[key] for key in ['id','source_url','source_pdf_sha256','declared','assumptions']} if appearance else None,'score_width_mm':o.get('score_width_mm',0),'score_depth_mm':o.get('score_depth_mm',0),'finish':finish,'chip':chip,'score':score,'damage_parameters':{key:o[key] for key in ['chip_revision','chip_seed','missing_chunks','chip_amount','fracture_revision','fracture_seed','fracture_offset_mm','fracture_waviness_mm','fracture_lip_mm','fracture_tilt_deg','geometric_remaining_fraction'] if key in o},'dose_fraction':fraction,'imprint':imprint if imprint_rendered else '', 'imprint_rendered':imprint_rendered,'imprint_style':imprint_style,'imprint_parameters':json.loads(o['imprint_parameters_json']) if 'imprint_parameters_json' in o and imprint_rendered else None,'imprint_failure_reason':o.get('imprint_failure_reason'),'compartment':slot,'stacked':stacked,'position_m':[x,y,z],'drug_identity':None})
        if v46:
            objects[-1].update({key:proto[key] for key in ['color_family','secondary_color_family','two_tone','color_provenance']})
            if family=='softgel':objects[-1].update(softgel_parameters=json.loads(o['softgel_parameters_json']),softgel_opacity=proto['softgel_opacity'])
        if v46:objects[-1].update(product_key=proto['product_key'],pose=pose,face_up=pose['face_up'],score_visible=bool(pose['face_up'] and score),imprint_visible=bool(imprint_rendered and pose['face_up']))
        if c.get('edge_suite'):
            objects[-1].update(support_slot=slot,placement_region=slots[slot]['region_kind'])
            if slots[slot]['region_kind']=='table':objects[-1]['compartment']=None
        iid+=1
    iid,powder_clouds=tray_details.scatter(sys.modules[__name__],details_rng,objects,slots,lookup,iid,c)
    film=rng.random()<c['plastic_probability'] or (stress and not v46)
    if c.get('preview_film') is not None:film=c['preview_film']
    cover_kind=geometry.choose_cover(details_rng,tray_params,c) if v46 else c.get('preview_cover') or details_rng.choices(['rigid_sliding','flexible_film','partly_open_sliding'],[60,30,10])[0]
    if v46 and cover_kind in ['individual_hinged','hinged_single','detached_lid','peeled_film']:film=True
    if cover_kind=='none':film=False
    cover=(geometry.cover(sys.modules[__name__],details_rng,tray_params,overlay,cover_kind,tm,c) if v46 else geometry.cover(sys.modules[__name__],details_rng,width,depth,wallheight,overlay,cover_kind,tm,c)) if film else {'kind':'none'}
    stickers=patient_stickers.add(sys.modules[__name__],details_rng,tray_params,cover,c)
    # Secondary lid branding has the same company and face as the body printing.
    if v46 and tray_branding and cover.get('label_surfaces') and cover_kind!='individual_hinged' and details_rng.random()<.7:
        from mathutils import Matrix
        frame=cover['label_surfaces'][0];before=set(bpy.data.objects)
        bc=dict(c,brand_name=tray_branding['company_name'],brand_font_path=str(ROOT/'blender/fonts/branding_static'/tray_branding['font_family']/tray_branding['font_file']),preview_brand_layout='logo_left',light_ink=False)
        printed_graphics.branding(sys.modules[__name__],details_rng,(-frame['width_m']*.24,0,frame['width_m']*.35,frame['depth_m']*.35),frame['surface_z_local_m']+.000015,ink,bc,split)
        transform=Matrix(frame['matrix_world'])
        for graphic in set(bpy.data.objects)-before:graphic.matrix_world=transform@graphic.matrix_world
    height=rng.uniform(*c['camera_height_mm'])/1000+(wallheight if v46 else 0)
    frame_x0,frame_x1=-width/2,width/2+cover.get('displacement_mm',0)/1000;frame_y0,frame_y1=-depth/2,depth/2
    for panel in cover.get('label_surfaces',[]):
        lo,hi=panel['bounds_m'];frame_x0=min(frame_x0,lo[0]);frame_x1=max(frame_x1,hi[0]);frame_y0=min(frame_y0,lo[1]);frame_y1=max(frame_y1,hi[1])
    if c.get('spill_fraction',0):
        for region in slots[compartments:]:
            frame_x0=min(frame_x0,region['x_min_m']);frame_x1=max(frame_x1,region['x_max_m']);frame_y0=min(frame_y0,region['y_min_m']);frame_y1=max(frame_y1,region['y_max_m'])
    center=((frame_x0+frame_x1)/2,(frame_y0+frame_y1)/2)
    cx=center[0]+rng.uniform(-.02,.02);cy=center[1]+rng.uniform(-.018,.018)
    if v46 and rng.random()<.18:cx+=rng.choice([-1,1])*height*rng.uniform(.10,.28)
    bpy.ops.object.camera_add(location=(cx,cy,height));cam=bpy.context.object;s.camera=cam
    cam.rotation_euler=(math.atan2(-(cam.location.y-center[1]),height),math.atan2(cam.location.x-center[0],height),rng.uniform(-.23,.23) if v46 else rng.uniform(-.075,.075))
    fit_width=max(frame_x1-frame_x0,(frame_y1-frame_y0)/c.get('aspect_height',.5));sensor=rng.choice([6.4,7.6,13.2]) if v46 else 36
    cam.data.sensor_width=sensor;cam.data.lens=sensor*(height-wallheight)/(fit_width*rng.uniform(1.12,1.32));cam.data.clip_start=.001;cam.data.clip_end=10
    if v46:
        bpy.context.view_layer.update()
        bounds=[([frame_x0,frame_y0,0],[frame_x1,frame_y1,wallheight])]+[panel['bounds_m'] for panel in cover.get('label_surfaces',[])]
        points=[world_to_camera_view(s,cam,Vector((x,y,z))) for lo,hi in bounds for x in [lo[0],hi[0]] for y in [lo[1],hi[1]] for z in [lo[2],hi[2]]]
        extent=max(max(abs(p.x-.5),abs(p.y-.5)) for p in points)
        if extent>.455:cam.data.lens*=.455/extent
        bpy.context.view_layer.update()
    edge_record=edge_scenarios_v46.frame_camera(s,cam,c,bounds) if c.get('edge_suite') else None
    cam.data.dof.use_dof=True;cam.data.dof.focus_distance=height-.003;cam.data.dof.aperture_fstop=rng.uniform(3.2,6.3) if v46 else rng.uniform(8,16)
    lighting=rng.choices(['chamber','window_daylight','overcast','sunlight','indoor','mixed_light'],[48,18,10,6,12,6])[0] if v46 else rng.choice(['chamber','chamber','window_daylight','sunlight','indoor'])
    if c.get('preview_lighting'):lighting=c['preview_lighting']
    (lighting_v46.illuminate if v46 else illuminate)(s,lighting,width,max(depth,frame_y1-frame_y0),rng,cube,hood)
    beauty=s.view_layers[0];beauty.name='Beauty';beauty.use_pass_object_index=True
    labels=s.view_layers.new('Labels');labels.use_pass_object_index=True;labels.use_pass_z=True;labels.samples=1;labels.layer_collection.children['Transparent film'].exclude=True;labels.material_override=material('opaque labels',(.5,.5,.5),noise=0)
    # Disable depth of field in the label layer is not supported per layer: labels are hard geometric samples at the same camera.
    s.view_settings.view_transform='AgX'
    bpy.context.view_layer.update()
    for sp in slots:
        corners=[(sp['x_min_m'],sp['y_min_m']), (sp['x_max_m'],sp['y_min_m']),(sp['x_max_m'],sp['y_max_m']),(sp['x_min_m'],sp['y_max_m'])]
        sp['polygon_normalized']=[[(p:=world_to_camera_view(s,cam,Vector((x,y,0)))).x,1-p.y] for x,y in corners]
    for obj in objects:
        if 'position_m' in obj:
            px,py,pz=obj['position_m'];u=world_to_camera_view(s,cam,Vector((px,py,pz)));v=world_to_camera_view(s,cam,Vector((px+.001,py,pz)));q=world_to_camera_view(s,cam,Vector((px,py+.001,pz)))
            area=abs((v.x-u.x)*(q.y-u.y)-(v.y-u.y)*(q.x-u.x))*s.render.resolution_x*s.render.resolution_y
            obj['local_mm_per_pixel']=1/max(math.sqrt(area),.001);obj['local_scale_method']='area-equivalent XY Jacobian at object centre; scalar perspective approximation'
    printed_targets=printed_graphics.register(lookup)
    for graphic in printed_targets:
        lo,hi=graphic['world_bounds_m'];zprint=hi[2]
        graphic['polygon_normalized']=[[(p:=world_to_camera_view(s,cam,Vector((x,y,zprint)))).x,1-p.y] for x,y in [(lo[0],lo[1]),(hi[0],lo[1]),(hi[0],hi[1]),(lo[0],hi[1])]]
    path=out/split/f'{index:05d}';path.parent.mkdir(parents=True,exist_ok=True)
    meta={'schema_version':2,'renderer':'cycles_physical_v4_6' if v46 else 'cycles_physical_v4_5','seed':seed,'split':split,'index':index,'width_mm':width*1000,'depth_mm':depth*1000,'camera_height_mm':height*1000,'camera_clearance_above_rim_mm':(height-wallheight)*1000,'focal_length_mm':cam.data.lens,'compartments':compartments,'slots':slots,'container_material':container,'background_material':surface_kind,'lighting':lighting,'chamber_light_geometry':s.get('chamber_light_geometry'),'camera_position_m':list(cam.location),'camera_rotation_rad':list(cam.rotation_euler),'aperture_fstop':cam.data.dof.aperture_fstop,'objects':objects,'instance_to_class':lookup,'transparent_film':film,'wear_cohort':wear_cohort,'powder_clouds':powder_clouds,'tray_branding':tray_branding,'printed_graphics':printed_targets,'patient_stickers':stickers,'container_geometry':tray_params,'cover':cover,'debris_contract':'class 14 includes powder groups, angular crumbs and larger loose chunks; excluded from pill counts; source association is a procedural prior, not mass conservation','labels_contract':'geometric camera-visible surfaces with transparent film removed; not amodal; refraction and defocus may shift RGB edges','synthetic':True,'drug_identity_verified':False,'config':c}
    if v46:meta.update(material_parameters=material_evidence,lighting_parameters=json.loads(s.get('lighting_manifest_json','{}')),product_pool=[{k:v for k,v in p.items() if k!='appearance'} for p in products],placement_rejections=placement_rejections,sensor_width_mm=cam.data.sensor_width,labels_focus='separate pinhole label render; no optical blur')
    if edge_record:meta.update(edge_case=edge_record,camera_shift_xy=[cam.data.shift_x,cam.data.shift_y],requested_pill_count=count)
    path.with_suffix('.json').write_text(json.dumps(meta,indent=2));s.render.filepath=str(path.with_suffix('.exr'))
    if split=='preview':bpy.ops.wm.save_as_mainfile(filepath=str(out/f'preview_{index:02d}.blend'))
    if v46:
        labels.use=False;beauty.use=True;s.render.filepath=str(path.with_suffix('.beauty.exr'));bpy.ops.render.render(write_still=True)
        beauty.use=False;labels.use=True;cam.data.dof.use_dof=False;s.cycles.use_denoising=False;s.render.filepath=str(path.with_suffix('.exr'));bpy.ops.render.render(write_still=True)
    else:bpy.ops.render.render(write_still=True)
    print('SCENE_DONE '+json.dumps({'split':split,'index':index,'seed':seed}),flush=True)


def main():
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [];p=argparse.ArgumentParser();p.add_argument('--config',default=str(ROOT/'configs/poc.json'));p.add_argument('--out',default=str(ROOT/'artifacts/dataset'));p.add_argument('--split',default='preview');p.add_argument('--start',type=int,default=0);p.add_argument('--count',type=int,default=1);p.add_argument('--resolution',type=int);p.add_argument('--samples',type=int);p.add_argument('--device');p.add_argument('--film',choices=['yes','no']);p.add_argument('--lighting');p.add_argument('--surface');p.add_argument('--container');p.add_argument('--appearance-mix',type=float);a=p.parse_args(argv);c=json.loads(Path(a.config).read_text())
    for key in ['resolution','samples','device']:
        if getattr(a,key) is not None:c[key]=getattr(a,key)
    if a.appearance_mix is not None:
        if not 0<=a.appearance_mix<=1:p.error('--appearance-mix must be between 0 and 1')
        c['appearance_preset_probability']=a.appearance_mix
    if a.film:c['preview_film']=a.film=='yes'
    if a.lighting:c['preview_lighting']=a.lighting
    if a.surface:c['preview_surface']=a.surface
    if a.container:c['preview_container']=a.container
    start=time.time()
    for i in range(a.start,a.start+a.count):generate_scene(c,a.split,i,Path(a.out).resolve())
    print('BATCH_DONE '+json.dumps({'scenes':a.count,'seconds':time.time()-start}),flush=True)
if __name__=='__main__':main()
