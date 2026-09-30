"""Combinatorial flat tray printing, including pill-like HARD NEGATIVES.
All artwork is fictional. Shape, typography and layout are rendering priors.
Fonts are bundled with their OFL licenses. Graphics remain semantic class 1.
"""
import hashlib
import math
import random
from pathlib import Path
import bpy
from mathutils import Matrix, Vector

ROOT=Path(__file__).parent
PREFIXES='Ael Aer Aev Alba Alme Alva Ama Ambe Anno Arca Arde Aris Arno Asto Auro Avena Bel Ber Biora Brin Cael Calda Care Cera Ceti Cinna Civa Clara Cor Cora Dela Dena Doria Eira Ela Elbe Elio Elva Ena Enna Erda Evia Fara Fel Fena Fior Flora Gala Gena Hela Helio Hera Hira Ilma Inna Iona Iris Isla Jora Jura Kaia Kera Kora Lavo Leda Lena Liora Luma Luno Mael Mara Mera Mira Mora Nara Nela Nera Niva Nora Nova Olia Onda Oria Orto Ovia Pela Pera Pharo Pina Prima Qara Rena Riva Rosa Sela Sena Sera Sil Sol Sora Tala Tera Tilia Tiva Ulma Una Vala Vela Vera Vero Vesta Viora Vita Wela Wera Xela Yara Zela Zora'.split()
SUFFIXES='care med vita nova sana vera vale ria lis len nor ser tel dor mera niva phar von riaxis lino vano tera mia lora cura line well fort avia tena vera lumen ora nel velle arco vera mela fara nessa tira vian selis haven valeon'.split()
DESCRIPTORS=['APOTHEKE','PHARMA SERVICE','GESUNDHEIT & PFLEGE','MEDIZINTECHNIK','KLINIKVERSORGUNG','ARZNEI · SERVICE','CARE SYSTEMS','PHARMACIE','FARMACIA','MEDICAZIONE','ZORG & WELZIJN','PFLEGE ZUHAUSE','DISPENSING SYSTEMS','THERAPIE & VITALITÄT','ARZNEIMITTEL LOGISTIK','PATIENTEN SERVICE','SINCE 1984','EST. 1996','']
LOGOS=['capsule','scored_tablet','pill_cluster','cross_ring','monogram','bowl','leaf','orbit','interlocking_rings','shield','sunburst','wave','diamond']
LAYOUTS=['stacked','logo_left','logo_right','seal','split_word','wordmark','logo_below','vertical_wordmark']
HELDOUT_FAMILIES={'greatvibes','orbitron','comicneue','cinzel'}


def font_paths(split=None,holdout=False):
    files=sorted((ROOT/'fonts/branding_static').glob('*/*.ttf'))
    assert files,'Run scripts/fetch_branding_fonts.py before generating this revision.'
    if holdout:
        files=[f for f in files if (f.parent.name in HELDOUT_FAMILIES)==(split=='stress')]
    return files

def choose_font(rng,split=None,holdout=False):
    files=font_paths(split,holdout);family=rng.choice(sorted({p.parent.name for p in files}));p=rng.choice([p for p in files if p.parent.name==family]);return bpy.data.fonts.load(str(p),check_existing=True),p.parent.name,p.name

def mark(o,kind,**attrs):
    o['graphic_kind']=kind
    for key,value in attrs.items():o['graphic_'+key]=value
    return o

def polygon(G,name,xy,mat,kind='brand_logo'):
    return mark(G.mesh_obj('printed '+name,[(x,y,0) for x,y in xy],[tuple(range(len(xy)))],mat,1,smooth=False),kind,design=name)

def disk(G,c,r,mat,kind='brand_logo'):
    return polygon(G,'disc',[(c[0]+r*math.cos(t*math.tau/48),c[1]+r*math.sin(t*math.tau/48)) for t in range(48)],mat,kind)

