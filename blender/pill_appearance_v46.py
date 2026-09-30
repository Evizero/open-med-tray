"""Bounded appearance priors informed by product descriptions, not measured spectra.

Sources and scope: docs/pill-colors-softgels-v46.md. Weights are coverage choices,
not Austrian prescribing frequencies. No RGB triplet identifies a medicine.
"""
PALETTE = {
 'white':(.94,.93,.90),'off_white':(.87,.86,.80),'cream':(.90,.82,.59),
 'beige':(.63,.49,.32),'yellow':(.88,.66,.12),'pale_yellow':(.94,.87,.48),
 'peach':(.88,.56,.36),'orange':(.77,.27,.07),'pink':(.85,.45,.48),
 'salmon':(.74,.31,.24),'red':(.53,.020,.025),'brown_red':(.26,.046,.025),
 'burgundy':(.16,.011,.034),'brown':(.22,.09,.035),'pale_blue':(.40,.63,.79),
 'blue':(.018,.16,.53),'pale_green':(.53,.68,.40),'green':(.022,.23,.078),
 'teal':(.014,.28,.25),'lilac':(.54,.41,.64),'violet':(.19,.065,.30),
 'gray':(.30,.32,.34),'near_black':(.023,.021,.019),'amber':(.82,.43,.055),
 'clear_straw':(.96,.86,.56),
}
NEUTRALS=['white','off_white','cream','beige']
TABLET_COLORS=['yellow','pale_yellow','peach','orange','pink','salmon','red','brown_red','brown','pale_blue','blue','pale_green','green','lilac','gray']
CAPSULE_COLORS=TABLET_COLORS+['burgundy','teal','violet','near_black']

def shade(rng,name):
    # One coherent product shade, reused for every repeat in the tray.
    gain=rng.uniform(.94,1.045)
    return [min(.98,max(.004,c*gain+rng.uniform(-.006,.006))) for c in PALETTE[name]]

def solid_colors(rng,family,finish):
    neutral_prob=.83 if finish=='chalky_uncoated' else .58
    name=rng.choice(NEUTRALS if rng.random()<neutral_prob else TABLET_COLORS)
    other=name
    if family=='hard_capsule':
        name=rng.choice(NEUTRALS[:3] if rng.random()<.35 else CAPSULE_COLORS)
        other=rng.choice(['white','cream']+CAPSULE_COLORS) if rng.random()<.65 else name
    color=shade(rng,name);second=shade(rng,other) if other!=name else list(color)
    return dict(color=color,secondary_color=second,color_family=name,secondary_color_family=other,color_provenance='bounded formulation palette; not measured RGB',two_tone=other!=name)

# Opaque is distinct from a strongly absorbing clear capsule. Shape, color and
# optics stay coupled within each prototype; manufacturer text supplies categories.
SOFTGEL_PROFILES = [
 ('clear_straw','transparent',1.,(20,75),(0,0),(.07,.16),15),
 ('amber','transparent',1.,(70,210),(0,0),(.08,.19),16),
 ('red','transparent',1.,(80,220),(0,0),(.09,.20),14),
 ('pink','transparent',1.,(45,130),(0,0),(.09,.19),7),
 ('green','translucent',.82,(60,180),(10,45),(.19,.34),10),
 ('brown','translucent',.90,(100,250),(0,15),(.12,.25),5),
 ('off_white','opaque',0.,(0,0),(0,0),(.17,.30),12),
 ('pale_yellow','milky',.22,(12,35),(70,170),(.13,.27),10),
 ('brown_red','opaque',0.,(0,0),(0,0),(.15,.29),11),
]

def softgel(rng,appearance=None,force_shape=None,force_profile=None,two_tone=None):
    profile=next(p for p in SOFTGEL_PROFILES if p[0]==force_profile) if force_profile else rng.choices(SOFTGEL_PROFILES,[p[-1] for p in SOFTGEL_PROFILES])[0]
    name,opacity,transmission,density,scatter,roughness,_=profile
    shape=force_shape or rng.choices(['round','oval','oblong'],[23,49,28])[0]
    if shape=='round':
        length=rng.uniform(5.5,9.5);width=length*rng.uniform(.94,1.0);height=width*rng.uniform(.88,1.0);straight=0.
    elif shape=='oval':
        length=rng.uniform(9.0,18.0);width=length*rng.uniform(.53,.76);height=width*rng.uniform(.78,.97);straight=0.
    else:
        length=rng.uniform(12.0,22.0);width=length*rng.uniform(.32,.47);height=width*rng.uniform(.83,1.0);straight=rng.uniform(.34,.55)
    color=shade(rng,name);second=list(color);other=name
    two_tone=(name=='brown_red' and rng.random()<.52) if two_tone is None else two_tone
    if two_tone:
        other='off_white';second=shade(rng,other);opacity='opaque';transmission=0.;density=(0,0);scatter=(0,0)
    if appearance:
        ap=appearance['parameters'];length,width,height=[ap[k] for k in ['length_mm','width_mm','height_mm']];color=list(ap['color']);second=list(ap['secondary_color']);name=other='curated_description';two_tone=color!=second
        shape='round' if length/width<1.15 else 'oval';straight=0.
        name=other=appearance['declared'].get('color','curated_description');opacity='transparent';transmission=1.;density=(70,210);scatter=(0,0)
        # Curated text is authoritative; do not invent transparency from a color.
        desc=str(appearance.get('declared','')).lower()
        if 'opaque' in desc or 'undurchsichtig' in desc:opacity='opaque';transmission=0.;density=(0,0);scatter=(0,0)
    return dict(length=length/1000,width=width/1000,height=height/1000,color=color,secondary_color=second,
        color_family=name,secondary_color_family=other,two_tone=two_tone,
        color_provenance='product-description-informed categories; RGB and sampling weights are design priors',
        softgel_shape=shape,softgel_straight_fraction=straight,softgel_opacity=opacity,
        softgel_transmission=transmission,softgel_density=rng.uniform(*density),softgel_scatter=rng.uniform(*scatter),softgel_roughness=rng.uniform(*roughness),
        softgel_seam_width_mm=rng.uniform(.055,.16),softgel_seam_relief_mm=rng.uniform(.005,.024),
        softgel_asymmetry=rng.uniform(.001,.012))
