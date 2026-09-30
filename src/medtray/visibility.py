"""Visibility priors from known geometry, not an optical readability certification."""
import math

def score_is_presented(obj):
    return bool(obj.get('score',0) and (obj.get('face_up',True) or obj.get('score_faces')=='both'))

def imprint_is_presented(obj):
    if not obj.get('imprint_rendered'):return False
    if obj.get('family') in ['hard_capsule','softgel']:return math.cos(math.radians(obj.get('pose',{}).get('roll_deg',0)))>.25
    return obj.get('face_up',True)
