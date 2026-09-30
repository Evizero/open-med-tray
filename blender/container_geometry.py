"""Continuous moulded tray skins and clear covers; procedural priors, not CAD replicas."""
import math
import bpy
import numpy as np
import printed_graphics
import cover_wear

TEXTS={'de':['MORGEN','MITTAG','ABEND','NACHT','BEDARF','RESERVE'],'en':['MORNING','NOON','EVENING','NIGHT','AS NEEDED','RESERVE'],'fr':['MATIN','MIDI','SOIR','NUIT','SI BESOIN','RESERVE'],'it':['MATTINO','MEZZOGIORNO','SERA','NOTTE','AL BISOGNO','RISERVA']}
STYLES=['moulded_daily','thin_blister','compact_daily','adjustable','removable_inserts','four_pods']


def parameters(rng,c):
 style=c.get('preview_tray_style') or rng.choices(STYLES,[38,20,15,12,10,5])[0]
 n=c.get('preview_compartments') or (rng.choice([3,4,5]) if style=='compact_daily' else rng.choice([3,4,4,5,6]) if style=='adjustable' else 4)
 if style=='compact_daily':w=rng.uniform(.11,.15);d=rng.uniform(.039,.052);h=rng.uniform(.010,.018)
 elif style=='four_pods':w=rng.uniform(.09,.12);d=rng.uniform(.055,.075);h=rng.uniform(.010,.018);n=4
 else:w=rng.uniform(.18,.255);d=rng.uniform(.048,.072);h=rng.uniform(.009,.019)
 rim=rng.uniform(.0045,.0075);web=rng.uniform(.0012,.0035) if style in ['compact_daily','adjustable','four_pods'] else rng.uniform(.0025,.0065)
 branded=rng.random()<c.get('branding_probability',.92)
 placement=c.get('preview_brand_placement') or rng.choice(['left','right','top','bottom'])
 panel=w*rng.uniform(.12,.20) if branded and placement in ['left','right'] else 0
 # Printing on a top/bottom lip does not require an extra full-width storage band.
 if branded and placement in ['top','bottom']:rim=max(rim,.0060)
 x0,x1,y0,y1=-w/2+rim,w/2-rim,-d/2+rim,d/2-rim
 brand_panel=None
 if branded:
  if placement=='left':brand_panel=[x0+panel/2,0,panel*.9,d-2*rim];x0+=panel+web
  elif placement=='right':brand_panel=[x1-panel/2,0,panel*.9,d-2*rim];x1-=panel+web
  elif placement=='top':brand_panel=[rng.uniform(-.18,.18)*w,d/2-rim*.52,(w-2*rim)*rng.uniform(.38,.65),rim*.82]
  else:brand_panel=[rng.uniform(-.18,.18)*w,-d/2+rim*.52,(w-2*rim)*rng.uniform(.38,.65),rim*.82]
 return {'style':style,'width':w,'depth':d,'height':h,'compartments':n,'rim':rim,'web':web,'panel_width':panel if placement in ['left','right'] else 0,'branding_placement':placement if branded else None,'brand_panel':brand_panel,'well_region_bounds':[x0,y0,x1,y1],'language':c.get('preview_language') or rng.choices(list(TEXTS),[6,2,1,1])[0],'thickness':rng.uniform(.00035,.00065) if style=='thin_blister' else rng.uniform(.0007,.0013),'corner_radius':rng.uniform(.0025,.0055),'draft':rng.uniform(.0020,.0036)}



