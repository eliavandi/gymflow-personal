import {localStateGet,localStateSet,metaGet,metaSet,outboxAdd,outboxAll,outboxDel,outboxCount} from './offline-db.js';

const mid=()=>`mut_${crypto.randomUUID().replaceAll('-','')}`;
let syncing=false;

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

export async function flush(){
  if(syncing||!navigator.onLine)return;
  syncing=true;
  try{
    const items=await outboxAll();
    if(!items.length){emit({synced:true});return;}
    const r=await fetch('/api/sync',{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({mutations:items})
    });
    if(!r.ok)return;
    const d=await r.json().catch(()=>({applied:[]}));
    const applied=new Set(d.applied||items.map(x=>x.id));
    for(const item of items)if(applied.has(item.id))await outboxDel(item.id);
    emit({synced:true});
  }catch{}
  finally{syncing=false;}
}

export function initSync(){
  window.addEventListener('online',()=>{emit();flush();});
  window.addEventListener('offline',()=>emit());
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')flush();});
  setInterval(()=>flush(),30000);
  emit();
  if(navigator.onLine)flush();
}
