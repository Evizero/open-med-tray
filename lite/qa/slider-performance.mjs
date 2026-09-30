// Regressions for cheap shape previews and exact release/cancellation/mode commits.
import {withPage,settle} from './harness.mjs';
import assert from 'node:assert/strict';
await withPage(async(page,log)=>{
 await page.evaluate(()=>window.__atelier.stage.pipe.maxSamples=2);await settle(page);
 const result=await page.evaluate(async()=>{
  const a=window.__atelier,api=a.api,st=a.stage,tick=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const range=label=>[...document.querySelectorAll('input[type=range]')].find(e=>e.getAttribute('aria-label')===label);
  const set=(el,value,final=false)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));if(final)el.dispatchEvent(new Event('change',{bubbles:true}));};
  await api.applyPresetById('p10');api.setTab('form');const diameter=range('Diameter'),texture=st.pill.relief.texture,rect=st.pill.relief.rect.slice();
  set(diameter,12.4);await tick();
  const preview={sameTexture:st.pill.relief.texture===texture,sameRect:JSON.stringify(st.pill.relief.rect)===JSON.stringify(rect),mesh:st.pill.spec.length,pending:st.pill.needsFinalize};
  diameter.dispatchEvent(new Event('change',{bubbles:true}));await tick();
  const fresh=new st.pill.constructor(structuredClone(a.state.spec));
  const equal=(x,y)=>x.length===y.length&&x.every((v,i)=>Object.is(v,y[i]));
  const exact={geometry:st.pill.meshes.every((m,i)=>['position','normal'].every(k=>equal(m.geometry.attributes[k].array,fresh.meshes[i].geometry.attributes[k].array))),relief:equal(st.pill.relief.texture.image.data,fresh.relief.texture.image.data),metadata:JSON.stringify(st.pill.record)===JSON.stringify(fresh.record),class:st.pill.label.semantic===fresh.label.semantic};fresh.dispose();
  const release={state:a.state.spec.length,mesh:st.pill.spec.length,mapExtent:st.pill.relief.rect[2],pending:st.pill.needsFinalize};
  const original=JSON.stringify(a.state.spec),field=[...document.querySelectorAll('input.num')].find(e=>e.getAttribute('aria-label')?.startsWith('Diameter value'));
  field.focus();field.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));await tick();field.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await tick();
  const cancelled={state:JSON.stringify(a.state.spec)===original,mesh:JSON.stringify(st.pill.spec)===original,pending:st.pill.needsFinalize};
  set(range('Diameter'),10.6);await api.applyPresetById('amber');await tick();const preset={state:a.state.spec.kind,mesh:st.pill.kind,pending:st.pill.needsFinalize};
  await api.applyPresetById('p10');api.setTab('form');set(range('Diameter'),13.2);await api.setMode('tray');
  const parking={state:a.state.spec.length,mesh:st.pill.spec.length,mapExtent:st.pill.relief.rect[2],pending:st.pill.needsFinalize};
  await api.setMode('specimen');await tick();
  const returning={state:a.state.spec.length,mesh:st.pill.spec.length,mapExtent:st.pill.relief.rect[2],pending:st.pill.needsFinalize};
  return {preview,exact,release,cancelled,preset,parking,returning};
 });
 assert.deepEqual(result.preview,{sameTexture:true,sameRect:true,mesh:12.4,pending:true});assert.deepEqual(result.exact,{geometry:true,relief:true,metadata:true,class:true});
 assert.deepEqual(result.release,{state:12.4,mesh:12.4,mapExtent:13,pending:false});assert.deepEqual(result.cancelled,{state:true,mesh:true,pending:false});assert.deepEqual(result.preset,{state:'softgel',mesh:'softgel',pending:false});
 for(const r of [result.parking,result.returning]){assert.equal(r.state,13.2);assert.equal(r.mesh,13.2);assert(Math.abs(r.mapExtent-13.8)<1e-10);assert.equal(r.pending,false);}
 assert.deepEqual(log.errors,[]);assert.deepEqual(log.console,[]);console.log('PASS exact last release; numeric cancel; superseding preset; queued mode exit and return',JSON.stringify(result));
},{width:390,height:844,mobile:true,reducedMotion:'reduce',timeout:120000});
