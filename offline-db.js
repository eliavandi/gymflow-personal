const DB_NAME='gymflow-local';
const DB_VERSION=1;
const STORES=['kv','outbox','meta'];

let dbPromise=null;
function db(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=()=>{
      const d=r.result;
      for(const s of STORES){
        if(!d.objectStoreNames.contains(s))d.createObjectStore(s,{keyPath:'key'});
      }
    };
    r.onsuccess=()=>resolve(r.result);
    r.onerror=()=>reject(r.error);
  });
  return dbPromise;
}
async function get(store,key){
  const d=await db();
  return new Promise((resolve,reject)=>{
    const t=d.transaction(store,'readonly');
    const r=t.objectStore(store).get(key);
    r.onsuccess=()=>resolve(r.result?.value??null);
    r.onerror=()=>reject(r.error);
  });
}
async function put(store,key,value){
  const d=await db();
  return new Promise((resolve,reject)=>{
    const t=d.transaction(store,'readwrite');
    t.objectStore(store).put({key,value});
    t.oncomplete=()=>resolve(value);
    t.onerror=()=>reject(t.error);
  });
}
async function del(store,key){
  const d=await db();
  return new Promise((resolve,reject)=>{
    const t=d.transaction(store,'readwrite');
    t.objectStore(store).delete(key);
    t.oncomplete=()=>resolve();
    t.onerror=()=>reject(t.error);
  });
}
async function all(store){
  const d=await db();
  return new Promise((resolve,reject)=>{
    const t=d.transaction(store,'readonly');
    const r=t.objectStore(store).getAll();
    r.onsuccess=()=>resolve((r.result||[]).map(x=>({key:x.key,value:x.value})));
    r.onerror=()=>reject(r.error);
  });
}
export const localStateGet=()=>get('kv','state');
export const localStateSet=v=>put('kv','state',v);
export const metaGet=k=>get('meta',k);
export const metaSet=(k,v)=>put('meta',k,v);
export const metaDel=k=>del('meta',k);
export async function outboxAdd(m){return put('outbox',m.id,m);}
export async function outboxAll(){return (await all('outbox')).map(x=>x.value).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));}
export async function outboxDel(id){return del('outbox',id);}
export async function outboxCount(){return (await all('outbox')).length;}