def stroke(G,name,points,width,mat,kind='brand_logo',closed=False):
    # Flat ribbon: no bevelled 3-D tubing masquerading as printed ink.
    vv=[];ff=[];n=len(points)
    for i,p in enumerate(points):
        prev=Vector(points[(i-1)%n] if closed or i else p);nxt=Vector(points[(i+1)%n] if closed or i<n-1 else p)
        t=nxt-prev;t.normalize();normal=Vector((-t.y,t.x))*width*.5
        vv.extend([(p[0]+normal.x,p[1]+normal.y,.0000003),(p[0]-normal.x,p[1]-normal.y,.0000003)])
    for i in range(n if closed else n-1):j=(i+1)%n;ff.append((2*i,2*i+1,2*j+1,2*j))
    return mark(G.mesh_obj('printed '+name,vv,ff,mat,1,smooth=False),kind,design=name)

def circle(G,c,r,width,mat,kind='brand_logo'):
    return stroke(G,'ring',[(c[0]+r*math.cos(i*math.tau/64),c[1]+r*math.sin(i*math.tau/64)) for i in range(64)],width,mat,kind,True)

def glyph(G,rng,design,c,r,mat,accent=None,kind='brand_logo'):
    accent=accent or mat;before=set(bpy.data.objects);cx,cy=c
    if design in ['sun','sunrise','sunset','sunburst']:
        circle(G,c,r*.49,r*.095,mat,kind)
        count=rng.choice([8,10,12])
        for i in range(count):
            a=i*math.tau/count
            if design in ['sunrise','sunset'] and math.sin(a)<0:continue
            stroke(G,'ray',[(cx+r*.68*math.cos(a),cy+r*.68*math.sin(a)),(cx+r*math.cos(a),cy+r*math.sin(a))],r*.10,mat,kind)
        if design in ['sunrise','sunset']:stroke(G,'horizon',[(cx-r,cy-r*.2),(cx+r,cy-r*.2)],r*.13,mat,kind)
    elif design=='moon':
        # Crescent bounded by two arcs, triangulated as a ribbon (not concave ngon).
        pts=[(cx+math.cos(-math.pi/2+i*math.pi/40)*r,cy+math.sin(-math.pi/2+i*math.pi/40)*r) for i in range(41)]
        vv=[];ff=[]
        for i,p in enumerate(pts):vv.extend([(p[0],p[1],0),(cx+(p[0]-cx)*.28-r*.18,p[1],0)])
        for i in range(40):ff.append((2*i,2*i+1,2*i+3,2*i+2))
        mark(G.mesh_obj('printed crescent',vv,ff,mat,1,smooth=False),kind,design=design)
    elif design in ['clock','scored_tablet','cross_ring','orbit','interlocking_rings']:
        if design=='scored_tablet':disk(G,c,r,mat,kind);stroke(G,'tablet score',[(cx-r*.7,cy),(cx+r*.7,cy)],r*.15,accent,kind)
        else:circle(G,c,r,r*.13,mat,kind)
        if design=='clock':
            stroke(G,'clock hands',[(cx-r*.15,cy+r*.62),(cx,cy),(cx+r*.57,cy-r*.17)],r*.15,mat,kind)
            for j in range(12):
                a=j*math.tau/12;disk(G,(cx+r*.78*math.cos(a),cy+r*.78*math.sin(a)),r*.055,mat,kind)
        elif design=='cross_ring':
            stroke(G,'cross vertical',[(cx,cy-r*.6),(cx,cy+r*.6)],r*.25,mat,kind);stroke(G,'cross horizontal',[(cx-r*.6,cy),(cx+r*.6,cy)],r*.25,mat,kind)
        elif design=='orbit':
            stroke(G,'orbit swoosh',[(cx+r*1.3*math.cos(a),cy+r*.45*math.sin(a)) for a in [i*math.tau/64 for i in range(64)]],r*.12,accent,kind,True)
        elif design=='interlocking_rings':circle(G,(cx+r*.8,cy),r*.72,r*.17,accent,kind)
    elif design in ['capsule','pill_cluster']:
        a=rng.uniform(-.9,.9);co,si=math.cos(a),math.sin(a)
        def tr(x,y):return (cx+co*x-si*y,cy+si*x+co*y)
        for side in [-1,1]:
            arc=[(side*r*.55+r*.65*math.cos(t),r*.65*math.sin(t)) for t in ([math.pi/2+i*math.pi/32 for i in range(33)] if side==-1 else [-math.pi/2+i*math.pi/32 for i in range(33)])]
            xy=([(0,r*.65)]+arc+[(0,-r*.65)]) if side==-1 else ([(0,-r*.65)]+arc+[(0,r*.65)])
            polygon(G,'capsule half',[tr(x,y) for x,y in xy],mat if side==-1 else accent,kind)
        if design=='pill_cluster':circle(G,(cx-r*.6,cy-r),r*.65,r*.15,mat,kind)
    elif design=='bowl':
        stroke(G,'pharmacy bowl',[(cx+r*math.cos(math.pi+i*math.pi/40),cy+r*.5*math.sin(math.pi+i*math.pi/40)) for i in range(41)],r*.13,mat,kind)
        stroke(G,'bowl stem',[(cx,cy-r*.5),(cx,cy-r),(cx+r*.55,cy-r)],r*.13,mat,kind)
        stroke(G,'serpentine',[(cx+r*.35*math.sin(i*math.pi*2/40),cy+r*(.95-i*.027)) for i in range(41)],r*.13,accent,kind)
    elif design=='leaf':
        stroke(G,'leaf outline',[(cx+r*math.sin(t),cy+r*math.cos(t)*1.1) for t in [i*math.tau/64 for i in range(64)]],r*.10,mat,kind,True)
        stroke(G,'leaf vein',[(cx-r*.3,cy-r),(cx+r*.2,cy+r)],r*.11,mat,kind)
    elif design=='shield':polygon(G,'shield',[(cx-r,cy+r),(cx+r,cy+r),(cx+r*.75,cy-r*.2),(cx,cy-r),(cx-r*.75,cy-r*.2)],mat,kind)
    elif design=='wave':
        for j in range(3):stroke(G,'wave',[(cx-r+i*r/20,cy+(j-1)*r*.43+r*.18*math.sin(i*.18)) for i in range(41)],r*.10,mat,kind)
    else:polygon(G,'diamond',[(cx,cy+r),(cx+r,cy),(cx,cy-r),(cx-r,cy)],mat,kind)
    return list(set(bpy.data.objects)-before)

