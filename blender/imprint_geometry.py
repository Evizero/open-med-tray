"""Conformal geometric imprints: text, crossed words, layouts and vector emblems.

Dimensions are millimetres; custom path coordinates are normalized around zero.
Brand references inform layout, while dataset text and emblems can stay synthetic.
"""
import json
import math
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector
from mathutils.noise import noise_vector

FONTS = {'sans':'DejaVuSans.ttf','bold':'DejaVuSans-Bold.ttf','serif':'DejaVuSerif.ttf','mono':'DejaVuSansMono.ttf'}
LAYOUTS = ('text','cross','stacked','boxed','symbol_code','custom')


def _text(text, centre, box, font):
    curve=bpy.data.curves.new('imprint glyphs','FONT')
    curve.body=text;curve.align_x='CENTER';curve.align_y='CENTER';curve.size=.001
    curve.extrude=.0006;curve.resolution_u=8;curve.bevel_depth=0
    curve.font=bpy.data.fonts.load(str(Path(__file__).parent/'fonts'/FONTS[font]),check_existing=True)
    o=bpy.data.objects.new('temporary imprint glyphs',curve);bpy.context.collection.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    bpy.ops.object.convert(target='MESH');o=bpy.context.object
    vv=[tuple(v.co) for v in o.data.vertices];ff=[tuple(p.vertices) for p in o.data.polygons]
    bpy.data.objects.remove(o,do_unlink=True)
    if not vv:raise ValueError('Imprint text is empty')
    lo=[min(v[k] for v in vv) for k in range(2)];hi=[max(v[k] for v in vv) for k in range(2)]
    scale=min(box[k]*.001/max(hi[k]-lo[k],1e-9) for k in range(2))
    vertices=[((v[0]-(lo[0]+hi[0])/2)*scale+centre[0]*.001,(v[1]-(lo[1]+hi[1])/2)*scale+centre[1]*.001,v[2]) for v in vv]
    return vertices,ff


def _stroke(points, width, closed=True):
    """A closed extruded ribbon; mitred joins avoid overlapping Boolean parts."""
    p=[Vector((float(x)*.001,float(y)*.001)) for x,y in points]
    n=len(p)
    if n<3 if closed else n<2:raise ValueError('Too few path points')
    outer=[];inner=[]
    for i,q in enumerate(p):
        prev=p[(i-1)%n] if closed or i else p[0]-(p[1]-p[0])
        nxt=p[(i+1)%n] if closed or i<n-1 else p[-1]+(p[-1]-p[-2])
        d1=(q-prev).normalized();d2=(nxt-q).normalized()
        n1=Vector((-d1.y,d1.x));n2=Vector((-d2.y,d2.x));bis=n1+n2
        if bis.length<1e-8:bis=n1
        else:bis.normalize()
        offset=bis*(width*.0005/max(.3,abs(bis.dot(n1))))
        outer.append(tuple(q+offset));inner.append(tuple(q-offset))
    vv=[(x,y,z) for z in [-.0006,.0006] for ring in [outer,inner] for x,y in ring];ff=[]
    for i in range(n if closed else n-1):
        j=(i+1)%n
        ff += [(i,j,n+j,n+i),(2*n+i,3*n+i,3*n+j,2*n+j),(i,2*n+i,2*n+j,j),(n+i,n+j,3*n+j,3*n+i)]
    if not closed:ff += [(0,n,3*n,2*n),(n-1,3*n-1,4*n-1,2*n-1)]
    return vv,ff


def _symbol(name, centre, span):
    if name=='circle':points=[(.5*math.cos(k*math.tau/64),.5*math.sin(k*math.tau/64)) for k in range(64)]
    elif name=='triangle':points=[(0,.5),(-.46,-.30),(.46,-.30)]
    elif name=='shield':points=[(-.42,.44),(.42,.44),(.36,-.08),(0,-.5),(-.36,-.08)]
    elif name=='diamond':points=[(0,.5),(.5,0),(0,-.5),(-.5,0)]
    elif name=='square':points=[(-.5,-.5),(.5,-.5),(.5,.5),(-.5,.5)]
    else:raise ValueError('Unknown emblem')
    return _stroke([(centre[0]+x*span,centre[1]+y*span) for x,y in points],span*.06)


