import numpy as np
import pytest
from medtray.metrics import semantic_metrics,match_instances,instances_from_prediction
from medtray.reconcile import compare_plan
from medtray.catalogue import candidate


def test_binary_metric_does_not_penalize_confused_pill_family():
    c=np.zeros((16,16));c[2,3]=10;c[0,0]=20
    m=semantic_metrics(c);assert m['pill_binary_iou']==1;assert m['pill_class_mean_iou']==0

def test_instance_match_counts_missed_and_extra_objects():
    a=np.zeros((30,40),int);a[2:8,2:8]=10;a[12:18,2:8]=11
    b=np.zeros_like(a);b[2:8,2:8]=1;b[22:28,22:28]=2
    m=match_instances(a,b);assert (m['tp'],m['fp'],m['fn'],m['count_error'])==(1,1,1,0)

def test_empty_instance_scene():
    mask,objects=instances_from_prediction(np.zeros((32,32),int));assert not objects;assert not mask.any()

def make_plan():return {'slots':[{'name':'MORGEN','polygon_normalized':[[0,0],[1,0],[1,1],[0,1]],'expected':[{'class_id':2,'count':1}]}]}

def test_matching_appearance_never_authorizes_drug_administration():
    o=[{'instance_id':1,'class_id':2,'confidence':.99,'centroid_xy':[10,10]}];r=compare_plan(o,make_plan(),(20,20));assert r['appearance_count_match'];assert r['status']=='REVIEW_REQUIRED';assert not r['identity_verified'];assert not r['administration_authorized']

def test_uncertainty_cannot_be_silently_counted_as_a_match():
    o=[{'instance_id':1,'class_id':2,'confidence':.5,'centroid_xy':[10,10]}];r=compare_plan(o,make_plan(),(20,20));assert not r['appearance_count_match'];assert r['unresolved']

def test_invalid_plan_rejected():
    p=make_plan();p['slots'][0]['expected'][0]['count']=-1
    with pytest.raises(ValueError):compare_plan([],p,(20,20))

def test_route_filter_excludes_veterinary_and_inhalation_capsules():
    assert candidate({'Darreichungsform':'Hartkapsel','Verwendung':'Human'})
    assert not candidate({'Darreichungsform':'Hartkapsel mit Pulver zur Inhalation','Verwendung':'Human'})
    assert not candidate({'Darreichungsform':'Tablette','Verwendung':'Veterinär'})