def continuous_skin(G,width,depth,wallheight,openings,mat,thickness,name='one-piece moulded tray'):
 # Shared rectilinear skin. Signed rounded-rectangle distances sculpt every well
 # into the SAME connected mesh, including the inter-well web and brand panel.
 nx=math.ceil(width/.00042);ny=math.ceil(depth/.00042)
 xx,yy=np.meshgrid(np.linspace(-width/2,width/2,nx+1),np.linspace(-depth/2,depth/2,ny+1))
 zz=np.full(xx.shape,wallheight,dtype=float)
 for x,y,w,h,r,draft in openings:
  r=min(r,w*.24,h*.24);qx=np.abs(xx-x)-(w/2-r);qy=np.abs(yy-y)-(h/2-r)
  dist=np.hypot(np.maximum(qx,0),np.maximum(qy,0))+np.minimum(np.maximum(qx,qy),0)-r
  t=np.clip((dist+draft)/draft,0,1);profile=t*t*(3-2*t)
  zz=np.minimum(zz,.00015+(wallheight-.00015)*profile)
 verts=np.stack([xx,yy,zz],-1).reshape(-1,3).tolist()
 faces=[(j*(nx+1)+i,j*(nx+1)+i+1,(j+1)*(nx+1)+i+1,(j+1)*(nx+1)+i) for j in range(ny) for i in range(nx)]
 o=G.mesh_obj(name,verts,faces,mat,1,smooth=True)
 # Apply a vertical thickness, retaining the continuous shell without separate box joints.
 mod=o.modifiers.new('continuous plastic wall thickness','SOLIDIFY');mod.thickness=thickness;mod.offset=-1;mod.use_even_offset=True
 # Border rounds only: internal smoothly sampled well walls have no hard mesh seams.
 bevel=o.modifiers.new('outer edge micro radius','BEVEL');bevel.width=.00012;bevel.segments=2;bevel.limit_method='ANGLE';bevel.angle_limit=.7
 o['container_revision']='connected_skin_v1';o['shell_thickness_mm']=thickness*1000
 return o


def build(G,rng,p,mat,ink,config=None,split=None):
 w,d,h,n,rim,web,panel=[p[k] for k in ['width','depth','height','compartments','rim','web','panel_width']]
 slots=[];openings=[];style=p['style'];lang=p['language']
 print_config=dict(config or {});header_font,_,_=printed_graphics.choose_font(rng,split,print_config.get('holdout_font_families',False))
 print_config['_time_font_file']=header_font.filepath;print_config['_time_case']='title' if rng.random()<.2 else 'upper';print_config['_time_style']=print_config.get('preview_time_style') or rng.choice(['icon_left','icon_right','text_only','icon_only','clock_and_text'])
 x0,y0,x1,y1=p['well_region_bounds'];aw,ah=x1-x0,y1-y0;mx,my=(x0+x1)/2,(y0+y1)/2
 if style=='four_pods':
  cw=(aw-web)/2;ch=(ah-web)/2
  cells=[(x0+cw/2+i*(cw+web),y1-ch/2-j*(ch+web),cw,ch) for j in range(2) for i in range(2)]
 else:
  avail=aw-(n-1)*web;weights=[rng.uniform(.80,1.20) for _ in range(n)]
  if style=='compact_daily':weights[0]*=1.5
  if style=='adjustable':weights=[rng.uniform(.7,1.45) for _ in range(n)]
  widths=[avail*a/sum(weights) for a in weights];x=x0;cells=[]
  for cw in widths:cells.append((x+cw/2,my,cw,ah));x+=cw+web
 for j,(x,y,cw,ch) in enumerate(cells):
  # Each well's floor is inset by the drafted wall; placement respects that footprint.
  draft=min(p['draft'],cw*.12,ch*.12);openings.append((x,y,cw,ch,p['corner_radius'],draft))
  names=TEXTS[lang];name=names[j] if j<len(names) else str(j+1)
  slots.append({'name':name,'language':lang,'x_min_m':x-cw/2+draft+.0004,'x_max_m':x+cw/2-draft-.0004,'y_min_m':y-ch/2+draft+.0004,'y_max_m':y+ch/2-draft-.0004,'floor_z_m':.00095 if style=='removable_inserts' else .00015})
  label_height=(rim*.77 if style!='four_pods' or j<2 else web*.78)
  label_y=y+ch/2+(rim*.47 if style!='four_pods' or j<2 else web*.48)
  # Keep time labels off the lip used for branding.
  if p['branding_placement']=='top' and style!='four_pods':label_y=y-ch/2-rim*.47
  slots[-1]['printed_header']=printed_graphics.time_label(G,rng,name,j,x,label_y,cw,label_height,h,ink,print_config,split)
 if style=='removable_inserts':
  # A manufactured frame with separate insert dishes is an explicit minority design.
  continuous_skin(G,w,d,h,[(mx,my,aw,ah,p['corner_radius'],p['draft'])],mat,p['thickness'],'outer insert carrier')
  for j,(x,y,cw,ch,r,draft) in enumerate(openings):
   # Smaller rims create intentional insert clearances; the common moulded styles do not have these.
   o=continuous_skin(G,cw-.0008,ch-.0008,h-.0006,[(0,0,cw-.0028,ch-.0028,r,draft)],mat,.00045,'removable inset dish')
   o.location=(x,y,.0008)
 else:continuous_skin(G,w,d,h,openings,mat,p['thickness'])
 return slots