def imprint(obj,text='P10',*,layout='text',span_mm=5.,depth_mm=.10,xy_mm=(0,0),rotation_deg=0.,font='sans',symbol='diamond',wear=0.,style='debossed',paths=None):
    """Boolean an imprint into a tablet, restoring the original on solver failure.

    The die floor follows the original face so wide marks remain legible on crowns.
    `cross` repeats an odd-length word on two axes, sharing the middle glyph.
    `stacked` separates lines at '/'. `custom` takes [{points:[[x,y],...],closed:bool}].
    """
    if layout not in LAYOUTS or font not in FONTS:raise ValueError('Unknown imprint layout or font')
    if style not in ('debossed','embossed'):raise ValueError('Unknown imprint style')
    if not math.isfinite(span_mm) or span_mm<=0 or not .015<=depth_mm<=.40:raise ValueError('Invalid imprint span/depth')
    if not 0<=wear<=1:raise ValueError('Imprint wear must be between zero and one')
    text=str(text);parts=[]
    if layout=='text':parts.append(_text(text,(0,0),(span_mm,span_mm*.8),font))
    elif layout=='cross':
        if len(text)%2!=1 or not 3<=len(text)<=9:raise ValueError('Cross words require 3, 5, 7 or 9 characters')
        mid=len(text)//2;cell=span_mm/len(text)
        for i,ch in enumerate(text):
            parts.append(_text(ch,((i-mid)*cell,0),(cell*.85,cell*.85),font))
            if i!=mid:parts.append(_text(ch,(0,(mid-i)*cell),(cell*.85,cell*.85),font))
    elif layout=='stacked':
        lines=text.split('/')
        if len(lines)==1:lines=[text[:max(1,len(text)//2)],text[max(1,len(text)//2):]]
        if not 2<=len(lines)<=3 or any(not line for line in lines):raise ValueError('Stacked imprint requires two or three nonempty lines')
        step=span_mm*.85/len(lines)
        for i,line in enumerate(lines):parts.append(_text(line,(0,((len(lines)-1)/2-i)*step),(span_mm,step*.75),font))
    elif layout=='boxed':
        parts.append(_symbol('square',(0,0),span_mm*.9));parts.append(_text(text,(0,0),(span_mm*.65,span_mm*.55),font))
    elif layout=='symbol_code':
        parts.append(_symbol(symbol,(-span_mm*.32,0),span_mm*.30));parts.append(_text(text,(span_mm*.16,0),(span_mm*.53,span_mm*.30),font))
    else:
        if not paths:raise ValueError('Custom imprint needs paths')
        for path in paths:parts.append(_stroke([(x*span_mm,y*span_mm) for x,y in path['points']],float(path.get('stroke',.045))*span_mm,path.get('closed',True)))
    vv=[];ff=[];c=math.cos(math.radians(rotation_deg));sn=math.sin(math.radians(rotation_deg))
    bpy.context.view_layer.update()
    for vertices,faces in parts:
        offset=len(vv);midz=(min(v[2] for v in vertices)+max(v[2] for v in vertices))/2
        for x,y,z in vertices:
            x,y=x*c-y*sn+xy_mm[0]*.001,x*sn+y*c+xy_mm[1]*.001
            irregular=noise_vector(Vector((x*18500+31,y*18500+17,4.7)))
            x+=irregular.x*.000006*wear;y+=irregular.y*.000006*wear
            hit,loc,normal,index=obj.ray_cast(Vector((x,y,1)),Vector((0,0,-1)))
            if not hit:obj['imprint_render_failed']=True;obj['imprint_failure_reason']=f'die vertex outside pill at {x*1000:.4f}, {y*1000:.4f} mm';return False
            d=depth_mm*.001*(1-.25*wear*(irregular.z+1))
            if style=='debossed':zz=loc.z-d if z<=midz else loc.z+.0008
            else:zz=loc.z-.00004 if z<=midz else loc.z+d
            vv.append((x,y,zz))
        ff.extend(tuple(i+offset for i in f) for f in faces)
    me=bpy.data.meshes.new('conformal imprint die');me.from_pydata(vv,[],ff);me.update()
    bm=bmesh.new();bm.from_mesh(me);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-8);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free()
    die=bpy.data.objects.new('temporary conformal imprint die',me);bpy.context.collection.objects.link(die);die.matrix_world=obj.matrix_world.copy()
    for material in obj.data.materials:me.materials.append(material)
    original=obj.data.copy();before=bmesh.new();before.from_mesh(original);before_volume=before.calc_volume(signed=True);before.free()
    bpy.context.view_layer.objects.active=obj;obj.select_set(True)
    mod=obj.modifiers.new('conformal '+layout+' '+style,'BOOLEAN');mod.operation='DIFFERENCE' if style=='debossed' else 'UNION';mod.solver='EXACT';mod.object=die
    try:bpy.ops.object.modifier_apply(modifier=mod.name)
    except Exception:
        if mod.name in obj.modifiers:obj.modifiers.remove(mod)
        bpy.data.objects.remove(die,do_unlink=True);bpy.data.meshes.remove(original);raise
    bpy.data.objects.remove(die,do_unlink=True)
    check=bmesh.new();check.from_mesh(obj.data);volume=check.calc_volume(signed=True)
    bad_edges=sum(not e.is_manifold for e in check.edges)
    valid=bool(check.faces) and volume>0 and bad_edges==0 and abs(volume-before_volume)>1e-15
    reason=f'volume_before={before_volume*1e9:g} volume_after={volume*1e9:g} nonmanifold={bad_edges} faces={len(check.faces)}'
    check.free()
    if not valid:
        failed=obj.data;obj.data=original;bpy.data.meshes.remove(failed);obj['imprint_render_failed']=True;obj['imprint_failure_reason']=reason;return False
    bpy.data.meshes.remove(original)
    spec=dict(text=text,layout=layout,span_mm=span_mm,depth_mm=depth_mm,xy_mm=list(xy_mm),rotation_deg=rotation_deg,font=font,symbol=symbol,wear=wear,style=style,paths=paths)
    obj['imprint']=text;obj['imprint_style']=style;obj['imprint_render_failed']=False;obj['imprint_parameters_json']=json.dumps(spec);obj['imprint_depth_mm']=depth_mm;obj['imprint_revision']='conformal_layouts_v1'
    return True
