import {unzipSync,strToU8,Zip,ZipPassThrough} from 'fflate';
import {SEMANTIC} from './schema.js';
import {datasetReadme} from './dataset-readme.js';
// Reconstruct exports from the current collection, so deletion removes all
// corresponding RGB/targets/metadata and manifest entries together.
export async function collectionZip(records,readArchive=async r=>r.archive,{write=null,maxBufferedBytes=256*1024*1024}={}) {
  if (!records.length) return null;
  const root='pill-atelier-dataset/';
  const manifest={generator:'Pill Atelier browser collection',label_schema:'medtray/classes-v1',created:new Date().toISOString(),scenes:[],verification:[],batches:[],semantic_classes:SEMANTIC};
  const seen=new Set(),parts=[];let pending=[],bytes=0,error=null;
  const zip=new Zip((err,data)=>{if(err){error=err;return;}if(data?.length)pending.push(data);});
  const drain=async()=>{
    if(error)throw error;
    const chunks=pending;pending=[];
    for(const chunk of chunks){
      bytes+=chunk.byteLength;
      if(write)await write(chunk);
      else{if(bytes>maxBufferedBytes)throw new Error('Collection exceeds the 256 MB download buffer. Use Save ZIP to disk for streaming export.');parts.push(chunk);}
    }
  };
  const add=async(path,data)=>{
    if(seen.has(path))return;seen.add(path);
    const entry=new ZipPassThrough(path);zip.add(entry);entry.push(data,true);await drain();
  };
  try {
    for(const record of records) {
      // At most one decoded scene in memory, independent of collection size.
      const decoded=unzipSync(await readArchive(record));
      for(const [path,data] of Object.entries(decoded))if(![root+'manifest.json',root+'README.md'].includes(path))await add(path,data);
      manifest.scenes.push(...record.manifest.scenes);manifest.verification.push(...record.manifest.verification);
      const {scenes,verification,...settings}=record.manifest;
      manifest.batches.push({scene:record.name,...settings});
    }
    await add(root+'manifest.json',strToU8(JSON.stringify(manifest,null,1)));
    let readme=datasetReadme(records[0].manifest);
    const begin=readme.indexOf('Browser-generated'),end=readme.indexOf('\n\nNothing here');
    readme=readme.slice(0,begin)+`Browser-generated synthetic collection with ${records.length} scenes. Resolution, seeds, acquisition and render settings are recorded per scene in manifest.json (batches) and metadata. Scenes may come from different batches. Deleted scenes and all of their paired targets are excluded.`+readme.slice(end);
    await add(root+'README.md',strToU8(readme));zip.end();await drain();
    return write?{bytes}:new Blob(parts,{type:'application/zip'});
  }catch(e){zip.terminate();throw e;}
}
