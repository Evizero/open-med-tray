"""Install the packaged add-on or run this script in Blender's Text Editor."""
bl_info={'name':'Open Med Tray','author':'Open Med Tray contributors','description':'Procedural tablets, capsules and softgels for synthetic medication-tray scenes. Research use; no drug identity','version':(0,4,6),'blender':(5,2,0),'location':'View3D > Sidebar > Open Med Tray','category':'Add Mesh'}
import importlib.util
from pathlib import Path
import sys
import random
import json
import bpy
from bpy.props import BoolProperty,FloatProperty,IntProperty,EnumProperty,FloatVectorProperty,PointerProperty,StringProperty

folder=Path(__file__).resolve().parent
sys.path.insert(0,str(folder))
spec=importlib.util.spec_from_file_location('medtray_generator',folder/'generate.py');gen=importlib.util.module_from_spec(spec);spec.loader.exec_module(gen)
from pill_surface import PRESETS
from pill_appearance_v46 import SOFTGEL_PROFILES,softgel
from imprint_geometry import imprint as stamp_imprint, LAYOUTS, FONTS
from appearance_presets import load_presets
ATLAS_ROWS=load_presets()
ATLAS_ITEMS=[(r['id'],r['id']+' / '+r['reference_name'],'Unverified appearance prior; dimensions may be assumed') for r in ATLAS_ROWS]

