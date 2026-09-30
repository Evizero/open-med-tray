"""Repeated product priors and constrained placement; no pharmacological identities."""
import math
from pill_appearance_v46 import solid_colors,softgel
import bpy
import numpy as np
from mathutils import Matrix,Vector
from mathutils.geometry import convex_hull_2d

NEUTRALS=[(.90,.89,.85),(.95,.94,.91),(.91,.86,.71),(.78,.74,.62)]
COLORS=[(.87,.58,.51),(.79,.34,.23),(.88,.73,.27),(.65,.80,.81),(.68,.77,.48),(.37,.18,.10),(.24,.045,.055)]
CAPS=[(.015,.14,.60),(.008,.14,.055),(.012,.34,.28),(.59,.025,.025),(.91,.77,.19),(.24,.027,.050),(.74,.86,.75),(.12,.14,.18)]
WEIGHTS=[12,26,14,10,18,5,9,1.5,1.3,1.2,1,.9]


def product_pool(rng,families,presets,config,split):
    # Distinct curated preset IDs for normal train/val/test; stress uses test IDs.
    rows=presets
    if rows and config.get('split_appearance_presets',True):
        ordered=sorted(rows,key=lambda r:r['id']);a=max(1,int(len(rows)*.68));b=max(a+1,int(len(rows)*.84))
        rows=ordered[:a] if split in ['train','preview'] else ordered[a:b] if split=='val' else ordered[b:]
    pool=[]
    for j in range(rng.randint(3,6)):
        family=rng.choices(families,config.get('family_weights',WEIGHTS))[0];elong=family in ['oval_tablet','caplet','hard_capsule','softgel','oblong_tablet']
        length=rng.uniform(9,21) if elong else rng.uniform(4.5,12.5);width=length*rng.uniform(.37,.63) if elong else length;height=rng.uniform(1.9,4.3)
        if family in ['hard_capsule','softgel']:height=width*rng.uniform(.88,1)
        if family=='round_flat':height*=.75
        finish='gelatin_shell' if family=='hard_capsule' else 'softgel_shell' if family=='softgel' else rng.choices(['chalky_uncoated','matte_film','satin_film'],[45,40,15])[0]
        palette=solid_colors(rng,family,finish);color=palette['color'];second=palette['secondary_color']
        if family=='hard_capsule' and config.get('capsule_color_override'):
            # v4.9 opt-in stratum knob: dark body and/or two-tone capsules. Separate RNG keeps the main stream unchanged.
            import random;o=config['capsule_color_override'];crng=random.Random(rng.randrange(2**30))
            from pill_appearance_v46 import shade
            dark=crng.random()<o.get('dark_probability',.5);name=crng.choice(o.get('dark_colors',['near_black','burgundy','brown_red','blue','green','violet','teal','brown'])) if dark else crng.choice(o.get('light_colors',['white','cream','pale_yellow','peach','pale_blue','pink','lilac']))
            other=crng.choice(o.get('light_colors',['white','cream','pale_yellow','peach','pale_blue','pink','lilac'])+(['near_black','blue','green'] if not dark else [])) if crng.random()<o.get('two_tone_probability',.7) else name
            if other==name and crng.random()<o.get('two_tone_probability',.7):other='white' if name!='white' else 'blue'
            color=shade(crng,name);second=shade(crng,other) if other!=name else list(color)
            palette=dict(color=color,secondary_color=second,color_family=name,secondary_color_family=other,color_provenance='v4.9 stratum override of bounded palette; not measured RGB',two_tone=other!=name)
        score=rng.choices([0,1,2],[42,50,8])[0] if family not in ['hard_capsule','softgel','ring_tablet'] else 0
        appearance=rng.choice(rows) if rows and rng.random()<config.get('appearance_preset_probability',.35) else None
        if appearance:
            ap=appearance['parameters'];family=ap['family'];length=ap['length_mm'];width=ap['width_mm'];height=ap['height_mm'];color=ap['color'];second=ap['secondary_color'];finish=ap['finish'];score=ap['score']
        if appearance:palette=dict(color_family=appearance['declared']['color'],secondary_color_family=appearance['declared'].get('secondary_color') or appearance['declared']['color'],two_tone=list(color)!=list(second),color_provenance='curated source description; RGB is a design prior')
        sg=softgel(rng,appearance) if family=='softgel' else {}
        pool.append(dict(geometry_seed=rng.randrange(2**30),score_width_mm=rng.uniform(.14,.70),score_depth_mm=rng.uniform(.06,.24),imprint_layout=rng.choice(['text','text','cross','stacked','boxed','symbol_code']),product_key=f'SYNTH-{j+1}',family=family,length=length/1000,width=width/1000,height=height/1000,color=list(color),secondary_color=list(second),finish=finish,score=score,appearance=appearance,imprint=appearance['parameters']['synthetic_marking'] if appearance else rng.choice(['P12','A25','M50','R3','C3','',''])))
        pool[-1].update(palette);pool[-1].update(sg)
    return pool


def occupied_slots(rng,count,n):
    weights=[rng.gammavariate(.65,1) for _ in range(n)]
    return rng.choices(range(n),weights,k=count)


def _hull(xy):
    vs=[Vector((float(x),float(y))) for x,y in xy];idx=convex_hull_2d(vs);return np.asarray([xy[i] for i in idx])


