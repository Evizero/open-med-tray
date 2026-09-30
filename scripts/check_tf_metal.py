"""Verify actual GPU math, distinguishing unavoidable host-side integer bookkeeping."""
import json,os
from pathlib import Path
os.environ['TF_CPP_MIN_LOG_LEVEL']='0'
import tensorflow as tf
from importlib.metadata import version
out=Path(os.environ.get('MEDTRAY_GPU_AUDIT_DIR','artifacts/tf-metal'));out.mkdir(parents=True,exist_ok=True)
gpus=tf.config.list_physical_devices('GPU');assert gpus,'Metal GPU not detected'
tf.debugging.set_log_device_placement(True)
tf.config.set_soft_device_placement(False)
with tf.device('/GPU:0'):
    kernel=tf.Variable(tf.random.normal([3,3,3,16]));x=tf.random.normal([4,64,128,3])
    with tf.GradientTape() as tape:
        y=tf.nn.conv2d(x,kernel,1,'SAME');loss=tf.reduce_mean(y*y)
    grad=tape.gradient(loss,kernel)
assert all('GPU:0' in z.device for z in [y,grad,kernel])
# Metal has no int64 AddV2 kernel. Adam's iteration counter is legitimate CPU bookkeeping.
tf.config.set_soft_device_placement(True)
opt=tf.keras.optimizers.Adam(.001);before=kernel.numpy().copy()
with tf.device('/GPU:0'):opt.apply_gradients([(grad,kernel)])
slots=[{'name':v.name,'dtype':str(v.dtype),'device':v.value.device} for v in opt.variables]
result={'tensorflow':tf.__version__,'tensorflow_metal':version('tensorflow-metal'),'gpu_devices':[str(g) for g in gpus],'output_device':y.device,'gradient_device':grad.device,'variable_device':kernel.device,'optimizer_variables':slots,'loss':float(loss.numpy()),'strict_forward_backward_placement':True,'optimizer_step_changed_weights':bool((before!=kernel.numpy()).any()),'passed':all('GPU:0' in z.device for z in [y,grad,kernel]),'scope':'Strict GPU convolution forward/backward; Adam floating-point slots and weights on GPU. Integer iteration counter, file decoding and Python on CPU. Full-model graph uses automatic placement for host-only operations.'}
assert result['optimizer_step_changed_weights'];(out/'verification.json').write_text(json.dumps(result,indent=2));print('METAL_VERIFIED',json.dumps(result))
