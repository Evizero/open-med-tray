"""Rotation/calibration and evaluation accounting, without a GPU or training run."""
import ast
import json
from collections import Counter, defaultdict
from pathlib import Path
from types import SimpleNamespace

import numpy as np
from PIL import Image

from medtray.appearance_scale import camera_local_scale, camera_project
from medtray.metrics import match_instances

ROOT=Path(__file__).resolve().parents[1]


def test_scale_is_stable_across_camera_roll_and_resolution():
    meta=dict(camera_position_m=[0,0,.15],focal_length_mm=5,sensor_width_mm=6.4)
    for angle in np.linspace(-np.pi,np.pi,17):
        meta['camera_rotation_rad']=[0,0,float(angle)]
        np.testing.assert_allclose(camera_local_scale(meta,[0,0,0],768),.25,rtol=1e-10)
        np.testing.assert_allclose(camera_local_scale(meta,[0,0,0],1536),.125,rtol=1e-10)
    meta.update(camera_rotation_rad=[0,0,np.pi/2],camera_shift_xy=[.1,-.05])
    points=camera_project(meta,[[0,0,0],[.001,0,0]],768,384)
    np.testing.assert_allclose(points[0],[.4,.4],atol=1e-12)
    np.testing.assert_allclose(points[1]-points[0],[0,4/384],atol=1e-12)


def _function(path,name,namespace):
    # Evaluate the actual accounting function, without importing its job-running
    # module (which intentionally executes TensorFlow model evaluation at top level).
    tree=ast.parse(path.read_text());fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==name)
    exec(compile(ast.Module(body=[fn],type_ignores=[]),str(path),'exec'),namespace)
    return namespace[name]


def test_exact_ink_and_appearance_slices_keep_distinct_denominators(tmp_path):
    rows=[];predictions=[]
    for index in range(3):
        f=tmp_path/f'{index:05d}.json';ids=np.zeros((256,512),np.uint16);sem=np.zeros_like(ids,np.uint8)
        objects=[];obs=[];predids=np.zeros_like(ids)
        if index==0:
            for iid,cls,area in [(10,2,(20,30,20,30)),(11,7,(50,60,50,60))]:
                y0,y1,x0,x1=area;ids[y0:y1,x0:x1]=iid;sem[y0:y1,x0:x1]=cls;predids[y0:y1,x0:x1]=iid
                objects.append(dict(instance_id=iid,class_id=cls,family='round_flat' if cls==2 else 'softgel',finish='chalky_uncoated' if cls==2 else 'softgel_shell',color_family='red' if cls==2 else 'blue',two_tone=False,placement_region='table' if cls==2 else 'tray',softgel_parameters={'shape':'oval'},softgel_opacity='translucent'))
                obs.append(dict(instance_id=iid,class_id=2 if cls==2 else 4))
        elif index==2:
            ids[10:13,10:13]=10;sem[10:13,10:13]=2
            objects.append(dict(instance_id=10,class_id=2,family='round_flat',finish='chalky_uncoated',color_family='white'))
        ids[100:110,200:210]=900;sem[100:110,200:210]=1
        predsem=sem.copy()
        if index<2:
            predids[100:110,200:210]=50;predsem[100:110,200:210]=2;obs.append(dict(instance_id=50,class_id=2))
        if index==0:
            predids[160:170,300:310]=51;predsem[160:170,300:310]=2;obs.append(dict(instance_id=51,class_id=2))
        Image.fromarray(ids).save(f.with_name(f.stem+'_instance.png'))
        f.write_text(json.dumps(dict(objects=objects,printed_graphics=[{'instance_id':900,'kind':'branding_ink'}],lighting='indoor',container_geometry={'style':'moulded_daily'},cover={'kind':'none'},tray_branding={'font_family':'fixture','layout':'wordmark','logo':'ring'},config={},dataset_component='fixture')))
        rows.append((np.zeros((256,512,3),np.uint8),sem,{},f));predictions.append((predsem,predids,obs))
    namespace={'np':np,'json':json,'Image':Image,'Counter':Counter,'defaultdict':defaultdict,'match_instances':match_instances,'D':tmp_path,'GROUP':{2:'round',4:'elongated',7:'softgel'}}
    summarize=_function(ROOT/'src/medtray/tf_panoptic_v46.py','summarize',namespace)
    module=SimpleNamespace(load_data=lambda *a:rows,batch=lambda _,indices:(np.array(list(indices)),None,None),decode=lambda out,_:predictions[int(out['index'])],summarize=summarize)
    class Tensor:
        def __init__(self,a):self.a=a
        def numpy(self):return self.a
    def model(x,training=False):return {'index':Tensor(x)}
    result=_function(ROOT/'scripts/evaluate_v46.py','detail',namespace)(model,module,'train',.3,'fixture')
    assert result['instances']['instance_recall_iou50']==1
    assert result['instances']['instance_precision_iou50']==.4
    assert result['instances']['matched_family_accuracy']==.5
    assert result['unmatched_fp_tags']=={'print-associated':2,'background/other':1}
    assert result['empty_images']==2 and result['empty_candidates']==1
    assert result['size_bins']['ineligible <10px']=={'objects':1,'matched':0}
    assert result['object_slices']['color_family']['red']['matched_family_accuracy']==1
    assert result['object_slices']['softgel_opacity']['translucent']['matched_family_accuracy']==0
    assert result['object_slices']['placement_region']['table']['eligible_objects']==1
    np.testing.assert_allclose(result['print_pixel_false_positive_rate'],2/3)
    np.testing.assert_allclose(result['slices']['branding_font']['fixture']['print_pixel_false_positive_rate'],2/3)
