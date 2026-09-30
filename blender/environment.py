"""Procedural worktops and lighting; all textures are mathematical, no photographic assets."""
import math
import bpy
from mathutils import Vector


def surface(kind,rng):
    m=bpy.data.materials.new('worktop '+kind);m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF');tc=n.new('ShaderNodeTexCoord')
    def noise(scale,detail=3):
        t=n.new('ShaderNodeTexNoise');t.inputs['Scale'].default_value=scale;t.inputs['Detail'].default_value=detail;l.new(tc.outputs['Object'],t.inputs['Vector']);return t
    p.inputs['Roughness'].default_value=.4
    if kind=='wood':
        mapping=n.new('ShaderNodeVectorMath');mapping.operation='MULTIPLY';mapping.inputs[1].default_value=(8,180,30);l.new(tc.outputs['Object'],mapping.inputs[0])
        grain=n.new('ShaderNodeTexNoise');grain.inputs['Scale'].default_value=3;grain.inputs['Detail'].default_value=5;grain.inputs['Roughness'].default_value=.75;l.new(mapping.outputs[0],grain.inputs['Vector'])
        ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].position=.20;ramp.color_ramp.elements[0].color=(.075,.027,.008,1);ramp.color_ramp.elements[1].position=.8;ramp.color_ramp.elements[1].color=(.52,.28,.105,1);l.new(grain.outputs['Fac'],ramp.inputs[0]);l.new(ramp.outputs[0],p.inputs['Base Color'])
        bump=n.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.000018;bump.inputs['Strength'].default_value=.22;l.new(grain.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs[0],p.inputs['Normal']);p.inputs['Coat Weight'].default_value=.18;p.inputs['Coat Roughness'].default_value=.25
    elif kind in ['brushed_steel','smudged_steel']:
        p.inputs['Base Color'].default_value=(.55,.58,.6,1);p.inputs['Metallic'].default_value=.94;p.inputs['Anisotropic'].default_value=.55
        mapping=n.new('ShaderNodeVectorMath');mapping.operation='MULTIPLY';mapping.inputs[1].default_value=(8,2200,1);l.new(tc.outputs['Object'],mapping.inputs[0]);grain=n.new('ShaderNodeTexNoise');grain.inputs['Scale'].default_value=2;l.new(mapping.outputs[0],grain.inputs['Vector'])
        bump=n.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.000002;bump.inputs['Strength'].default_value=.14;l.new(grain.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs[0],p.inputs['Normal'])
        cloud=noise(rng.uniform(18,35),2);ramp=n.new('ShaderNodeMapRange');ramp.inputs['To Min'].default_value=.16;ramp.inputs['To Max'].default_value=.59 if kind=='smudged_steel' else .3;l.new(cloud.outputs['Fac'],ramp.inputs['Value']);l.new(ramp.outputs['Result'],p.inputs['Roughness'])
    else:
        p.inputs['Base Color'].default_value=(*rng.choice([(.72,.74,.72),(.23,.29,.3),(.49,.43,.35),(.83,.82,.76)]),1)
        tex=noise(2200,2);bump=n.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.000006;bump.inputs['Strength'].default_value=.18;l.new(tex.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs[0],p.inputs['Normal'])
    return m


def light_area(name,loc,target,energy,width,height,color):
    bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name;o.data.shape='RECTANGLE';o.data.size=width;o.data.size_y=height;o.data.energy=energy;o.data.color=color;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();return o


def illuminate(scene,kind,width,depth,rng,make_cube,mat):
    bg=scene.world.node_tree.nodes['Background']
    if kind=='chamber':
        bg.inputs[1].default_value=.025
        # Square enclosure has side and back walls, a ceiling around the camera aperture,
        # and an open front insertion slot. LED strips sit behind diffusion covers.
        span=max(.24,width*1.24);top=.17
        for x in [-span/2,span/2]:make_cube('chamber side',(x,0,top/2),(.003,span,top),mat)
        make_cube('chamber rear',(0,span/2,top/2),(span,.003,top),mat)
        for x in [-span*.32,span*.32]:make_cube('chamber ceiling',(x,0,top),(span*.34,span,.003),mat)
        make_cube('chamber front over insertion slit',(0,-span/2,.112),(span,.003,.116),mat)
        controlled=rng.random()<.8
        led_x=width*(.60 if controlled else .46);led_z=.032 if controlled else .095
        scene['chamber_light_geometry']='low_off_axis' if controlled else 'high_glare_challenge'
        light_area('left diffused LED',(-led_x,0,led_z),(0,0,0),rng.uniform(.15,.24),.016,depth*1.25,(.98,.98,1))
        light_area('right diffused LED',(led_x,0,led_z),(0,0,0),rng.uniform(.15,.24),.016,depth*1.25,(1,.97,.92))
        light_area('front fill slit',(0,-.115,.028),(0,0,0),.016,width,.008,(.88,.93,1))
    elif kind in ['window_daylight','sunlight']:
        bg.inputs[1].default_value=rng.uniform(.18,.32)
        light_area('large window',(rng.uniform(-.3,.3),-.3,.35),(0,0,0),rng.uniform(2,4),.45,.65,(.93,.97,1))
        if kind=='sunlight':
            bpy.ops.object.light_add(type='SUN');o=bpy.context.object;o.rotation_euler=(rng.uniform(.2,.7),rng.uniform(-.7,.7),rng.uniform(0,6));o.data.energy=rng.uniform(.7,1.4);o.data.angle=rng.uniform(.008,.025);o.data.color=(1,.91,.75)
    else:
        bg.inputs[1].default_value=.09
        light_area('ceiling fluorescent',(rng.uniform(-.1,.1),.02,.32),(0,0,0),rng.uniform(1.5,2.8),.5,.055,(1,.88,.72))
        light_area('room bounce',(.25,-.15,.2),(0,0,0),.5,.25,.3,(.79,.88,1))
