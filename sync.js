import {localStateGet,localStateSet,metaGet,metaSet,outboxAdd,outboxAll,outboxDel,outboxCount} from './offline-db.js';

const mid=()=>`mut_${crypto.randomUUID().replaceAll('-','')}`;
let syncPromise=null;

function emit(extra={}){
  outboxCount().then(pending=>{
    window.dispatchEvent(new CustomEvent('gymflow-sync',{detail:{online:navigator.onLine,pending,...extra}}));
  });
}

export async function login(email,password){
  const r=await fetch('/api/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||'Login fallito');
  await metaSet('auth',d.user);
  return d.user;
}
export async function logout(){
  try{await fetch('/api/logout',{method:'POST',credentials:'include'});}catch{}
  await metaSet('auth',null);
}
export async function localAuth(){return metaGet('auth');}

export async function bootstrap(){
  if(navigator.onLine){
    await flush();
    try{
      const r=await fetch('/api/bootstrap',{credentials:'include'});
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||'Errore');
      await localStateSet(d);
      emit({fresh:true});
      return d;
    }catch{}
  }
  const local=await localStateGet();
  if(local){emit({offline:true});return local;}
  throw new Error('Apri GymFlow almeno una volta online prima di usarlo offline.');
}

export async function saveState(state){await localStateSet(state);}

export async function mutate(type,payload,state){
  await localStateSet(state);
  const m={id:mid(),type,payload,createdAt:new Date().toISOString()};
  await outboxAdd(m);
  emit({queued:true});
  if(navigator.onLine)flush();
  return m;
}

export function flush(){
  if(syncPromise)return syncPromise;
  if(!navigator.onLine)return Promise.resolve(false);
  syncPromise=drainOutbox().finally(()=>{syncPromise=null;});
  return syncPromise;
}

async function drainOutbox(){
  try{
    while(navigator.onLine){
    const items=await outboxAll();
    if(!items.length){emit({synced:true});return true;}
    const r=await fetch('/api/sync',{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({mutations:items})
    });
    if(!r.ok){emit({error:true});return false;}
    const d=await r.json().catch(()=>({applied:[]}));
    const acknowledged=new Set([...(d.applied||[]),...(d.rejected||[]).map(x=>x.id)]);
    if(!acknowledged.size)return false;
    for(const item of items)if(acknowledged.has(item.id))await outboxDel(item.id);
    if(d.program){
      const local=await localStateGet();
      if(local){local.program=d.program;await localStateSet(local);}
      window.dispatchEvent(new CustomEvent('gymflow-program-refresh',{detail:{program:d.program}}));
    }
    emit({synced:true});
    }
  }catch{emit({error:true});}
  return false;
}

export function initSync(){
  window.addEventListener('online',()=>{emit();flush();});
  window.addEventListener('offline',()=>emit());
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')flush();});
  setInterval(()=>flush(),30000);
  emit();
  if(navigator.onLine)flush();
}