class MEDTRAY_Properties(bpy.types.PropertyGroup):
    appearance_preset:EnumProperty(name='Appearance reference',items=ATLAS_ITEMS)
    speckles:FloatProperty(name='Formulation speckles',default=0,min=0,max=1)
    family:EnumProperty(name='Shape',items=[(f,f.replace('_',' ').title(),'') for f in gen.FAMILIES])
    outline_variant:EnumProperty(name='Outline variant',items=[('family','Family default',''),('heart','Heart','')])
    score_layout:EnumProperty(name='Score arrangement',items=[('auto','Automatic',''),('single','Single',''),('cross','Cross',''),('parallel','Parallel thirds','')])
    score_faces:EnumProperty(name='Scored faces',items=[('top','Top',''),('both','Both','')])
    finish:EnumProperty(name='Finish',items=[(f,f.replace('_',' ').title(),'') for f in PRESETS])
    length:FloatProperty(name='Length (mm)',default=12,min=3,max=28)
    width:FloatProperty(name='Width (mm)',default=7,min=2,max=20)
    height:FloatProperty(name='Thickness (mm)',default=3,min=.8,max=12)
    face_rim_width:FloatProperty(name='Flat face rim (mm)',default=0,min=0,max=1.2)
    crown_height:FloatProperty(name='Crown height (mm, 0 = auto)',default=0,min=0,max=1.5)
    crown_edge_blend:FloatProperty(name='Crown shoulder rounding (mm)',default=.06,min=0,max=.7)
    crown_curve:FloatProperty(name='Crown curve',default=1.6,min=1,max=4)
    roughness:FloatProperty(name='Surface roughness',default=.86,min=.05,max=1)
    porosity:FloatProperty(name='Relief multiplier',default=1.,min=0,max=3)
    grain_scale:FloatProperty(name='Grain spacing multiplier',default=1.,min=.3,max=3)
    pores:FloatProperty(name='Pore density',default=.08,min=0,max=1)
    wear:FloatProperty(name='Surface wear',default=0.,min=0,max=1)
    powder:FloatProperty(name='Powder patches',default=1.,min=0,max=1.5)
    scuffs:FloatProperty(name='Capsule scuffs',default=1.,min=0,max=2)
    absorption:FloatProperty(name='Tint density control (150 = reference)',default=150.,min=0,max=1500)
    softgel_profile:EnumProperty(name='Softgel material preset',items=[(v[0],v[0].replace('_',' ').title()+' / '+v[1],'Description-informed color and optical prior') for v in SOFTGEL_PROFILES])
    softgel_shape:EnumProperty(name='Softgel form',items=[(v,v.title(),'') for v in ['round','oval','oblong']],default='oval')
    softgel_straight:FloatProperty(name='Oblong straight-side fraction',default=.45,min=0,max=.6)
    softgel_transmission:FloatProperty(name='Transmission (0 = opaque)',default=1,min=0,max=1)
    softgel_scatter:FloatProperty(name='Suspension scattering (1/m)',default=0,min=0,max=300)
    softgel_seam_width:FloatProperty(name='Shell seam width (mm)',default=.09,min=.025,max=.25)
    softgel_seam_relief:FloatProperty(name='Shell seam relief (mm)',default=.012,min=0,max=.04)
    softgel_asymmetry:FloatProperty(name='Minor forming asymmetry',default=.004,min=0,max=.02)
    softgel_two_tone:BoolProperty(name='Two shell colors',default=False)
    press_defects:FloatProperty(name='Granule loss strength',default=1.,min=0,max=2)
    breakout_density:FloatProperty(name='Granule losses / mm²',default=.035,min=0,max=.25)
    breakout_size:FloatProperty(name='Granule loss radius (mm)',default=.18,min=.06,max=.4)
    edge_wear:FloatProperty(name='Uneven bevel wear',default=.25,min=0,max=1)
    broken:BoolProperty(name='Split tablet',default=False)
    fracture_offset:FloatProperty(name='Split offset (mm)',default=0,min=-3,max=3)
    fracture_tilt:FloatProperty(name='Fracture tilt from vertical (degrees)',default=0,min=-55,max=55)
    fracture_wave:FloatProperty(name='Fracture waves (mm)',default=.34,min=.02,max=.8)
    fracture_lip:FloatProperty(name='Protruding fragment (mm)',default=.65,min=0,max=1.5)
    chip:FloatProperty(name='Chipped edge',default=.0,min=0,max=.55)
    score:IntProperty(name='Score lines',default=1,min=0,max=2)
    score_width:FloatProperty(name='Score width (mm)',default=.32,min=.12,max=1.)
    score_depth:FloatProperty(name='Score depth (mm)',default=.14,min=.04,max=.4)
    imprint:StringProperty(name='Synthetic marking',default='A1',maxlen=24)
    imprint_layout:EnumProperty(name='Imprint layout',items=[(v,v.replace('_',' ').title(),'') for v in LAYOUTS])
    imprint_font:EnumProperty(name='Imprint typeface',items=[(v,v.title(),'') for v in FONTS])
    imprint_symbol:EnumProperty(name='Imprint emblem',items=[(v,v.title(),'') for v in ['diamond','triangle','shield','circle','square']])
    imprint_style:EnumProperty(name='Imprint relief',items=[('debossed','Recessed',''),('embossed','Raised','')])
    imprint_span:FloatProperty(name='Imprint span (mm, 0 = auto)',default=0,min=0,max=20)
    imprint_depth:FloatProperty(name='Imprint depth (mm)',default=.12,min=.02,max=.35)
    imprint_wear:FloatProperty(name='Imprint edge irregularity',default=.12,min=0,max=1)
    imprint_rotation:FloatProperty(name='Imprint rotation (degrees)',default=0,min=-180,max=180)
    imprint_paths:StringProperty(name='Custom stamp paths (JSON)',default='[{"points":[[-0.4,-0.3],[0,0.4],[0.4,-0.3]],"closed":true}]')
    seed:IntProperty(name='Seed',default=42,min=0)
    color:FloatVectorProperty(name='Body color',subtype='COLOR',size=3,min=0,max=1,default=(.85,.83,.73))
    cap_color:FloatVectorProperty(name='Cap color',subtype='COLOR',size=3,min=0,max=1,default=(.2,.35,.65))

