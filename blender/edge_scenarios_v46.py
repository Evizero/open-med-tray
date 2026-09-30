"""Opt-in rare acquisition failures; sampled separately from the ordinary corpus.

These are procedural stress priors, not dispensing prevalence or rigid-body physics.
No photographic pixels or target-free cutout pasting is used.
"""
import math
import random
from mathutils import Vector, Quaternion
from bpy_extras.object_utils import world_to_camera_view
import bpy

SCENARIOS = ['sparse_frame', 'dense_wells', 'table_spill', 'table_scatter',
             'heavy_labels', 'lid_occlusion', 'cropped_frame', 'mixed_overload']


def configure(config, index, split):
    c = dict(config)
    rng = random.Random(c['seed'] + index + 55687 + {'train':0,'val':1000000,'test':2000000,'stress':3000000,'preview':4000000}[split])
    kinds = c.get('edge_scenarios', SCENARIOS)  # v4.9 opt-in subset; default unchanged
    kind = kinds[index % len(kinds)]
    c.update(edge_scenario=kind, stress_factor='edge_' + kind, empty_probability=0,
             edge_roll_deg=(index * 137.507764 + rng.uniform(-12, 12)) % 360,
             edge_anchor=index % 9, edge_frame_fill=rng.uniform(.62, .90),
             max_stack_height_mm=14, spill_fraction=0,
             preview_lighting=rng.choice(['window_daylight','overcast','indoor','mixed_light','chamber_diffuse']))
    if kind == 'sparse_frame':
        c.update(pills_per_scene=[1, 3], edge_frame_fill=rng.uniform(.45,.65))
    elif kind == 'dense_wells':
        c.update(pills_per_scene=[32,48], preview_tray_style='moulded_daily', preview_cover='none', preview_film=False)
    elif kind == 'table_spill':
        c.update(pills_per_scene=[10,20], spill_fraction=.45, preview_cover='none', preview_film=False)
    elif kind == 'table_scatter':
        c.update(pills_per_scene=[22,36], spill_fraction=.80, preview_cover='none', preview_film=False,
                 preview_lighting=rng.choice(['window_daylight','overcast','indoor']), edge_frame_fill=rng.uniform(.68,.89))
    elif kind == 'heavy_labels':
        c.update(pills_per_scene=[12,22], preview_tray_style='moulded_daily', preview_cover='rigid_sliding', preview_film=True,
                 sticker_probability=1, sticker_count=3, sticker_force_cover=True, sticker_large=True, sticker_central=True)
    elif kind == 'lid_occlusion':
        c.update(pills_per_scene=[14,26], preview_tray_style='rigid_organizer', preview_cover='hinged_single',
                 preview_lid_angle=rng.uniform(8,50), preview_film=True, preview_container='tinted_clear',
                 sticker_probability=1, sticker_count=2, sticker_force_cover=True, sticker_large=True)
    elif kind == 'cropped_frame':
        c.update(pills_per_scene=[8,18], edge_frame_fill=.96, edge_crop=True)
    else:
        c.update(pills_per_scene=[40,58], spill_fraction=.35, preview_tray_style='moulded_daily',
                 preview_cover='rigid_sliding', preview_film=True, sticker_probability=1, sticker_count=2,
                 sticker_force_cover=True, sticker_large=True, debris_probability=1, fragment_probability=.8)
    return c


def support_regions(slots, p, c):
    """Four nonintersecting table strips outside the outer tray footprint."""
    for sp in slots:
        sp['region_kind']='tray';sp['counts_as_compartment']=True
    c['tray_compartments']=len(slots)
    if not c.get('spill_fraction',0):return slots
    w,d=p['width'],p['depth'];gap=.005;reach=.055
    floor=.00011-p['thickness']  # exact top of generate.py's six-mm worktop
    regions=[(-w/2-reach,-w/2-gap,-d/2,d/2),
             (w/2+gap,w/2+reach,-d/2,d/2),
             (-w/2-reach,w/2+reach,d/2+gap,d/2+reach),
             (-w/2-reach,w/2+reach,-d/2-reach,-d/2-gap)]
    for x0,x1,y0,y1 in regions:
        slots.append(dict(index=len(slots),x_min_m=x0,x_max_m=x1,y_min_m=y0,y_max_m=y1,
                          floor_z_m=floor,region_kind='table',counts_as_compartment=False))
    return slots


def slot_plan(rng,count,slots,c,default):
    plan=list(default);n=c['tray_compartments']
    number=min(count,max(1,round(count*c['spill_fraction']))) if c.get('spill_fraction',0) else 0
    for k in rng.sample(range(count),number):plan[k]=n+rng.randrange(4)
    return plan


def frame_camera(scene,cam,c,bounds):
    """Full roll, legal off-centre compositions, plus an explicitly cropped subset."""
    # Preserve the acquired view direction; roll around the camera's own optical axis.
    cam.rotation_euler=(cam.rotation_euler.to_quaternion() @ Quaternion((0,0,1),math.radians(c['edge_roll_deg']))).to_euler()
    def points():
        bpy.context.view_layer.update()
        return [world_to_camera_view(scene,cam,Vector((x,y,z))) for lo,hi in bounds
                for x in [lo[0],hi[0]] for y in [lo[1],hi[1]] for z in [lo[2],hi[2]]]
    def box():
        q=points();return [min(p.x for p in q),min(p.y for p in q),max(p.x for p in q),max(p.y for p in q)]
    b=box();span=max(b[2]-b[0],b[3]-b[1]);cam.data.lens*=c['edge_frame_fill']/span
    b=box();center=[(b[0]+b[2])/2,(b[1]+b[3])/2]
    ax,ay=c['edge_anchor']%3-1,c['edge_anchor']//3-1
    margin=[max(0,(1-(b[2]-b[0]))/2-.025),max(0,(1-(b[3]-b[1]))/2-.025)]
    desired=[.5+ax*margin[0],.5+ay*margin[1]]
    if c.get('edge_crop'):
        # Deliberately crop a limited part of one boundary; targets remain visible-only.
        axis=0 if b[2]-b[0]>=b[3]-b[1] else 1
        desired[axis]=.5+(-1 if c['edge_anchor']%2 else 1)*(.07+margin[axis])
    # Measure shift sensitivity instead of assuming Blender's sensor-fit convention.
    for axis,attr in [(0,'shift_x'),(1,'shift_y')]:
        before=box();before_center=(before[axis]+before[axis+2])/2
        old=getattr(cam.data,attr);setattr(cam.data,attr,old+.1)
        after=box();slope=((after[axis]+after[axis+2])/2-before_center)/.1
        setattr(cam.data,attr,old+(desired[axis]-before_center)/slope)
    b=box()
    return dict(scenario=c['edge_scenario'],roll_added_deg=c['edge_roll_deg'],anchor_grid_index=c['edge_anchor'],
                requested_extent=c['edge_frame_fill'],projected_bounds_xyxy_bottom_up=b,
                intentional_crop=bool(c.get('edge_crop')),shift_x=cam.data.shift_x,shift_y=cam.data.shift_y,
                scope='Additional rare stress scenes; visible labels, no amodal or hidden-pill counting')
