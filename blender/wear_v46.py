"""Physically scaled procedural abrasion. Ranges are priors, not measured BRDF fits."""
import math
import bpy


def add_wear(material,rng,kind='plastic',strength=None):
    if strength is None:strength=rng.choices([rng.uniform(0,.12),rng.uniform(.15,.5),rng.uniform(.5,.85)],[30,55,15])[0]
    n=material.node_tree.nodes;l=material.node_tree.links;p=n.get('Principled BSDF');tc=n.new('ShaderNodeTexCoord')
    def op(operation,a,b):
        q=n.new('ShaderNodeMath');q.operation=operation
        for i,v in enumerate([a,b]):
            if isinstance(v,(int,float)):q.inputs[i].default_value=v
            else:l.new(v,q.inputs[i])
        return q.outputs[0]
    def noise(vec,scale,detail=2):
        q=n.new('ShaderNodeTexNoise');q.noise_dimensions='4D';q.inputs['Scale'].default_value=scale;q.inputs['Detail'].default_value=detail;q.inputs['W'].default_value=rng.uniform(0,1000);l.new(vec,q.inputs['Vector']);return q.outputs['Fac']
    fields=[];angles=[]
    for _ in range(3):
        angle=rng.uniform(-math.pi,math.pi);angles.append(math.degrees(angle))
        mapping=n.new('ShaderNodeMapping');mapping.inputs['Rotation'].default_value[2]=angle;mapping.inputs['Scale'].default_value=(rng.uniform(35,110),rng.uniform(13000,42000),22000);l.new(tc.outputs['Object'],mapping.inputs['Vector'])
        narrow=noise(mapping.outputs['Vector'],1,2)
        scar=op('MINIMUM',op('MAXIMUM',op('MULTIPLY',op('SUBTRACT',narrow,.67),17),0),1)
        patch=noise(tc.outputs['Object'],rng.uniform(100,220),2)
        envelope=op('MINIMUM',op('MAXIMUM',op('MULTIPLY',op('SUBTRACT',patch,.52),8),0),1)
        fields.append(op('MULTIPLY',scar,envelope))
    field=op('MAXIMUM',fields[0],op('MAXIMUM',fields[1],fields[2]));field=op('MULTIPLY',field,strength)
    old_rough=p.inputs['Roughness'].links[0].from_socket if p.inputs['Roughness'].is_linked else p.inputs['Roughness'].default_value
    rough=op('MINIMUM',op('ADD',old_rough,op('MULTIPLY',field,.36 if kind!='metal' else .25)),.98);l.new(rough,p.inputs['Roughness'])
    bump=n.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.000010 if kind=='metal' else .000006;bump.inputs['Strength'].default_value=.38;bump.invert=True
    l.new(field,bump.inputs['Height'])
    if p.inputs['Normal'].is_linked:l.new(p.inputs['Normal'].links[0].from_socket,bump.inputs['Normal'])
    l.new(bump.outputs['Normal'],p.inputs['Normal'])
    material['abrasion_revision']='localized_multidirectional_v46'
    return {'revision':'localized_multidirectional_v46','strength':strength,'directions_deg':angles,'height_scale_um':10 if kind=='metal' else 6,'effect':'localized finite anisotropic noise streaks in roughness and normal; no painted dirt','calibrated':False}


def plastic_material(G,rng,container,base):
    clear=container in ['clear_plastic','tinted_clear'];milky=container=='milky_polypropylene'
    rough=rng.uniform(.025,.08) if clear else rng.uniform(.16,.32) if milky else rng.uniform(.28,.47)
    mat=G.material(container,base,rough,transmission=1 if clear else .55 if milky else 0,noise=.025 if clear else .09)
    p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['IOR'].default_value=1.49 if milky else 1.57 if clear else 1.48
    p.inputs['Coat Weight'].default_value=0 if clear else rng.uniform(.03,.10);p.inputs['Coat Roughness'].default_value=.27
    if milky:
        p.inputs['Subsurface Weight'].default_value=.08;p.inputs['Subsurface Scale'].default_value=.0003
    if clear:
        p.inputs['Base Color'].default_value=(.98,.99,1,1)
        v=mat.node_tree.nodes.new('ShaderNodeVolumeAbsorption');v.inputs['Color'].default_value=(*base,1);v.inputs['Density'].default_value=rng.uniform(1,8) if container=='clear_plastic' else rng.uniform(20,60)
        mat.node_tree.links.new(v.outputs[0],mat.node_tree.nodes.get('Material Output').inputs['Volume'])
    evidence=add_wear(mat,rng,'plastic')
    evidence.update(material=container,base_roughness=rough,transmission=p.inputs['Transmission Weight'].default_value,ior=p.inputs['IOR'].default_value)
    return mat,evidence
