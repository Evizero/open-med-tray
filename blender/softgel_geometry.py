"""Watertight oral softgel shapes: round/oval ellipsoids and rounded oblongs.

Two rotary-die shell halves meet in the XZ plane. This is not a telescoping
hard-capsule cap. Seam dimensions/asymmetry are bounded procedural priors.
"""
import math,json
import bpy

def softgel_mesh(l,w,h,rng,*,softgel_shape='oval',softgel_straight_fraction=0.,softgel_seam_width_mm=.09,softgel_seam_relief_mm=.012,softgel_asymmetry=.004,**ignored):
    n=128;endrings=32;straight=max(0.,min(.60,softgel_straight_fraction))*l if softgel_shape=='oblong' else 0.
    cap=(l-straight)/2;seamwidth=max(.000025,softgel_seam_width_mm/1000);seamrelief=softgel_seam_relief_mm/1000;phase=rng.uniform(0,math.tau)
    rings=[]
    for j in range(endrings+1):
        a=-math.pi/2+j*math.pi/2/endrings;rings.append((-straight/2+cap*math.sin(a),math.cos(a)))
    if straight:
        for j in range(1,9):rings.append((-straight/2+straight*j/8,1.))
    for j in range(1,endrings+1):
        a=j*math.pi/2/endrings;rings.append((straight/2+cap*math.sin(a),math.cos(a)))
    verts=[(-l/2,0,0)];faces=[]
    for x,r in rings[1:-1]:
        for k in range(n):
            a=k*math.tau/n;y=w/2*r*math.cos(a);z=h/2*r*math.sin(a)
            # Small smooth shell forming variation, never a lumpy candy surface.
            warp=1+softgel_asymmetry*math.sin(a*2+phase)*math.sin(math.pi*(x/l+.5))
            ridge=seamrelief*math.exp(-(y/seamwidth)**2)*r*(.8+.2*math.sin(x/l*8+phase))
            y=y*warp+ridge*math.cos(a);z=z*warp+ridge*math.sin(a)
            verts.append((x,y,z))
    nr=len(rings)-2;end=len(verts);verts.append((l/2,0,0))
    for k in range(n):faces.append((0,1+(k+1)%n,1+k))
    for j in range(nr-1):
        for k in range(n):a=1+j*n+k;b=1+j*n+(k+1)%n;faces.append((a,b,b+n,a+n))
    for k in range(n):faces.append((1+(nr-1)*n+k,1+(nr-1)*n+(k+1)%n,end))
    mesh=bpy.data.meshes.new('softgel rotary-die shell');mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new('softgel '+softgel_shape,mesh);bpy.context.collection.objects.link(o)
    for f in mesh.polygons:f.use_smooth=True
    params=dict(shape=softgel_shape,straight_fraction=straight/l,seam_width_mm=softgel_seam_width_mm,seam_relief_mm=softgel_seam_relief_mm,asymmetry=softgel_asymmetry,seam_plane='XZ; shell halves split by local Y',dimensions_are='nominal before micrometre seam and forming variation')
    o['softgel_parameters_json']=json.dumps(params);o['geometry_revision']='softgel_rotary_die_v46';o['outline_variant']=softgel_shape
    return o
