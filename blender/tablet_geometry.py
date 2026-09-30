"""Crowned compression faces, manufactured bevel/band, narrow scores and real deboss."""
import math
import random
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector, Matrix
from mathutils.noise import noise_vector


def compression_tablet(family,l,w,h,rng,score=0,chip=0,*,score_width_mm=.32,score_depth_mm=.14,resolution=192,press_defects=1.,edge_wear=0.,outline_variant="family",score_layout="auto",score_faces="top",face_rim_width_mm=0.,crown_height_mm=None,crown_curve=1.6,crown_edge_blend_mm=.06,breakout_density=.035,breakout_size_mm=.18):
    if outline_variant not in ['family','heart']:raise ValueError('Unknown outline variant')
    if score_layout not in ['auto','single','cross','parallel']:raise ValueError('Unknown score layout')
    if score_faces not in ['top','both']:raise ValueError('Unknown score faces')
    n=resolution;nr=96 if score==2 and score_layout=="parallel" else 48;verts=[];faces=[]
    heart=[(16*math.sin(k*2*math.pi/n)**3+6*math.sin(k*2*math.pi/n),13*math.cos(k*2*math.pi/n)-5*math.cos(2*k*2*math.pi/n)-2*math.cos(3*k*2*math.pi/n)-math.cos(4*k*2*math.pi/n)) for k in range(n)]
    hymin=min(v[1] for v in heart);hymax=max(v[1] for v in heart)
    if outline_variant=='heart':
        # Resample the analytic heart by polar direction, avoiding collapsed
        # angular sectors at the two analytic cusps near ring centres.
        contour=[(x/44,(y-hymin)/(hymax-hymin)-.5) for x,y in heart]
        heart_radial=[]
        for k in range(n):
            dx=math.cos(k*2*math.pi/n);dy=math.sin(k*2*math.pi/n);hits=[]
            for i,(px,py) in enumerate(contour):
                qx,qy=contour[(i+1)%n];ex=qx-px;ey=qy-py;den=dx*ey-dy*ex
                if abs(den)<1e-12:continue
                t=(px*dy-py*dx)/den;r=(px*ey-py*ex)/den
                if -.000001<=t<=1.000001 and r>0:hits.append(r)
            if not hits:raise ValueError('Heart contour is not star shaped')
            r=min(hits);heart_radial.append((r*dx,r*dy))
    layout=('cross' if score==2 else 'single') if score_layout=='auto' else score_layout
    crown=h*({'round_flat':.018,'round_biconvex':.13,'oval_tablet':.13}.get(family,.075)) if crown_height_mm is None else crown_height_mm*.001
    if not 0<=crown<h*.4:raise ValueError('Crown height must be nonnegative and less than 40% of thickness')
    if not 0<=face_rim_width_mm<min(l,w)*1000*.3:raise ValueError('Face rim must be less than 30% of the smaller outline dimension')
    if not 1<=crown_curve<=4:raise ValueError('Crown curve must be between 1 and 4')
    if crown_edge_blend_mm<0:raise ValueError('Crown edge blend must be nonnegative')
    bevel=min(.00022,h*.09);br=min(.09,.00022/(min(l,w)/2))
    edge=1-br;shoulder=h/2-crown-bevel
    profiles=[]
    inner_face=max(.1,edge-face_rim_width_mm*.001/(min(l,w)/2))
    blend=min(crown_edge_blend_mm*.001/(min(l,w)/2),inner_face*.25)
    power=crown_curve+1
    for j in range(nr+1):
        r=edge*j/nr
        if face_rim_width_mm:
            # Allocate samples to the narrow shoulder independently of overall
            # face resolution, while retaining fixed topology for shape morphs.
            body_rings=nr-6
            if blend>0:
                if j<=body_rings:r=(inner_face-blend)*j/body_rings
                elif j<=body_rings+2:r=inner_face-blend+blend*(j-body_rings)/2
                else:r=inner_face+(edge-inner_face)*(j-body_rings-2)/4
            else:
                if j<=body_rings:r=inner_face*j/body_rings
                else:r=inner_face+(edge-inner_face)*(j-body_rings)/6
            u=min(1.,r/inner_face);cap=max(0.,1-u**power)
            if blend>0 and inner_face-blend<r<inner_face:
                r0=inner_face-blend;u0=r0/inner_face;t=(r-r0)/blend
                y0=1-u0**power;dy0=-power*u0**(power-1)/inner_face
                cap=(2*t**3-3*t*t+1)*y0+(t**3-2*t*t+t)*blend*dy0
            z=h/2-crown+crown*cap
        else:z=h/2-crown*(r/edge)**2
        profiles.append((r,z))
    for j in range(1,9):
        a=math.pi/2*(1-j/8);profiles.append((edge+br*math.cos(a),shoulder+bevel*math.sin(a)))
    profiles.extend([(1.,shoulder*(1-2*j/5)) for j in range(1,6)])
    profiles.extend([(r,-z) for r,z in reversed(profiles[:nr+8])])
    chip_a=rng.uniform(-math.pi,math.pi);phase=rng.uniform(0,100)
    # Rare granule pull-outs, with irregular polygonal boundaries and a rough
    # shallow floor. This replaces the old 38 smooth, circular press dimples.
    if breakout_density<0 or breakout_size_mm<=0:raise ValueError('Invalid breakout density or size')
    drng=random.Random(round(phase*100000)+711)
    expected=math.pi*l*w*.25*1e6*breakout_density*min(1.5,max(0,press_defects))
    count=0;product=1.;limit=math.exp(-min(expected,20.))
    while product>limit:
        product*=drng.random();count+=1
    count=max(0,count-1)
    dents=[];affected_breakouts=set();damaged_vertices=set()
    for index in range(count):
        ang=drng.uniform(0,2*math.pi);rr=math.sqrt(drng.uniform(.04,.78))
        radius=breakout_size_mm*.001*drng.uniform(.62,1.18)
        aspect=drng.uniform(.55,1.15);rotation=drng.uniform(0,math.tau)
        sides=drng.randint(4,7)
        planes=[(math.cos(rotation+k*math.tau/sides),math.sin(rotation+k*math.tau/sides)/aspect,radius*drng.uniform(.72,1.05)) for k in range(sides)]
        depth=drng.uniform(.000020,.000047)*min(1.7,press_defects)
        dents.append((rr*math.cos(ang)*l*.5,rr*math.sin(ang)*w*.5,radius,depth,planes,drng.uniform(-.20,.20),drng.uniform(-.20,.20)))
    halfgroove=score_width_mm*.0005;groove_depth=min(score_depth_mm*.001,h*.10)
    for radial,z in profiles:
        for k in range(n):
            a=k*2*math.pi/n;c=math.cos(a);s=math.sin(a)
            exp={'caplet':.7,'oblong_tablet':.40,'diamond_tablet':1.7}.get(family,1)
            power=2/exp;outline_r=(abs(c)**power+abs(s)**power)**(-1/power)
            x=l/2*c*outline_r*radial;y=w/2*s*outline_r*radial
            sides={'triangular_tablet':3,'hexagonal_tablet':6}.get(family)
            if sides:
                sec=2*math.pi/sides;f=math.cos(math.pi/sides)/math.cos((a+math.pi/sides)%sec-math.pi/sides);x*=f;y*=f
            if family=='unknown_shape' and outline_variant=='family':f=1+.18*math.cos(5*a);x*=f;y*=f
            if outline_variant=='heart':
                hx,hy=heart_radial[k];x=hx*l*radial;y=hy*w*radial
            zv=z
            if score and (z>=shoulder or (score_faces=='both' and z<=-shoulder)):
                g=max(0.,1-abs(x)/halfgroove)
                if score==2 and layout=='cross':g=max(g,max(0.,1-abs(y)/halfgroove))
                if score==2 and layout=='parallel':g=max(max(0.,1-abs(x-l/6)/halfgroove),max(0.,1-abs(x+l/6)/halfgroove))
                zv-=math.copysign(groove_depth*g*min(1.,max(0.,(abs(z)-shoulder)/max(bevel,.00001))),z)
            if z>shoulder:
                for di,(dx,dy,dr,dd,planes,tx,ty) in enumerate(dents):
                    ux=x-dx;uy=y-dy
                    if abs(ux)>dr*1.6 or abs(uy)>dr*1.6:continue
                    # Intersection of irregular half-planes: torn polygon, not a bowl.
                    inset=min(off-nx*ux-ny*uy for nx,ny,off in planes)
                    if inset>0:
                        lip=min(1.,inset/.000012)
                        crumb=noise_vector(Vector((x*51000+phase,y*51000,di+phase))).z
                        floor=max(.35,.85+tx*ux/dr+ty*uy/dr+.16*crumb)
                        zv-=dd*lip*floor
                        affected_breakouts.add(di);damaged_vertices.add(len(verts))
            if edge_wear and radial>.87 and z>shoulder:
                patch=max(0.,math.sin(a*3+phase))**10
                zv-=edge_wear*.00010*patch*min(1.,(radial-.87)/.10)
            # Fine geometric irregularity, distinct from the shader's finer relief.
            nv=noise_vector(Vector((x*11000+phase,y*11000,z*11000)))
            if radial>.02:zv+=nv.z*.0000015
            d=abs(math.atan2(math.sin(a-chip_a),math.cos(a-chip_a)))
            if chip and d<.32 and radial>.78 and z>0:
                bite=chip*(1-d/.32)*min(1.,(radial-.78)/.15)
                x*=1-bite;y*=1-bite;zv-=h*bite*(.3+.15*nv.x)
            verts.append((x,y,zv))
    for j in range(len(profiles)-1):
        for k in range(n):
            a=j*n+k;b=j*n+(k+1)%n;faces.append((a,a+n,b+n,b))
    mesh=bpy.data.meshes.new(family+' compression mesh');mesh.from_pydata(verts,[],faces);mesh.update()
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-8);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
    obj=bpy.data.objects.new(family,mesh);bpy.context.collection.objects.link(obj)
    # Smooth the manufactured face; fractured floor facets retain their local angles.
    # Re-evaluate affected positions after the centre-vertex weld.
    for poly in mesh.polygons:
        poly.use_smooth=True
        cx,cy,cz=poly.center
        if cz>shoulder:
            for dx,dy,dr,dd,planes,tx,ty in dents:
                if abs(cx-dx)<dr*1.6 and abs(cy-dy)<dr*1.6 and min(off-nx*(cx-dx)-ny*(cy-dy) for nx,ny,off in planes)>0:
                    poly.use_smooth=False;break
    obj['geometry_revision']='compression_v4_2';obj['outline_variant']=outline_variant;obj['score_layout']=layout;obj['score_faces']=score_faces
    obj['score_width_mm']=score_width_mm if score else 0.;obj['score_depth_mm']=groove_depth*1000 if score else 0.
    obj['face_rim_width_mm']=face_rim_width_mm;obj['crown_curve']=crown_curve;obj['crown_edge_blend_mm']=crown_edge_blend_mm;obj['inner_face_radius_normalized']=inner_face
    obj['edge_wear']=edge_wear;obj['press_depressions']=len(affected_breakouts);obj['breakout_revision']='sparse_polygonal_v1';obj['breakout_density_per_mm2']=breakout_density;obj['breakout_size_mm']=breakout_size_mm;obj['press_defects_strength']=press_defects;obj['crown_mm']=crown*1000;obj['bevel_mm']=bevel*1000
    return obj