def _separate(a,b,clearance):
    # Convex projected mesh hull SAT; conservative around chipped concavities.
    for poly in [a,b]:
        edges=np.roll(poly,-1,axis=0)-poly;normals=np.stack([-edges[:,1],edges[:,0]],1);normals/=np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-12)
        pa=a@normals.T;pb=b@normals.T
        if np.any((pa.max(0)+clearance<pb.min(0))|(pb.max(0)+clearance<pa.min(0))):return True
    return False


def place(o,rng,slots,preferred,placed,family,config):
    face_up=family in ['hard_capsule','softgel'] or rng.random()>.38
    roll=rng.uniform(-math.pi,math.pi) if family in ['hard_capsule','softgel'] else 0 if face_up else math.pi
    # Flat support for ordinary tablets; only small pose perturbations on curved capsules.
    tilt=rng.uniform(-.07,.07) if family in ['hard_capsule','softgel'] else 0
    yaw=rng.uniform(0,math.tau);rot=Matrix.Rotation(yaw,3,'Z')@Matrix.Rotation(tilt,3,'Y')@Matrix.Rotation(roll,3,'X')
    xyz=np.array([v.co[:] for v in o.data.vertices])@np.asarray(rot).T;hull=_hull(xyz[:,:2]);lo=hull.min(0);hi=hull.max(0);clearance=rng.choice(config.get('placement_clearances',[.00002,.0001,.00035,.0008]))
    chosen=None;stacked=False
    region=slots[preferred].get('region_kind','tray')
    allowed=[i for i,sp in enumerate(slots) if sp.get('region_kind','tray')==region]
    for slot in [preferred]+rng.sample(allowed,len(allowed)):
        sp=slots[slot];a=np.array([sp['x_min_m'],sp['y_min_m']])-lo;b=np.array([sp['x_max_m'],sp['y_max_m']])-hi
        if np.any(a>b):continue
        for attempt in range(65):
            pos=np.array([rng.uniform(a[0],b[0]),rng.uniform(a[1],b[1])])
            if attempt<8 and rng.random()<.24:axis=rng.randrange(2);pos[axis]=rng.choice([a[axis],b[axis]])
            world=hull+pos;others=[v for v in placed if v['slot']==slot]
            if all(_separate(world,q['hull'],clearance) for q in others):chosen=(slot,pos,sp['floor_z_m']+.000015-float(xyz[:,2].min()),world);break
        if chosen:break
    if chosen is None:
        # A supported conservative stack is a rare fallback; full rigid-body settling is deferred.
        candidates=[q for q in placed if q['slot']==preferred]
        for q in candidates:
            sp=slots[preferred];pos=q['position'][:2];world=hull+pos
            if world[:,0].min()<sp['x_min_m'] or world[:,0].max()>sp['x_max_m'] or world[:,1].min()<sp['y_min_m'] or world[:,1].max()>sp['y_max_m']:continue
            support=max(v['top_z'] for v in placed if v['slot']==preferred and not _separate(world,v['hull'],0))
            top=support+.000015+float(xyz[:,2].max()-xyz[:,2].min())
            if top-sp['floor_z_m']>config.get('max_stack_height_mm',18)/1000:continue
            chosen=(preferred,pos,support+.000015-float(xyz[:,2].min()),world);stacked=True;break
    if chosen is None:return None
    slot,pos,z,world=chosen;o.location=(float(pos[0]),float(pos[1]),z);o.rotation_euler=rot.to_euler();o['face_up']=face_up
    record={'slot':slot,'hull':world,'position':np.array([*pos,z]),'top_z':z+float(xyz[:,2].max())};placed.append(record)
    return dict(slot=slot,x=float(pos[0]),y=float(pos[1]),z=z,angle=yaw,stacked=stacked,face_up=face_up,roll_deg=math.degrees(roll),tilt_deg=math.degrees(tilt),placement_revision='convex_projected_fit_v46',support='conservative bounding-height stack' if stacked else 'floor contact',clearance_mm=clearance*1000)


def capsule_print(G,o,body,size,ink,iid):
    t=G.text_obj(body,(0,0,0),size,ink,iid);t.data.extrude=0
    bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get();mesh=bpy.data.meshes.new_from_object(t.evaluated_get(dg));new=bpy.data.objects.new('conformed capsule print',mesh);bpy.context.collection.objects.link(new);new.pass_index=iid
    new.data.materials.clear();new.data.materials.append(ink)
    import bmesh
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.triangulate(bm,faces=list(bm.faces))
    for _ in range(4):
        edges=[e for e in bm.edges if e.calc_length()>.00025]
        if not edges:break
        bmesh.ops.subdivide_edges(bm,edges=edges,cuts=1,use_grid_fill=True)
    bm.to_mesh(mesh);bm.free();hitcount=0
    for v in mesh.vertices:
        hit,loc,normal,_=o.ray_cast(Vector((v.co.x,v.co.y,1)),Vector((0,0,-1)))
        if hit:v.co=loc+normal*.000009;hitcount+=1
    new.matrix_world=o.matrix_world.copy();bpy.data.objects.remove(t,do_unlink=True)
    if hitcount<len(mesh.vertices)*.98:bpy.data.objects.remove(new,do_unlink=True);return False
    return True