def cover(G,rng,width,depth,z,collection,kind,tray_material=None,config=None):
 """Rail-supported PET sheet: edge displacement is zero, free middle bows/ripples."""
 c=config or {};film=kind=='flexible_film'
 thick=rng.uniform(.000035,.000065) if film else rng.uniform(.00035,.00085)
 rough=rng.uniform(.018,.05) if film else rng.uniform(.025,.09)
 ior=1.49 if film else 1.57
 mat=G.material('transparent flexible film' if film else 'transparent PET sliding cover',(.98,.99,1),rough,transmission=1,noise=.005)
 mat.node_tree.nodes['Principled BSDF'].inputs['IOR'].default_value=ior
 wear=cover_wear.smudges(mat,rng,width,depth,c.get('cover_smudge_probability',.8))
 shift=width*rng.uniform(.12,.60 if c.get('revision',45)>=46 else .40) if kind=='partly_open_sliding' else 0
 mode=c.get('preview_cover_profile') or rng.choices(['nearly_flat','bowed','rippled','bowed_rippled'],[12,32,22,34])[0]
 bow=rng.uniform(.00018,.0011) if film else rng.uniform(.00025,.0022)
 if mode=='nearly_flat':bow=rng.uniform(.00002,.00010)
 ripple=0 if mode in ['nearly_flat','bowed'] else bow*rng.uniform(.2,.65)
 cycles=rng.uniform(1.1,3.1);phase=rng.uniform(0,math.tau);cross_phase=rng.uniform(0,math.tau)
 nx,ny=160,64;verts=[];faces=[];heights=[];rail_span=depth-.0015;lid_width=width-.0015
 for j in range(ny+1):
  v=j/ny*2-1;y=v*rail_span/2;envelope=max(0,1-v*v)
  for i in range(nx+1):
   u=i/nx;x=(u-.5)*lid_width
   broad=bow*(.82+.18*math.cos((u-.5)*math.pi))
   wave=ripple*(.68*math.sin(cycles*math.tau*u+phase)+.32*math.sin(1.7*math.tau*u+1.4*v+cross_phase))
   fine=(.00009 if film else .000025)*math.sin(u*math.tau*7.3+v*2+phase) if mode in ['rippled','bowed_rippled'] else 0
   dz=envelope*max(0,broad+wave+fine)
   zz=z+.00080+dz;verts.append((x+shift,y,zz));heights.append(dz)
 for j in range(ny):
  for i in range(nx):a=j*(nx+1)+i;faces.append((a,a+1,a+nx+2,a+nx+1))
 o=G.mesh_obj('rail constrained '+mode+' cover',verts,faces,mat,2,smooth=True)
 o['cover_revision']='rail_bow_ripple_v45';o['rail_span_m']=rail_span
 for coll in list(o.users_collection):coll.objects.unlink(o)
 collection.objects.link(o);mod=o.modifiers.new('transparent sheet thickness','SOLIDIFY');mod.thickness=thick;mod.offset=0
 # Rails belong to the tray, stay fixed when the lid slides, and remain class 1.
 if not film:
  for yy in [-depth/2+.00025,depth/2-.00025]:
   G.cube('stationary moulded cover rail',(0,yy,z+.00055),(width,.0010,.0011),tray_material or mat,1,.00018)
 if not film and c.get('revision',45)>=46:
  grip=G.cube('sliding cover finger grip',(width/2+shift-.007,0,z+.0014),(.004,depth*.20,.0015),mat,2,.0007)
  for coll in list(grip.users_collection):coll.objects.unlink(grip)
  collection.objects.link(grip)
 edge=[verts[k][2] for k in list(range(nx+1))+list(range(ny*(nx+1),(ny+1)*(nx+1)))]
 assert max(edge)-min(edge)<1e-10
 return {'kind':kind,'revision':'rail_bow_ripple_v45','profile':mode,'thickness_mm':thick*1000,'roughness':rough,'displacement_mm':shift*1000,'bow_mm':bow*1000,'ripple_amplitude_mm':ripple*1000,'ripple_cycles':cycles,'phase_rad':phase,'cross_phase_rad':cross_phase,'smudges':wear,'ior':ior,'maximum_lift_mm':max(heights)*1000,'rail_edge_height_range_mm':(max(edge)-min(edge))*1000,'support':'two stationary long-edge rails' if not film else 'film resting on long-edge rims','geometric_model':'analytic displacement prior; not finite-element mechanics'}
