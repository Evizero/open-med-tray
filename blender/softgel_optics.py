"""Beer-Lambert mapping of nominal linear RGB transmittance to Cycles absorption.

Cycles extinction is (1 - node_color) * node_density (per metre). Input color
specifies transmittance at an8mm reference path and density control150. Reference
length and density are design controls, not measured pharmaceutical properties.
"""
import math

def absorption_parameters(color,density,reference_path_mm=8.,reference_density=150.):
    scale=max(0.,density)/reference_density
    coefficients=[-math.log(min(.995,max(.002,float(c))))/(reference_path_mm/1000)*scale for c in color]
    peak=max(coefficients)
    return dict(node_color=[1-c/peak for c in coefficients] if peak>0 else [1.,1.,1.],node_density=peak,coefficients_per_m=coefficients,reference_path_mm=reference_path_mm,reference_density=reference_density,input_color_semantics='nominal linear RGB transmittance at reference path/density; opaque shell color is diffuse albedo')
