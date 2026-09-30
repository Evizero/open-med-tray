"""Finish-specific, physically scaled pill surfaces. Values are procedural priors, not measurements."""
import json
import bpy
from softgel_optics import absorption_parameters

PRESETS = {
    'chalky_uncoated': dict(roughness=.86, diffuse=.65, specular=.23, grain_um=110., relief_um=23., fine_um=24., fine_relief_um=2., pores=.08, pore_um=125., pore_depth_um=20., mottling=.065, sss=.025),
    'matte_film': dict(roughness=.66, diffuse=.30, specular=.34, grain_um=145., relief_um=12., fine_um=35., fine_relief_um=1.4, pores=.015, pore_um=85., pore_depth_um=4., mottling=.025, sss=.02),
    'satin_film': dict(roughness=.42, diffuse=.15, specular=.42, grain_um=165., relief_um=6.5, fine_um=30., fine_relief_um=.35, pores=.015, pore_um=90., pore_depth_um=2., mottling=.012, sss=.025),
    'gelatin_shell': dict(roughness=.23, diffuse=.07, specular=.48, grain_um=230., relief_um=.9, fine_um=38., fine_relief_um=.2, pores=0., pore_um=100., pore_depth_um=0., mottling=.009, sss=.045),
    'softgel_shell': dict(roughness=.09, diffuse=.03, specular=.50, grain_um=280., relief_um=.65, fine_um=35., fine_relief_um=.1, pores=0., pore_um=100., pore_depth_um=0., mottling=.005, sss=.02),
}


