import {collectionZip} from '../src/labels/collection-export.js';
import {unzipSync,zipSync,strFromU8} from 'fflate';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const files=unzipSync(readFileSync('qa/dataset/export.zip'));
const root='pill-atelier-dataset/';
const manifest=JSON.parse(strFromU8(files[root+'manifest.json']));
const records=manifest.scenes.map((scene,i)=>({name:scene.scene,manifest:{...manifest,...manifest.batches?.[i],scenes:[scene],verification:[manifest.verification[i]]}}));
let reads=0,writes=0,inFlight=0,maxInFlight=0;
const chunks=[];
const reader=async record=>{
 reads++;
 const stem=`${root}blender/train/${String(manifest.scenes.findIndex(s=>s.scene===record.name)).padStart(6,'0')}`;
 const subset=Object.fromEntries(Object.entries(files).filter(([k])=>k.startsWith(root+record.name+'/')||k.startsWith(stem)||k.endsWith('/classes.json')));
 return zipSync(subset);
};
const res=await collectionZip(records,reader,{write:async chunk=>{
 inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);await new Promise(r=>setTimeout(r,1));chunks.push(chunk);writes++;inFlight--;
}});
assert.equal(maxInFlight,1,'writes use backpressure');assert.equal(reads,records.length);
const bytes=Buffer.concat(chunks),actual=unzipSync(bytes);assert.equal(res.bytes,bytes.length);assert(writes>20);
for(const [path,expected] of Object.entries(files))if(!['manifest.json','README.md'].some(n=>path===root+n))assert.deepEqual(actual[path],expected,path);
await assert.rejects(collectionZip(records,reader,{maxBufferedBytes:100}),/256 MB download buffer/);
let failedWrites=0;await assert.rejects(collectionZip(records,reader,{write:async()=>{failedWrites++;throw new Error('disk full');}}),/disk full/);assert.equal(failedWrites,1);
console.log('PASS single-scene reads, sequential sink backpressure, exact exported files, buffer cap and sink failure propagation');
