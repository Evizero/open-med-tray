"""Seeded oil/smudge roughness fields; no opaque dirt painted onto clear PET."""
import math
import bpy
import numpy as np


def smudges(material,rng,width,depth,probability=.8):
    if rng.random()>probability:return {'present':False,'fingerprints':[]}
    nx,ny=1024,512
    x,y=np.meshgrid(np.linspace(-width/2,width/2,nx),np.linspace(-depth/2,depth/2,ny))
    field=np.zeros_like(x);records=[]
    for _ in range(rng.randint(2,8)):
        cx=rng.uniform(-width*.44,width*.44);cy=rng.choice([-1,1])*rng.uniform(depth*.1,depth*.45)
        rx,ry=rng.uniform(.004,.009),rng.uniform(.006,.012);angle=rng.uniform(0,math.tau);co,si=math.cos(angle),math.sin(angle)
        dx=(x-cx)*co+(y-cy)*si;dy=-(x-cx)*si+(y-cy)*co
        envelope=np.exp(-((dx/rx)**2+(dy/ry)**2)*1.8)
        # Off-centre curved ridges, broken by smooth local contact variation.
        curved=np.sqrt((dx+.0015*np.sin(dy*180))**2+(.65*(dy+ry*1.5))**2)
        spacing=rng.uniform(.00034,.00055);ridge=(.5+.5*np.sin(curved*math.tau/spacing))**3
        contact=np.clip(.65+.25*np.sin(dx*740+dy*510)+.22*np.sin(dx*1700-dy*1280),0,1)
        strength=rng.uniform(.16,.55)
        field=np.maximum(field,envelope*(.35+.65*ridge)*contact*strength)
        records.append({'centre_m':[cx,cy],'radius_m':[rx,ry],'angle_rad':angle,'ridge_spacing_mm':spacing*1000,'strength':strength})
    # A dragged oily patch produces cloudy, directional streaks with soft boundaries.
    smear=rng.random()<.45
    if smear:
        cx=rng.uniform(-width*.3,width*.3);cy=rng.uniform(-depth*.2,depth*.2)
        cloud=np.exp(-((x-cx)/rng.uniform(.018,.035))**2-((y-cy)/.0045)**2)
        field=np.maximum(field,cloud*(.12+.05*np.sin(x*300+y*490)))
    image=bpy.data.images.new('procedural finger oils',width=nx,height=ny,alpha=True,float_buffer=False)
    rgba=np.empty((ny,nx,4),np.float32);rgba[...,:3]=field[...,None];rgba[...,3]=1;image.pixels.foreach_set(rgba.ravel());image.colorspace_settings.name='Non-Color';image.pack()
    nodes=material.node_tree.nodes;links=material.node_tree.links;p=nodes.get('Principled BSDF')
    tex=nodes.new('ShaderNodeTexImage');tex.image=image;tex.interpolation='Linear';coord=nodes.new('ShaderNodeTexCoord');links.new(coord.outputs['Generated'],tex.inputs['Vector'])
    scale=nodes.new('ShaderNodeMath');scale.operation='MULTIPLY';scale.inputs[1].default_value=.36;links.new(tex.outputs['Color'],scale.inputs[0])
    add=nodes.new('ShaderNodeMath');add.operation='ADD';add.inputs[1].default_value=p.inputs['Roughness'].default_value;links.new(scale.outputs[0],add.inputs[0]);links.new(add.outputs[0],p.inputs['Roughness'])
    bump=nodes.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.0000015;bump.inputs['Strength'].default_value=.22;links.new(tex.outputs['Color'],bump.inputs['Height']);links.new(bump.outputs[0],p.inputs['Normal'])
    return {'present':True,'fingerprints':records,'dragged_smear':smear,'fraction_field_above_005':float(np.mean(field>.05)),'physical_effect':'roughness and micron-scale surface normal variation; no opaque powder','texture_resolution':[nx,ny]}