def deboss(obj,text,size,*,xy=(0,0),depth_mm=.10):
    """Subtract a font die from the top face in local coordinates; same instance ID."""
    if not text:return False
    # Sample local face height beneath the lettering. Cutter penetrates the face only.
    hit,loc,normal,index=obj.ray_cast(Vector((xy[0],xy[1],1)),Vector((0,0,-1)))
    if not hit:return False
    top=loc.z
    bpy.context.view_layer.update()
    bpy.ops.object.text_add();die=bpy.context.object;die.name='temporary lettering die'
    die.data.body=text;die.data.align_x='CENTER';die.data.align_y='CENTER';die.data.size=size
    font_path=Path(__file__).resolve().parent/'fonts/DejaVuSans.ttf'
    if font_path.exists():die.data.font=bpy.data.fonts.load(str(font_path),check_existing=True)
    die.data.resolution_u=8;die.data.extrude=.0007
    die.data.bevel_depth=0.;die.data.bevel_resolution=0
    # Text extrusion is symmetric about its origin.
    die.matrix_world=obj.matrix_world @ Matrix.Translation((xy[0],xy[1],top-depth_mm*.001+.0007))
    bpy.context.view_layer.objects.active=die;die.select_set(True);bpy.ops.object.convert(target='MESH');die=bpy.context.object
    bpy.context.view_layer.objects.active=obj;obj.select_set(True)
    original=obj.data.copy()
    mod=obj.modifiers.new('shallow recessed '+text,'BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=die
    try:bpy.ops.object.modifier_apply(modifier=mod.name)
    except Exception:
        obj.modifiers.remove(mod);bpy.data.objects.remove(die,do_unlink=True);bpy.data.meshes.remove(original);raise
    bpy.data.objects.remove(die,do_unlink=True)
    # Very small die/face intersections can fail in Blender's Boolean solver.
    # Never silently replace a pill with an empty or open mesh.
    check=bmesh.new();check.from_mesh(obj.data)
    valid=len(check.faces)>0 and check.calc_volume(signed=True)>0 and all(e.is_manifold for e in check.edges)
    check.free()
    if not valid:
        failed=obj.data;obj.data=original;bpy.data.meshes.remove(failed)
        obj['imprint_render_failed']=True
        return False
    bpy.data.meshes.remove(original)
    obj['imprint']=text;obj['imprint_style']='debossed';obj['imprint_depth_mm']=depth_mm
    return True


def _signed_volume(obj):
    bm=bmesh.new();bm.from_mesh(obj.data);volume=bm.calc_volume(signed=True);bm.free();return volume


def _cut_mesh(obj,verts,faces,core_material,name):
    """Boolean a closed cutter; transfer its core material to newly exposed faces."""
    slot=len(obj.data.materials);obj.data.materials.append(core_material)
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update()
    bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free()
    die=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(die)
    bpy.context.view_layer.update();die.matrix_world=obj.matrix_world.copy()
    for mat in obj.data.materials:me.materials.append(mat)
    for face in me.polygons:face.material_index=slot
    bpy.context.view_layer.objects.active=obj;obj.select_set(True)
    mod=obj.modifiers.new(name,'BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=die
    bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(die,do_unlink=True)
    obj.data.update()


def fracture_tablet(obj,core_material,*,seed=42,offset_mm=None,waviness_mm=.34,lip_mm=.65,tilt_deg=0.):
    """Subtract a volume bounded by a seeded irregular fracture, keeping the +X side.

    Tilt is measured from vertical through thickness: x += z*tan(tilt_deg).
    Offset, large waves, smaller jagged relief and a local protruding/broken tongue
    are independent of the visible score. Remaining volume is recorded, not assumed 50%.
    """
    import random
    rng=random.Random(seed);coords=[v.co for v in obj.data.vertices]
    l=max(v.x for v in coords)-min(v.x for v in coords);w=max(v.y for v in coords)-min(v.y for v in coords);h=max(v.z for v in coords)-min(v.z for v in coords)
    off=rng.uniform(-l*.075,l*.075) if offset_mm is None else offset_mm*.001
    phase=rng.uniform(0,6);cy=rng.uniform(-w*.23,w*.23);cz=rng.uniform(-h*.1,h*.1)
    if not math.isfinite(tilt_deg) or abs(tilt_deg)>60:raise ValueError('Fracture tilt must be finite and within +/-60 degrees')
    slope=math.tan(math.radians(tilt_deg))
    ny=64;nz=26;span_y=w*.70;span_z=h*.8
    back_x=min(-l,off-abs(slope)*span_z-abs(waviness_mm)*.001-abs(lip_mm)*.001-l)
    verts=[]
    for back in [False,True]:
        for iz in range(nz+1):
            z=(iz/nz*2-1)*span_z
            for iy in range(ny+1):
                y=(iy/ny*2-1)*span_y
                wave=waviness_mm*.001*(.64*math.sin(y/max(w,.001)*12+phase)+.36*math.sin(z/max(h,.001)*8+y/max(w,.001)*9+phase))
                jag=.000085*noise_vector(Vector((y*6500+phase,z*6500,phase))).x
                tongue=lip_mm*.001*math.exp(-((y-cy)/(w*.14))**2-((z-cz)/(h*.35))**2)
                x=back_x if back else off+slope*z+wave+jag-tongue
                verts.append((x,y,z))
    count=(ny+1)*(nz+1);faces=[]
    for iz in range(nz):
        for iy in range(ny):
            a=iz*(ny+1)+iy;faces.append((a,a+1,a+ny+2,a+ny+1));faces.append((a+count,a+ny+1+count,a+ny+2+count,a+1+count))
    boundary=list(range(ny+1))+[iz*(ny+1)+ny for iz in range(1,nz+1)]+[nz*(ny+1)+iy for iy in range(ny-1,-1,-1)]+[iz*(ny+1) for iz in range(nz-1,0,-1)]
    for i,a in enumerate(boundary):
        b=boundary[(i+1)%len(boundary)];faces.append((a,b,b+count,a+count))
    before=_signed_volume(obj);prior_fraction=obj.get('geometric_remaining_fraction',1.);_cut_mesh(obj,verts,faces,core_material,'irregular fracture volume')
    obj['fracture_tilt_deg']=tilt_deg;obj['fracture_revision']='warped_offcenter_v4';obj['fracture_seed']=seed;obj['fracture_offset_mm']=off*1000;obj['fracture_waviness_mm']=waviness_mm;obj['fracture_lip_mm']=lip_mm
    obj['geometric_remaining_fraction']=prior_fraction*_signed_volume(obj)/before


def chip_tablet(obj,core_material,*,seed=42,amount=.18,count=1):
    """Remove one or several irregular angular chunks at the edge, through the top bevel."""
    import random
    rng=random.Random(seed);coords=[v.co for v in obj.data.vertices]
    rx=max(abs(v.x) for v in coords);ry=max(abs(v.y) for v in coords);h=max(v.z for v in coords)-min(v.z for v in coords)
    before=_signed_volume(obj)
    for i in range(count):
        angle=rng.uniform(0,2*math.pi);centre=Vector((rx*.94*math.cos(angle),ry*.94*math.sin(angle),h*.32))
        radius=min(rx,ry)*amount*1.5
        ray=Vector((-rx*math.cos(angle),-ry*math.sin(angle),0)).normalized()
        hit,edge,normal,face=obj.ray_cast(Vector((rx*2*math.cos(angle),ry*2*math.sin(angle),h*.22)),ray)
        if hit:centre=Vector((edge.x-ray.x*radius*.10,edge.y-ray.y*radius*.10,h*.32))
        bm=bmesh.new();bmesh.ops.create_icosphere(bm,subdivisions=2,radius=1.);bm.verts.ensure_lookup_table();bm.verts.index_update()
        verts=[]
        for v in bm.verts:
            f=rng.uniform(.83,1.17);verts.append(tuple(centre+Vector((v.co.x*radius*f,v.co.y*radius*f,v.co.z*radius*.75*f))))
        faces=[tuple(v.index for v in face.verts) for face in bm.faces];bm.free()
        _cut_mesh(obj,verts,faces,core_material,'missing angular edge chunk')
    obj['chip_revision']='boolean_chunks_v4';obj['chip_seed']=seed;obj['missing_chunks']=count;obj['chip_amount']=amount;obj['geometric_remaining_fraction']=_signed_volume(obj)/before
