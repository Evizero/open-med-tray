// Local scene journal. Metadata/thumbnails and large archives are separate so
// reopening a collection does not pull every ZIP into RAM. A completed scene,
// its archive and the next generation cursor commit in one IDB transaction.
export class CollectionStore {
  constructor(name = `pill-atelier:${location.pathname}`) { this.name=name; this.db=null; }
  async open() {
    this.db=await new Promise((resolve,reject)=>{
      const r=indexedDB.open(this.name,1);
      r.onupgradeneeded=()=>{for(const name of ['scenes','archives','state'])r.result.createObjectStore(name);};
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
      r.onblocked=()=>reject(new Error('Collection database is open in an incompatible tab'));
    });
    this.db.onversionchange=()=>this.db.close();
    return this;
  }
  transaction(stores,mode,action) {
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction(stores,mode);let result;
      tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('Collection write aborted'));
      try {result=action(tx);} catch(e){tx.abort();reject(e);}
    });
  }
  async read(store,key) {
    const r=await this.transaction([store],'readonly',tx=>key===undefined?tx.objectStore(store).getAll():tx.objectStore(store).get(key));
    return r.result;
  }
  async restore() {
    const [scenes,checkpoint]=await Promise.all([this.read('scenes'),this.read('state','checkpoint')]);
    return {scenes:scenes.sort((a,b)=>a.globalIndex-b.globalIndex),checkpoint};
  }
  async save(record,checkpoint) {
    const {archive,...summary}=record;
    if(!archive)throw new Error('Cannot checkpoint a scene without its archive');
    summary.archiveBytes=archive.byteLength;summary.persisted=true;
    await this.transaction(['scenes','archives','state'],'readwrite',tx=>{
      tx.objectStore('scenes').put(summary,record.name);
      tx.objectStore('archives').put(new Blob([archive],{type:'application/zip'}),record.name);
      tx.objectStore('state').put(checkpoint,'checkpoint');
    });
    return summary;
  }
  checkpoint(value) {return this.transaction(['state'],'readwrite',tx=>tx.objectStore('state').put(value,'checkpoint'));}
  remove(name) {return this.transaction(['scenes','archives'],'readwrite',tx=>{tx.objectStore('scenes').delete(name);tx.objectStore('archives').delete(name);});}
  async archive(record) {
    if(record.archive)return record.archive;
    const blob=await this.read('archives',record.name);
    if(!blob)throw new Error(`Missing saved archive for ${record.name}`);
    return new Uint8Array(await blob.arrayBuffer());
  }
}