class MEDTRAY_Build(bpy.types.Operator):
    bl_idname='medtray.build';bl_label='Build / refresh procedural pill';bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        p=context.scene.medtray
        if p.crown_height>=p.height*.4 or p.face_rim_width>=min(p.length,p.width)*.3:
            self.report({'ERROR'},'Reduce crown height below 40% of thickness and rim width below 30% of the short outline dimension');return {'CANCELLED'}
        if p.imprint_layout=='cross' and (len(p.imprint)%2!=1 or not 3<=len(p.imprint)<=9):
            self.report({'ERROR'},'Cross layout needs an odd-length word, 3 to 9 characters');return {'CANCELLED'}
        try:paths=json.loads(p.imprint_paths) if p.imprint_layout=='custom' else None
        except ValueError:
            self.report({'ERROR'},'Custom stamp paths must be valid JSON');return {'CANCELLED'}
        for obj in list(bpy.data.objects):
            if obj.get('medtray_preview'):bpy.data.objects.remove(obj,do_unlink=True)
        p=context.scene.medtray;rng=random.Random(p.seed)
        finish={'hard_capsule':'gelatin_shell','softgel':'softgel_shell'}.get(p.family,p.finish)
        kw=dict(softgel_transmission=p.softgel_transmission,softgel_scatter=p.softgel_scatter,roughness=p.roughness,texture=p.porosity,grain_um=PRESETS[finish]['grain_um']*p.grain_scale,pore_density=p.pores,wear=p.wear,powder=p.powder,scuffs=p.scuffs,transmission_density=p.absorption,speckles=p.speckles)
        m=gen.pill_material('interactive pill',p.color,finish,seed=p.seed,**kw)
        m2=gen.pill_material('interactive cap',p.cap_color if p.family=='hard_capsule' or p.softgel_two_tone else p.color,finish,seed=p.seed+1,**kw)
        shell_options=dict(softgel_shape=p.softgel_shape,softgel_straight_fraction=p.softgel_straight,softgel_seam_width_mm=p.softgel_seam_width,softgel_seam_relief_mm=p.softgel_seam_relief,softgel_asymmetry=p.softgel_asymmetry) if p.family=='softgel' else {}
        o=gen.make_pill(p.family,p.length/1000,p.width/1000,p.height/1000,m,m2,10,rng,p.chip,p.score,**shell_options,score_width_mm=p.score_width,score_depth_mm=p.score_depth,press_defects=p.press_defects,breakout_density=p.breakout_density,breakout_size_mm=p.breakout_size,edge_wear=p.edge_wear,outline_variant=p.outline_variant,score_layout=p.score_layout,score_faces=p.score_faces,face_rim_width_mm=p.face_rim_width,crown_height_mm=p.crown_height or None,crown_curve=p.crown_curve,crown_edge_blend_mm=p.crown_edge_blend)
        o['medtray_preview']=True;o['dimensions_mm']=[p.length,p.width,p.height];o.location.z=p.height/2000
        if p.broken and p.family not in ['softgel','hard_capsule','ring_tablet']:
            core=gen.pill_material('fracture core',(.83,.81,.74),'chalky_uncoated',seed=p.seed+2,grain_um=180,relief_um=75)
            gen.fracture_tablet(o,core,seed=p.seed,offset_mm=p.fracture_offset,waviness_mm=p.fracture_wave,lip_mm=p.fracture_lip,tilt_deg=p.fracture_tilt)
        if (p.imprint or p.imprint_layout=='custom') and not p.broken and p.family not in ['ring_tablet','unknown_shape']:
            if p.family in ['hard_capsule','softgel']:
                ink=gen.material('printed capsule ink',(.92,.92,.88) if sum(p.color)/3<.35 else (.025,.03,.035),.55,noise=0)
                bpy.context.view_layer.update();before=set(bpy.data.objects)
                ok=gen.placement_v46.capsule_print(gen,o,p.imprint,min(p.length,p.width)/1000*.20,ink,10)
                for mark in set(bpy.data.objects)-before:mark['medtray_preview']=True
                if not ok:self.report({'WARNING'},'Print did not fit the curved shell; reduce the marking length.')
            else:
                span=p.imprint_span or (min(p.length*.29,p.width*.56) if p.score else min(p.length,p.width)*.68)
                xy=(p.length*.22,0) if p.score and not p.imprint_span else (0,0)
                success=stamp_imprint(o,p.imprint,layout=p.imprint_layout,span_mm=span,depth_mm=p.imprint_depth,xy_mm=xy,font=p.imprint_font,symbol=p.imprint_symbol,style=p.imprint_style,wear=p.imprint_wear,rotation_deg=p.imprint_rotation,paths=paths)
                if not success:self.report({'WARNING'},'Stamp could not fit cleanly; original pill preserved. Reduce span or change layout.')
        bpy.ops.object.select_all(action='DESELECT');o.select_set(True);context.view_layer.objects.active=o
        if context.screen:
            for area in context.screen.areas:
                if area.type=='VIEW_3D':
                    area.spaces.active.region_3d.view_distance=.05;area.spaces.active.region_3d.view_location=o.location
                    area.spaces.active.shading.type='MATERIAL'
        return {'FINISHED'}

