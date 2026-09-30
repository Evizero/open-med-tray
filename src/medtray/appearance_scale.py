"""Physical extent features shared by synthetic crops and real reference queries."""
import numpy as np

def camera_local_scale(metadata, position_m, width_pixels):
    """Area-equivalent local XY scale from a horizontal-fit, square-pixel camera.

    Unlike using just projected world-X, this remains valid at 90-degree roll.
    It is a scalar approximation of a perspective Jacobian, not rectification.
    """
    angles=np.asarray(metadata['camera_rotation_rad'],float);cx,cy,cz=np.cos(angles);sx,sy,sz=np.sin(angles)
    rx=np.array([[1,0,0],[0,cx,-sx],[0,sx,cx]])
    ry=np.array([[cy,0,sy],[0,1,0],[-sy,0,cy]])
    rz=np.array([[cz,-sz,0],[sz,cz,0],[0,0,1]])
    rotation=rz@ry@rx;origin=np.asarray(metadata['camera_position_m'],float)
    focal=metadata['focal_length_mm']/metadata['sensor_width_mm']*width_pixels
    def project(point):
        p=rotation.T@(point-origin)
        if p[2]>=0:raise ValueError('Scale point must be in front of the camera')
        return focal*p[:2]/(-p[2])
    p=np.asarray(position_m,float);uv=project(p)
    dx=project(p+[.001,0,0])-uv;dy=project(p+[0,.001,0])-uv
    area=abs(dx[0]*dy[1]-dx[1]*dy[0])
    if not np.isfinite(area) or area<=0:raise ValueError('Degenerate camera Jacobian')
    return float(1/np.sqrt(area))

def camera_project(metadata, points_m, width_pixels, height_pixels):
    """Projected coordinates in top-left normalized image space, including shifts."""
    angles=np.asarray(metadata['camera_rotation_rad'],float);cx,cy,cz=np.cos(angles);sx,sy,sz=np.sin(angles)
    rx=np.array([[1,0,0],[0,cx,-sx],[0,sx,cx]])
    ry=np.array([[cy,0,sy],[0,1,0],[-sy,0,cy]])
    rz=np.array([[cz,-sz,0],[sz,cz,0],[0,0,1]])
    camera=(np.asarray(points_m,float)-np.asarray(metadata['camera_position_m']))@(rz@ry@rx)
    focal=metadata['focal_length_mm']/metadata['sensor_width_mm']*width_pixels
    plane=camera[:,:2]/(-camera[:,2:3])*focal
    shift=metadata.get('camera_shift_xy',[0,0])
    return np.stack([.5+plane[:,0]/width_pixels-shift[0],.5-plane[:,1]/height_pixels+shift[1]*width_pixels/height_pixels],axis=-1)

def extent_features(width_pixels,height_pixels,mm_per_pixel):
    values=np.asarray([width_pixels,height_pixels,mm_per_pixel],dtype=float)
    if not np.isfinite(values).all() or np.any(values<=0):
        raise ValueError('Object dimensions and mm_per_pixel must be finite and positive')
    w,h,scale=values
    # Use unpadded object bounds. Pixel padding and capture resolution are not physical size.
    return np.asarray([w*scale/20.,h*scale/20.,min(w,h)/max(w,h)],dtype=np.float32)