def pill_material(name, color, finish='chalky_uncoated', *, seed=0, roughness=None,
                  texture=1., grain_um=None, relief_um=None, pore_density=None, wear=0., powder=1., scuffs=1., transmission_density=350., absorption_color=None, speckles=0., softgel_transmission=1., softgel_scatter=0.):
    """Independent finish, grain spacing, microrelief, sparse pits, wear and random seed controls.

    Noise frequencies use metre-space Object coordinates. 'grain_um' is a procedural
    wavelength, not a claim about a measured particle-size distribution.
    """
    q = dict(PRESETS[finish]);q['body_color']=list(color)
    if roughness is not None:q['roughness']=roughness
    if grain_um is not None:q['grain_um']=max(10.,grain_um)
    if relief_um is not None:q['relief_um']=max(0.,relief_um)
    if pore_density is not None:q['pores']=max(0.,min(1.,pore_density))
    q['roughness']=min(.98,q['roughness']+.10*wear)
    q['relief_um']*=texture*(1+wear*1.5)
    q['fine_relief_um']*=texture
    q['pore_depth_um']*=texture*(1+wear)
    m=bpy.data.materials.new(name);m.use_nodes=True
    n=m.node_tree.nodes;lk=m.node_tree.links;p=n.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=q['roughness']
    p.inputs['Diffuse Roughness'].default_value=q['diffuse']
    p.inputs['Specular IOR Level'].default_value=q['specular']
    p.inputs['IOR'].default_value=1.47
    p.inputs['Subsurface Weight'].default_value=q['sss']
    p.inputs['Subsurface Radius'].default_value=(1.,.65,.4)
    p.inputs['Subsurface Scale'].default_value=.00008
    p.inputs['Transmission Weight'].default_value=1. if finish=='softgel_shell' else 0
    tc=n.new('ShaderNodeTexCoord');tc.label='Metres, applied object scale'
    def noise(label,wavelength,detail=2.):
        tx=n.new('ShaderNodeTexNoise');tx.label=label;tx.noise_dimensions='4D'
        tx.inputs['Scale'].default_value=1/(wavelength*1e-6)
        tx.inputs['Detail'].default_value=detail;tx.inputs['Roughness'].default_value=.68
        tx.inputs['W'].default_value=(seed%100000)*.137
        lk.new(tc.outputs['Object'],tx.inputs['Vector']);return tx.outputs['Fac']
    def mathop(op,a,b):
        node=n.new('ShaderNodeMath');node.operation=op
        for idx,val in enumerate([a,b]):
            if isinstance(val,(int,float)):node.inputs[idx].default_value=val
            else:lk.new(val,node.inputs[idx])
        return node.outputs[0]
    grain=noise('Compressed granule relief / film orange peel',q['grain_um'],2.)
    fine=noise('Fine compression grain',q['fine_um'],1.)
    # A continuous irregular field for grains, plus separate sparse indented pores.
    vt=n.new('ShaderNodeTexVoronoi');vt.distance='EUCLIDEAN';vt.feature='F1'
    vt.inputs['Scale'].default_value=1/(q['pore_um']*1e-6)
    lk.new(tc.outputs['Object'],vt.inputs['Vector'])
    # Gate whole cells by a random cell value: density really controls how
    # many pores exist, rather than stamping a hole into every Voronoi cell.
    cell=n.new('ShaderNodeSeparateColor');lk.new(vt.outputs['Color'],cell.inputs[0])
    gate=mathop('LESS_THAN',cell.outputs['Red'],q['pores'])
    warp=n.new('ShaderNodeTexNoise');warp.inputs['Scale'].default_value=1/(q['pore_um']*.38e-6);warp.inputs['Detail'].default_value=2.
    lk.new(tc.outputs['Object'],warp.inputs['Vector'])
    irregular=mathop('ADD',vt.outputs['Distance'],mathop('MULTIPLY',warp.outputs['Fac'],.22))
    inset=mathop('MAXIMUM',mathop('SUBTRACT',.25,irregular),0.)
    floor=mathop('MINIMUM',mathop('MULTIPLY',inset,32.),1.)
    pit=mathop('MULTIPLY',mathop('MULTIPLY',floor,gate),-q['pore_depth_um']*1e-6)
    relief=mathop('ADD',mathop('MULTIPLY',grain,q['relief_um']*1e-6),pit)
    relief=mathop('ADD',relief,mathop('MULTIPLY',fine,q['fine_relief_um']*1e-6))
    b=n.new('ShaderNodeBump');b.label='Metre-valued height; independent multi-scale relief'
    b.inputs['Strength'].default_value=1.;b.inputs['Distance'].default_value=1.
    lk.new(relief,b.inputs['Height']);lk.new(b.outputs['Normal'],p.inputs['Normal'])
    ramp=n.new('ShaderNodeMapRange');ramp.label='Microscale roughness heterogeneity'
    ramp.inputs['To Min'].default_value=max(.04,q['roughness']-.075)
    ramp.inputs['To Max'].default_value=min(1.,q['roughness']+.075)
    lk.new(grain,ramp.inputs['Value']);lk.new(ramp.outputs[0],p.inputs['Roughness'])
    color_noise=noise('Subtle formulation mottling',380.,2.)
    cr=n.new('ShaderNodeValToRGB');cr.label='Subtle color variation, no dark dirt dots'
    cr.color_ramp.elements[0].color=(*(v*(1-q['mottling']) for v in color),1)
    cr.color_ramp.elements[1].color=(*color,1)
    lk.new(color_noise,cr.inputs[0]);lk.new(cr.outputs[0],p.inputs['Base Color'])
    # Sparse millimetre-scale powder patches change reflection as well as color.
    if finish=='chalky_uncoated':
        patch=noise('Patchy powder residue (millimetre scale)',1350.,2.)
        mask=n.new('ShaderNodeMapRange');mask.clamp=True
        mask.inputs['From Min'].default_value=.48;mask.inputs['From Max'].default_value=.68
        lk.new(patch,mask.inputs['Value'])
        powder_mask=mathop('MULTIPLY',mask.outputs[0],powder)
        mix=n.new('ShaderNodeMixRGB');mix.blend_type='MIX'
        lk.new(powder_mask,mix.inputs[0]);lk.new(cr.outputs[0],mix.inputs[1])
        mix.inputs[2].default_value=(*(min(.98,v*1.08) for v in color),1)
        lk.new(mix.outputs[0],p.inputs['Base Color'])
        sr=n.new('ShaderNodeMapRange');sr.inputs['To Min'].default_value=q['specular'];sr.inputs['To Max'].default_value=.09
        lk.new(powder_mask,sr.inputs['Value']);lk.new(sr.outputs[0],p.inputs['Specular IOR Level'])
        rr=mathop('ADD',ramp.outputs[0],mathop('MULTIPLY',powder_mask,.08))
        lk.new(rr,p.inputs['Roughness'])
    if speckles:
        # Sparse formulation inclusions; heuristic size/color, independently adjustable.
        spot=noise('Sparse formulation flecks',360.,1.)
        mask=n.new('ShaderNodeMapRange');mask.clamp=True;mask.inputs['From Min'].default_value=.69;mask.inputs['From Max'].default_value=.79
        lk.new(spot,mask.inputs['Value'])
        prior=p.inputs['Base Color'].links[0].from_socket
        mix=n.new('ShaderNodeMixRGB');lk.new(mathop('MULTIPLY',mask.outputs[0],speckles),mix.inputs[0]);lk.new(prior,mix.inputs[1])
        mix.inputs[2].default_value=(*(v*.52 for v in color),1);lk.new(mix.outputs[0],p.inputs['Base Color'])
    if finish=='gelatin_shell':
        # Drawn-shell scuffs: long thin striations and irregular handling patches.
        vec=n.new('ShaderNodeVectorMath');vec.operation='MULTIPLY';vec.inputs[1].default_value=(850.,45000.,45000.)
        lk.new(tc.outputs['Object'],vec.inputs[0])
        sc=n.new('ShaderNodeTexNoise');sc.inputs['Scale'].default_value=1.;sc.inputs['Detail'].default_value=2.
        lk.new(vec.outputs[0],sc.inputs['Vector'])
        scratches=mathop('MAXIMUM',mathop('SUBTRACT',sc.outputs['Fac'],.61),0.)
        patch=noise('Nonuniform shell handling wear',950.,2.)
        sm=n.new('ShaderNodeMapRange');sm.clamp=True;sm.inputs['From Min'].default_value=.43;sm.inputs['From Max'].default_value=.72
        lk.new(patch,sm.inputs['Value'])
        scratches=mathop('MULTIPLY',mathop('MULTIPLY',scratches,sm.outputs[0]),scuffs)
        rr=mathop('ADD',ramp.outputs[0],mathop('MULTIPLY',sm.outputs[0],.20))
        rr=mathop('ADD',rr,mathop('MULTIPLY',scratches,2.8));lk.new(rr,p.inputs['Roughness'])
        scratch_bump=n.new('ShaderNodeBump');scratch_bump.inputs['Distance'].default_value=.000045;scratch_bump.inputs['Strength'].default_value=.65
        lk.new(scratches,scratch_bump.inputs['Height']);lk.new(b.outputs[0],scratch_bump.inputs['Normal']);lk.new(scratch_bump.outputs[0],p.inputs['Normal'])
        mix=n.new('ShaderNodeMixRGB');lk.new(mathop('MULTIPLY',scratches,.6),mix.inputs[0]);lk.new(cr.outputs[0],mix.inputs[1]);mix.inputs[2].default_value=(.8,.77,.68,1);lk.new(mix.outputs[0],p.inputs['Base Color'])
    if finish=='softgel_shell':
        transmission=max(0.,min(1.,softgel_transmission))
        p.inputs['Transmission Weight'].default_value=transmission
        p.inputs['Subsurface Weight'].default_value=.035*(1-transmission)
        p.inputs['IOR'].default_value=1.46
        tint=None
        if transmission>0:
            # Separate a colored opaque shell lobe from the clear refracting lobe.
            # White diffuse leakage in a partially transmitting shader otherwise
            # washes brown/green shells out even before volume absorption.
            for link in list(p.inputs['Base Color'].links):lk.remove(link)
            p.inputs['Base Color'].default_value=(1.,1.,1.,1)
            p.inputs['Transmission Weight'].default_value=1.
            p.inputs['Subsurface Weight'].default_value=0.
            if transmission<1:
                opaque=n.new('ShaderNodeBsdfPrincipled');opaque.label='Pigmented opaque shell fraction'
                lk.new(cr.outputs[0],opaque.inputs['Base Color'])
                for key in ['Roughness','Normal']:
                    for link in p.inputs[key].links:lk.new(link.from_socket,opaque.inputs[key])
                opaque.inputs['IOR'].default_value=1.46;opaque.inputs['Subsurface Weight'].default_value=.035;opaque.inputs['Subsurface Scale'].default_value=.00008
                mix=n.new('ShaderNodeMixShader');mix.inputs[0].default_value=transmission;lk.new(opaque.outputs[0],mix.inputs[1]);lk.new(p.outputs[0],mix.inputs[2]);lk.new(mix.outputs[0],n.get('Material Output').inputs['Surface'])
            absorption=n.new('ShaderNodeVolumeAbsorption');absorption.label='Beer-Lambert color at reference optical path'
            optical=absorption_parameters(color,transmission_density)
            tint=tuple(absorption_color) if absorption_color is not None else tuple(optical['node_color'])
            node_density=transmission_density if absorption_color is not None else optical['node_density']
            absorption.inputs['Color'].default_value=(*tint,1)
            absorption.inputs['Density'].default_value=node_density
            q.update(absorption_coefficient_per_m=[(1-v)*node_density for v in tint],optical_mapping=optical,absorption_control=transmission_density)
            volume=absorption.outputs[0]
            if softgel_scatter>0:
                scatter=n.new('ShaderNodeVolumeScatter');scatter.label='Suspension / milky shell proxy';scatter.inputs['Color'].default_value=(.94,.92,.85,1);scatter.inputs['Density'].default_value=softgel_scatter;scatter.inputs['Anisotropy'].default_value=.25
                add=n.new('ShaderNodeAddShader');lk.new(volume,add.inputs[0]);lk.new(scatter.outputs[0],add.inputs[1]);volume=add.outputs[0]
            lk.new(volume,n.get('Material Output').inputs['Volume'])
        q.update(transmission_weight=transmission,volume_density_per_m=node_density if transmission else 0.,volume_scatter_per_m=softgel_scatter if transmission else 0.,volume_color=list(tint) if tint else None)
        q['volume_model']='homogeneous fill/shell optical proxy; no separately meshed liquid interface' if transmission else 'opaque pigmented shell; no transparent volume'
    m['surface_revision']='softgel_beer_lambert_v46' if finish=='softgel_shell' else 'sparse_irregular_pores_v4_2'
    m['surface_parameters_json']=json.dumps(dict(q,surface_revision=m['surface_revision'],finish=finish,seed=seed,texture=texture,speckles=speckles,wear=wear,powder_amount=powder,scuff_strength=scuffs,units='micrometres where suffixed _um',provenance='procedural prior; not specimen-fitted'))
    return m
