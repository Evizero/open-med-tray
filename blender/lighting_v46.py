"""Controlled capture rigs and quiet worktop illumination. Unmeasured lighting priors."""
import math
import bpy
from environment import light_area


def illuminate(scene,kind,width,depth,rng,make_cube,mat):
    bg=scene.world.node_tree.nodes['Background'];bg.inputs[1].default_value=.12
    records=[]
    def area(name,loc,target,energy,w,h,color):
        light_area(name,loc,target,energy,w,h,color);records.append(dict(name=name,position_m=loc,target_m=target,power_w=energy,size_m=[w,h],color=color))
    if kind.startswith('chamber'):
        span=max(.30,width*1.45,depth*2.4);top=.205
        white=bpy.data.materials.new('diffuse chamber interior');white.use_nodes=True;p=white.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.65,.66,.64,1);p.inputs['Roughness'].default_value=.87
        for x in [-span/2,span/2]:make_cube('chamber side',(x,0,top/2),(.003,span,top),white)
        make_cube('chamber rear',(0,span/2,top/2),(span,.003,top),white)
        for x in [-span*.36,span*.36]:make_cube('chamber roof around camera',(x,0,top),(span*.28,span,.003),white)
        make_cube('insertion opening upper baffle',(0,-span/2,.145),(span,.003,.12),mat)
        bg.inputs[1].default_value=.025
        rig=kind if kind!='chamber' else rng.choices(['chamber_diffuse','chamber_strips','chamber_slit','chamber_glare'],[55,23,15,7])[0]
        if rig=='chamber_diffuse':
            area('left diffuse panel',(-span*.44,0,.092),(0,0,.008),rng.uniform(.22,.4),.070,depth*1.7,(.96,.98,1))
            area('right diffuse panel',(span*.44,.025,.075),(0,0,.008),rng.uniform(.18,.36),.080,depth*1.8,(1,.96,.89))
            area('front diffuse fill',(0,-span*.43,.095),(0,0,0),.08,width*.8,.055,(.95,.98,1))
        else:
            glare=rig=='chamber_glare';x=width*(.45 if glare else .63);z=.095 if glare else .045
            area('left off-axis strip',(-x,0,z),(0,0,0),rng.uniform(.12,.25),.012,depth*1.3,(.96,.98,1))
            area('right off-axis strip',(x,0,z),(0,0,0),rng.uniform(.10,.23),.012,depth*1.3,(1,.95,.88))
            if rig=='chamber_slit':area('daylight entering insertion slit',(0,-span*.65,.035),(0,0,0),.24,width,.035,(.77,.88,1))
        scene['chamber_light_geometry']=rig
    elif kind in ['window_daylight','sunlight','overcast']:
        side=rng.choice([-1,1]);bg.inputs[1].default_value=rng.uniform(.12,.23)
        area('off-axis window',(side*.4,-.32,.38),(0,0,0),rng.uniform(2.3,4.2),.30,.48,(.91,.96,1))
        area('soft wall return',(-side*.32,.15,.22),(0,0,0),.40,.40,.30,(1,.96,.9))
        if kind=='overcast':area('broad overhead diffuse sky',(0,0,.7),(0,0,0),1.0,1.2,1.2,(.96,.98,1))
        if kind=='sunlight':
            bpy.ops.object.light_add(type='SUN');o=bpy.context.object;o.name='angled direct sun';o.rotation_euler=(rng.uniform(.55,.95),rng.uniform(-.8,.8),rng.uniform(0,math.tau));o.data.energy=rng.uniform(.35,.9);o.data.angle=rng.uniform(.01,.04);o.data.color=(1,.90,.75)
            records.append(dict(name='angled direct sun',strength=o.data.energy,angle_rad=o.data.angle))
    else:
        bg.inputs[1].default_value=.10
        area('soft ceiling panel',(rng.choice([-1,1])*.24,.13,.40),(0,0,0),rng.uniform(1.6,2.8),.20,.34,(1,.90,.78))
        area('diffuse room return',(-.25,-.18,.27),(0,0,0),rng.uniform(.4,.8),.35,.30,(.85,.92,1))
        if kind=='mixed_light':area('cool light at insertion side',(.02,-.4,.25),(0,0,0),1.3,.28,.35,(.73,.85,1))
    scene['lighting_manifest_json']=__import__('json').dumps({'revision':'capture_rigs_v46','rig':scene.get('chamber_light_geometry',kind),'sources':records,'polarization_simulated':False,'calibrated':False})


def surface(kind,rng):
    from environment import surface as old_surface
    from wear_v46 import add_wear
    if kind in ['quartz','concrete','slate']:
        m=old_surface('laminate',rng);n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF');p.inputs['Roughness'].default_value=rng.uniform(.60,.86)
        tc=n.new('ShaderNodeTexCoord');t=n.new('ShaderNodeTexNoise');t.inputs['Scale'].default_value=rng.uniform(1600,4200);t.inputs['Detail'].default_value=3;l.new(tc.outputs['Object'],t.inputs['Vector'])
        r=n.new('ShaderNodeValToRGB');base=(.73,.74,.70) if kind=='quartz' else (.38,.37,.34) if kind=='concrete' else (.10,.085,.066)
        r.color_ramp.elements[0].position=.23;r.color_ramp.elements[0].color=(*(v*.6 for v in base),1);r.color_ramp.elements[1].position=.66;r.color_ramp.elements[1].color=(*base,1);l.new(t.outputs['Fac'],r.inputs[0]);l.new(r.outputs[0],p.inputs['Base Color'])
    else:m=old_surface(kind,rng)
    if kind in ['brushed_steel','smudged_steel']:
        # Higher typical microsurface roughness avoids mirror-like black/white pools.
        p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Anisotropic'].default_value=rng.uniform(.35,.72)
        for node in m.node_tree.nodes:
            if node.bl_idname=='ShaderNodeMapRange':node.inputs['To Min'].default_value=.32;node.inputs['To Max'].default_value=.55 if kind=='smudged_steel' else .43
    add_wear(m,rng,'metal' if 'steel' in kind else 'plastic',rng.uniform(.08,.55))
    return m