def name(rng):
    base=rng.choice(PREFIXES)+rng.choice(SUFFIXES)
    style=rng.randrange(7)
    if style==0:base+=' '+rng.choice(['Care','Med','Pharma','Health','Vital','Plus','Clinic','Nord','West','Stadt','Team'])
    elif style==1:base=rng.choice(['Apotheke','Pharmacie','Farma','Klinik'])+' '+base
    elif style==2:base+=' & '+rng.choice(PREFIXES)+rng.choice(SUFFIXES)
    elif style==3:base=rng.choice(PREFIXES)+'-'+base
    return base.upper() if rng.random()<.42 else base.lower() if rng.random()<.12 else base

def branding(G,rng,panel,z,ink,config=None,split=None):
    c=config or {};cx,cy,w,h=panel;word=c.get('brand_name') or name(rng)
    font,family,filename=choose_font(rng,split,c.get('holdout_font_families',False))
    if c.get('brand_font_path'):
        ff=Path(c['brand_font_path']);font=bpy.data.fonts.load(str(ff),check_existing=True);family=ff.parent.name;filename=ff.name
    descriptor=rng.choice(DESCRIPTORS);domain=''.join(ch for ch in word.lower() if ch.isascii() and ch.isalpha())+'.example'
    bl=c.get('preview_brand_layout');layout=rng.choice(bl) if isinstance(bl,list) else bl or rng.choice(LAYOUTS if h>w*.45 else ['logo_left','logo_right','wordmark','split_word'])  # v4.9: list option
    pl=c.get('preview_logo');logo=rng.choice(pl) if isinstance(pl,list) else pl or rng.choice(LOGOS)  # v4.9: list = random pill-like subset
    shallow=h<w*.12
    if shallow and layout not in ['logo_left','logo_right','wordmark']:layout=rng.choice(['logo_left','logo_right','wordmark'])
    palette=[(.012,.017,.025),(.018,.037,.11),(.015,.085,.054),(.14,.018,.032),(.08,.04,.13)]
    if c.get('light_ink'):palette=[(.9,.93,.9),(.78,.84,.9),(.94,.88,.69)]
    main=G.material('flat branding ink',rng.choice(palette),rng.uniform(.4,.7),noise=0)
    accent=G.material('second printed ink',rng.choice([(.22,.40,.46),(.55,.28,.08),(.16,.39,.23),(.55,.11,.19),(.65,.69,.71)]),.6,noise=0)
    before=set(bpy.data.objects);textrows=[]
    def text(body,xy,size,kind='brand_text',selected_font=font):
        if not body:return None
        o=G.text_obj(body,(*xy,0),size,main,1);o.data.font=selected_font;o.data.extrude=0;o.data.space_character=rng.uniform(.88,1.25)
        mark(o,kind,text=body,font=filename,family=family);textrows.append(o);return o
    main_size=rng.uniform(.010,.018)
    lines=word.split(' & ') if layout=='split_word' else [word]
    if layout=='split_word' and len(lines)==1:
        mid=max(3,len(word)//2);lines=[word[:mid],word[mid:]]
    main_objs=[text(s,(0,-j*main_size*.82),main_size) for j,s in enumerate(lines)]
    bpy.context.view_layer.update();bw=max(o.dimensions.x for o in main_objs);ybottom=-(len(lines)-1)*main_size*.82
    desc_size=main_size*rng.uniform(.22,.45)
    if not shallow and (layout not in ['wordmark','vertical_wordmark'] or rng.random()<.45):
        text(descriptor,(0,ybottom-main_size*.85),desc_size)
        if rng.random()<.65:text(domain,(0,ybottom-main_size*1.38),desc_size*rng.uniform(.65,.9))
    rr=main_size*rng.uniform(.75,1.7) if c.get('revision',45)>=46 else main_size*rng.uniform(.58,1.2)
    if layout not in ['wordmark','vertical_wordmark']:
        pos=((-bw/2-rr*1.6,ybottom/2) if layout=='logo_left' else (bw/2+rr*1.6,ybottom/2) if layout=='logo_right' else (0,ybottom-main_size*2.8) if layout=='logo_below' else (0,main_size*1.55))
        if logo=='monogram':
            text(''.join(s[0] for s in word.split()[:2]),pos,rr*2.5,'brand_logo')
            circle(G,pos,rr*1.5,rr*.08,accent)
        else:glyph(G,rng,logo,pos,rr,main,accent)
    if layout=='seal':
        # An enclosure adds a genuinely different silhouette, not another small diamond.
        bpy.context.view_layer.update();pts=[o.matrix_world@Vector(v) for o in set(bpy.data.objects)-before for v in o.bound_box]
        xmin,xmax=min(v.x for v in pts),max(v.x for v in pts);ymin,ymax=min(v.y for v in pts),max(v.y for v in pts)
        stroke(G,'brand cartouche',[(xmin-.003,ymin-.003),(xmax+.003,ymin-.003),(xmax+.003,ymax+.003),(xmin-.003,ymax+.003)],.0005,main,closed=True)
    objects=list(set(bpy.data.objects)-before);bpy.context.view_layer.update()
    angle=(math.pi/2 if layout=='vertical_wordmark' else rng.choice([0,0,0,0,-.06,.06]))
    rotate=Matrix.Rotation(angle,4,'Z')
    for o in objects:o.matrix_world=rotate@o.matrix_world
    bpy.context.view_layer.update();pts=[o.matrix_world@Vector(v) for o in objects for v in o.bound_box]
    x0,x1=min(v.x for v in pts),max(v.x for v in pts);y0,y1=min(v.y for v in pts),max(v.y for v in pts)
    scale=min(w*rng.uniform(.64,.94)/max(x1-x0,1e-6),h*rng.uniform(.56,.90)/max(y1-y0,1e-6))
    slackx=max(0,w-(x1-x0)*scale);slacky=max(0,h-(y1-y0)*scale)
    center=(cx+rng.uniform(-.3,.3)*slackx,cy+rng.uniform(-.34,.34)*slacky)
    transform=Matrix.Translation((center[0],center[1],z+.000004))@Matrix.Diagonal((scale,scale,1,1))@Matrix.Translation((-(x0+x1)/2,-(y0+y1)/2,0))
    for o in objects:o.matrix_world=transform@o.matrix_world
    bpy.context.view_layer.update()
    return {'revision':'diverse_print_v45','fictional':True,'company_name':word,'font_family':family,'font_file':filename,'layout':layout,'logo':logo if layout not in ['wordmark','vertical_wordmark'] else 'none','lines':[{'text':o.data.body,'font':filename,'position_m':list(o.location),'nominal_font_size_mm':o.data.size*o.scale.x*1000} for o in textrows],'panel_bounds_m':[cx-w/2,cy-h/2,cx+w/2,cy+h/2],'semantic_class_id':1,'instance_id':1,'kind':'printed_ink','no_product_identity':True,'design_hash':hashlib.sha256((word+filename+layout+logo+str(center)).encode()).hexdigest()[:16]}

def time_label(G,rng,name,index,x,y,width,height,z,ink,config=None,split=None):
    c=config or {}
    if c.get('_time_font_file'):
        path=Path(c['_time_font_file']);font=bpy.data.fonts.load(str(path),check_existing=True);family=path.parent.name;filename=path.name
    else:font,family,filename=choose_font(rng,split,c.get('holdout_font_families',False))
    before=set(bpy.data.objects)
    style=c.get('_time_style') or c.get('preview_time_style') or rng.choice(['icon_left','icon_right','text_only','icon_only','clock_and_text'])
    icon=rng.choice([['sunrise','clock','sun'],['sun','clock','scored_tablet'],['sunset','clock','sun'],['moon','clock'],['cross_ring','capsule'],['clock','moon']][index%6])
    radius=min(height*.31,width*.07)*rng.uniform(.8,1.15)
    label=name.title() if c.get('_time_case')=='title' else name
    if style=='clock_and_text':icon='clock'
    if style!='icon_only':
        o=G.text_obj(label,(0,0,0),height*rng.uniform(.56,.85),ink,1);o.data.font=font;o.data.extrude=0
        mark(o,'time_label',text=label,font=filename,family=family);bpy.context.view_layer.update();textw=o.dimensions.x
    else:textw=0
    if style!='text_only':
        ix=0 if style=='icon_only' else (-textw/2-radius*1.8 if style!='icon_right' else textw/2+radius*1.8)
        glyph(G,rng,icon,(ix,0),radius,ink,kind='time_icon')
    objects=list(set(bpy.data.objects)-before);bpy.context.view_layer.update();pts=[o.matrix_world@Vector(v) for o in objects for v in o.bound_box]
    x0,x1=min(v.x for v in pts),max(v.x for v in pts);y0,y1=min(v.y for v in pts),max(v.y for v in pts)
    scale=min(1,width*.94/max(x1-x0,1e-6),height*.94/max(y1-y0,1e-6))
    tr=Matrix.Translation((x,y,z+.000004))@Matrix.Diagonal((scale,scale,1,1))@Matrix.Translation((-(x0+x1)/2,-(y0+y1)/2,0))
    for o in objects:o.matrix_world=tr@o.matrix_world;o['graphic_slot']=index
    return {'style':style,'icon':icon if style!='text_only' else None,'text':label if style!='icon_only' else None,'font':filename,'font_family':family,'position_m':[x,y,z+.000004]}

def register(lookup):
    records=[];bpy.context.view_layer.update()
    for j,o in enumerate(sorted((o for o in bpy.data.objects if o.get('graphic_kind')),key=lambda o:o.name)):
        iid=1000+j;assert iid<32767;o.pass_index=iid;lookup[iid]=1
        pts=[o.matrix_world@Vector(v) for v in o.bound_box]
        records.append({'instance_id':iid,'class_id':1,'kind':o['graphic_kind'],'object_name':o.name,'world_bounds_m':[[min(v[a] for v in pts) for a in range(3)],[max(v[a] for v in pts) for a in range(3)]],'attributes':{k[8:]:o[k] for k in o.keys() if k.startswith('graphic_')},'counts_as_pill':False})
    return records