class MEDTRAY_LoadAppearance(bpy.types.Operator):
    bl_idname='medtray.load_appearance';bl_label='Load reference parameters';bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        p=context.scene.medtray;r=next(r for r in ATLAS_ROWS if r['id']==p.appearance_preset);q=r['parameters']
        for key in ['family','outline_variant','finish','score','score_layout','score_faces','press_defects','seed']:setattr(p,key,q[key])
        p.length=q['length_mm'];p.width=q['width_mm'];p.height=q['height_mm'];p.color=q['color'];p.cap_color=q['secondary_color'];p.imprint=q['synthetic_marking'];p.roughness=PRESETS[q['finish']]['roughness'];p.grain_scale=q['grain_multiplier'];p.speckles=q.get('speckles',0)
        p.imprint_layout='text';p.imprint_font='sans';p.imprint_span=0;p.imprint_depth=.12;p.imprint_wear=.12;p.imprint_rotation=0;p.imprint_style='debossed';p.breakout_density=.035;p.breakout_size=.18
        p.face_rim_width=0;p.crown_height=0;p.crown_curve=1.6;p.crown_edge_blend=.06;p.broken=False;p.chip=0;p.wear=0;p.porosity=1.;p.pores=PRESETS[q['finish']]['pores'];p.absorption=350.
        return bpy.ops.medtray.build()

class MEDTRAY_LoadSoftgel(bpy.types.Operator):
    bl_idname='medtray.load_softgel';bl_label='Load softgel profile';bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        p=context.scene.medtray;q=softgel(random.Random(p.seed),force_shape=p.softgel_shape,force_profile=p.softgel_profile,two_tone=p.softgel_two_tone)
        p.family='softgel';p.finish='softgel_shell';p.length=q['length']*1000;p.width=q['width']*1000;p.height=q['height']*1000;p.color=q['color'];p.cap_color=q['secondary_color'];p.roughness=q['softgel_roughness'];p.absorption=q['softgel_density'];p.softgel_transmission=q['softgel_transmission'];p.softgel_scatter=q['softgel_scatter'];p.softgel_straight=q['softgel_straight_fraction'];p.softgel_seam_width=q['softgel_seam_width_mm'];p.softgel_seam_relief=q['softgel_seam_relief_mm'];p.softgel_asymmetry=q['softgel_asymmetry']
        p.score=0;p.chip=0;p.broken=False;p.pores=0;p.porosity=1;p.wear=0;p.face_rim_width=0;p.crown_height=0;p.speckles=0;p.imprint_layout='text';p.imprint='P12';p.grain_scale=1
        return bpy.ops.medtray.build()

class MEDTRAY_Panel(bpy.types.Panel):
    bl_label='Procedural pills';bl_idname='MEDTRAY_PT_panel';bl_space_type='VIEW_3D';bl_region_type='UI';bl_category='Open Med Tray'
    def draw(self,context):
        layout=self.layout;p=context.scene.medtray
        layout.prop(p,'appearance_preset');layout.operator('medtray.load_appearance')
        shell=layout.box();shell.label(text='Oral softgel controls')
        for name in ['softgel_shape','softgel_profile','softgel_two_tone']:shell.prop(p,name)
        shell.operator('medtray.load_softgel')
        if p.family=='softgel':
            for name in ['softgel_straight','softgel_transmission','softgel_scatter','softgel_seam_width','softgel_seam_relief','softgel_asymmetry']:shell.prop(p,name)
        for name in ['family','outline_variant','finish','length','width','height','face_rim_width','crown_height','crown_curve','crown_edge_blend','roughness','porosity','grain_scale','pores','speckles','wear','powder','scuffs','absorption','press_defects','breakout_density','breakout_size','edge_wear','chip','broken','fracture_offset','fracture_tilt','fracture_wave','fracture_lip','score','score_layout','score_faces','score_width','score_depth','color','cap_color','imprint','imprint_layout','imprint_font','imprint_symbol','imprint_style','imprint_span','imprint_depth','imprint_wear','imprint_rotation','seed']:layout.prop(p,name)
        if p.imprint_layout=='custom':layout.prop(p,'imprint_paths')
        layout.operator('medtray.build');layout.label(text='Research appearance asset; no drug identity',icon='INFO')

classes=[MEDTRAY_Properties,MEDTRAY_Build,MEDTRAY_LoadAppearance,MEDTRAY_LoadSoftgel,MEDTRAY_Panel]
def register():
    for cls in classes:bpy.utils.register_class(cls)
    bpy.types.Scene.medtray=PointerProperty(type=MEDTRAY_Properties)
def unregister():
    del bpy.types.Scene.medtray
    for cls in reversed(classes):bpy.utils.unregister_class(cls)
if __name__=='__main__':register()
