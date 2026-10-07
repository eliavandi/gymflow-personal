import {login,logout,localAuth,bootstrap,saveState,mutate,flush,initSync} from './sync.js';

const app=document.getElementById('app');
const toastEl=document.getElementById('toast');
let state=null;
let selectedSession='A';
let view='home';
let activeExerciseId=null;
let checkSaveTimer=null;
let timers=new Map();

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const fmtDate=s=>new Date(s+'T12:00:00').toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric'});
const uid=p=>`${p}_${crypto.randomUUID().replaceAll('-','')}`;
function toast(msg,ms=2200){toastEl.textContent=msg;toastEl.classList.remove('hidden');setTimeout(()=>toastEl.classList.add('hidden'),ms);}

function activeWorkout(){return state?.workouts?.find(w=>w.status==='in_progress')||null;}
function sessionTemplate(code){return state?.program?.sessions?.find(s=>s.code===code)||null;}
function getCheckin(date=today()){return state.checkins.find(c=>c.date===date)||null;}
function lastSet(exerciseId,setNo){
  const finished=[...state.workouts].filter(w=>w.status==='completed').sort((a,b)=>new Date(b.finishedAt)-new Date(a.finishedAt));
  for(const w of finished){
    const s=(w.sets||[]).find(x=>x.exerciseId===exerciseId&&x.setNo===setNo);
    if(s)return s;
  }
  return null;
}
function suggest(ex,setNo){
  const last=lastSet(ex.id,setNo);
  return {weight:last?.weight??ex.suggestedWeight??0,reps:last?.reps??ex.suggestedReps??ex.repsMax};
}
function restLabel(sec){const m=Math.floor(sec/60),s=sec%60;return s?`${m}m${s}s`:`${m}m`;}

window.addEventListener('gymflow-sync',e=>{
  const d=e.detail||{};
  let el=document.getElementById('syncBadge');
  if(!el){el=document.createElement('div');el.id='syncBadge';document.body.appendChild(el);}
  el.className='syncbadge '+(d.online?'online':'offline');
  el.textContent=!d.online?`OFFLINE · ${d.pending||0} DA SINCRONIZZARE`:d.pending?`SYNC · ${d.pending}`:'✓ SALVATO';
});

function shell(content){
  return `<div class="shell"><div class="brandrow"><div><div class="brand">GymFlow</div><div class="tag">allenamento personale · offline first</div></div><button id="logoutBtn" class="btn">Esci</button></div><div class="phone">${content}</div></div>`;
}
function nav(active){
  return `<div class="nav">
    <button data-nav="home" class="${active==='home'?'active':''}">Oggi</button>
    <button data-nav="workout" class="${active==='workout'?'active':''}">Allenamento</button>
    <button data-nav="history" class="${active==='history'?'active':''}">Storico</button>
    <button data-nav="profile" class="${active==='profile'?'active':''}">Profilo</button>
  </div>`;
}
function bindNav(){
  document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{
    view=b.dataset.nav;
    render();
  });
  const lo=document.getElementById('logoutBtn');
  if(lo)lo.onclick=async()=>{await logout();state=null;loginView();};
}

function loginView(error=''){
  app.innerHTML=`<div class="loginwrap"><div class="loginhero"><div class="ey">GymFlow</div><h1>Il tuo allenamento.<br>Sempre con te.</h1><p>Funziona anche senza Internet dopo il primo accesso online.</p></div><div class="card loginbox"><div class="ey">Accesso personale</div><div class="field"><label>Email</label><input id="email" value="elia@gymflow.local"></div><div class="field"><label>Password</label><input id="password" type="password" value="demo1234"></div><button id="loginBtn" class="start">Accedi</button><div class="err">${esc(error)}</div></div></div>`;
  document.getElementById('loginBtn').onclick=async()=>{
    const b=document.getElementById('loginBtn');b.disabled=true;
    try{
      await login(document.getElementById('email').value,document.getElementById('password').value);
      state=await bootstrap();render();
    }catch(e){loginView(e.message);}
  };
}

function render(){
  if(!state)return loginView();
  if(view==='home')return renderHome();
  if(view==='workout')return renderWorkout();
  if(view==='exercise')return renderExercise();
  if(view==='history')return renderHistory();
  if(view==='profile')return renderProfile();
}

function renderHome(){
  const c=getCheckin()||{};
  app.innerHTML=shell(`<div class="appbar"><div><small>${new Date().toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'})}</small><strong>Ciao ${esc(state.profile.firstName)}</strong></div></div>
  <div class="content">
    ${activeWorkout()?`<button id="resume" class="resume"><b>Allenamento in corso · Seduta ${activeWorkout().sessionCode}</b><span>Riprendi da dove avevi lasciato →</span></button>`:''}
    <div class="hero"><div class="ey">Scegli allenamento</div><h1>Quale seduta fai oggi?</h1><div class="sessions">${state.program.sessions.map(s=>`<button class="sess ${selectedSession===s.code?'active':''}" data-session="${s.code}"><b>${s.code}</b><span>${s.exercises.length} esercizi</span></button>`).join('')}</div><button id="startWorkout" class="start">Inizia allenamento ${selectedSession}</button></div>

    <div class="section"><h3>Check-in di oggi</h3><span>salvataggio automatico</span></div>
    <div class="checkgrid">
      <div class="checkitem"><label>Peso · kg</label><input id="weight" type="number" step="0.1" value="${c.weight??''}" placeholder="Inserisci"></div>
      <div class="checkitem"><label>Vita · cm</label><input id="waist" type="number" step="0.1" value="${c.waist??''}" placeholder="Inserisci"></div>
      <div class="checkitem full"><label>Dieta</label><div class="diettoggle"><button data-diet="rispettata" class="${c.diet==='rispettata'?'active':''}">✓ Rispettata</button><button data-diet="non_rispettata" class="${c.diet==='non_rispettata'?'active':''}">✕ Non rispettata</button></div></div>
      <div class="checkitem full"><label>Note</label><input id="notes" value="${esc(c.notes||'')}" placeholder="Opzionale"></div>
    </div>
    <div id="autosaveText" class="autosave">Ogni modifica viene salvata automaticamente sul dispositivo.</div>

    <button id="historyQuick" class="quick"><b>Storico completo</b><span>Peso, vita, dieta e allenamenti →</span></button>
  </div>${nav('home')}`);
  bindNav();
  document.querySelectorAll('[data-session]').forEach(b=>b.onclick=()=>{selectedSession=b.dataset.session;renderHome();});
  document.getElementById('startWorkout').onclick=startWorkout;
  if(document.getElementById('resume'))document.getElementById('resume').onclick=()=>{view='workout';render();};
  document.getElementById('historyQuick').onclick=()=>{view='history';render();};

  ['weight','waist','notes'].forEach(id=>document.getElementById(id).addEventListener('input',scheduleCheckinSave));
  document.querySelectorAll('[data-diet]').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('[data-diet]').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    scheduleCheckinSave();
  });
}

function scheduleCheckinSave(){
  const t=document.getElementById('autosaveText');if(t)t.textContent='Salvataggio…';
  clearTimeout(checkSaveTimer);
  checkSaveTimer=setTimeout(saveCheckin,400);
}
async function saveCheckin(){
  const old=getCheckin()||{id:uid('check'),date:today()};
  const diet=document.querySelector('[data-diet].active')?.dataset.diet||null;
  const row={
    ...old,
    date:today(),
    weight:document.getElementById('weight').value===''?null:Number(document.getElementById('weight').value),
    waist:document.getElementById('waist').value===''?null:Number(document.getElementById('waist').value),
    diet,
    notes:document.getElementById('notes').value.trim(),
    updatedAt:new Date().toISOString()
  };
  const i=state.checkins.findIndex(x=>x.date===row.date);
  if(i>=0)state.checkins[i]=row;else state.checkins.push(row);
  await mutate('upsert_checkin',row,state);
  const t=document.getElementById('autosaveText');if(t)t.textContent=navigator.onLine?'✓ Salvato · sincronizzazione automatica':'✓ Salvato offline sul dispositivo';
}

async function startWorkout(){
  if(activeWorkout()){view='workout';return render();}
  const template=sessionTemplate(selectedSession);
  const w={
    id:uid('ws'),
    sessionCode:selectedSession,
    programId:state.program.id,
    programVersion:state.program.version,
    startedAt:new Date().toISOString(),
    finishedAt:null,
    status:'in_progress',
    exerciseSnapshot:structuredClone(template.exercises),
    sets:[]
  };
  state.workouts.push(w);
  await mutate('start_workout',{workout:w},state);
  view='workout';render();
}

function renderWorkout(){
  const w=activeWorkout();
  if(!w){
    app.innerHTML=shell(`<div class="appbar"><div><small>Allenamento</small><strong>Nessuna seduta attiva</strong></div></div><div class="content"><div class="card">Scegli A, B o C dalla schermata Oggi.</div></div>${nav('workout')}`);
    bindNav();return;
  }
  app.innerHTML=shell(`<div class="appbar"><div><small>Allenamento in corso</small><strong>Seduta ${esc(w.sessionCode)}</strong></div><button id="finishWorkout" class="btn">Termina</button></div>
  <div class="content">
    <div class="helper"><div class="ey">Informazioni</div><h3>Ordine libero degli esercizi</h3><p>Puoi aprire qualsiasi esercizio nell’ordine che preferisci. Il timer parte solo quando completi una serie.</p></div>
    <div class="section"><h3>Esercizi di oggi</h3><span>${w.exerciseSnapshot.length} esercizi</span></div>
    ${w.exerciseSnapshot.map(e=>{
      const completed=(w.sets||[]).filter(s=>s.exerciseId===e.id&&s.completedAt).length;
      return `<button class="exercise" data-ex="${e.id}"><div><b>${esc(e.name)}</b><small>${e.sets}×${e.repsMin}-${e.repsMax} · recupero ${restLabel(e.restSec)}</small></div><span>${completed}/${e.sets} ›</span></button>`;
    }).join('')}
  </div>${nav('workout')}`);
  bindNav();
  document.querySelectorAll('[data-ex]').forEach(b=>b.onclick=()=>{activeExerciseId=b.dataset.ex;view='exercise';render();});
  document.getElementById('finishWorkout').onclick=finishWorkout;
}
async function finishWorkout(){
  const w=activeWorkout();if(!w)return;
  w.status='completed';w.finishedAt=new Date().toISOString();
  await mutate('finish_workout',{workoutId:w.id,finishedAt:w.finishedAt},state);
  toast('Allenamento salvato');
  view='home';render();
}

function renderExercise(){
  const w=activeWorkout();if(!w){view='workout';return render();}
  const e=w.exerciseSnapshot.find(x=>x.id===activeExerciseId)||w.exerciseSnapshot[0];
  activeExerciseId=e.id;
  const last=e.lastPerformance?.length?e.lastPerformance.map(s=>`${s.weight}×${s.reps}`).join(' / '):'Nessuno';
  app.innerHTML=shell(`<div class="appbar"><div><small>Seduta ${w.sessionCode}</small><strong>Esercizio</strong></div><button id="backWorkout" class="btn">Indietro</button></div>
  <div class="content detail"><div class="ey">Esercizio</div><h2>${esc(e.name)}</h2>
    <div class="infogrid"><div class="ibox"><small>Serie × reps</small><b>${e.sets} × ${e.repsMin}-${e.repsMax}</b></div><div class="ibox"><small>Recupero</small><b>${restLabel(e.restSec)}</b></div><div class="ibox"><small>Ultima volta</small><b>${esc(last)}</b></div><div class="ibox"><small>Cadenza</small><b>${esc(e.tempo||'—')}</b></div></div>
    <div class="section"><h3>Serie</h3><span>tocca kg/reps per modificare</span></div>
    ${Array.from({length:e.sets},(_,i)=>setHtml(w,e,i+1)).join('')}
    <button id="exerciseDone" class="btn wide">Torna agli esercizi</button>
  </div>`);
  document.getElementById('logoutBtn').onclick=async()=>{await logout();state=null;loginView();};
  document.getElementById('backWorkout').onclick=document.getElementById('exerciseDone').onclick=()=>{view='workout';render();};
  bindSets(w,e);
}
function findSet(w,eid,n){return (w.sets||[]).find(s=>s.exerciseId===eid&&s.setNo===n)||null;}
function setHtml(w,e,n){
  const s=findSet(w,e.id,n);const sug=s||suggest(e,n);
  return `<div class="seriesblock" data-set="${n}"><div class="srow"><span>Serie ${n}</span><button class="kg">${sug.weight} kg</button><button class="reps">${sug.reps} reps</button><button class="ok ${s?.completedAt?'done':''}">✓</button></div><div class="rest ${s?.restEndsAt&&new Date(s.restEndsAt)>new Date()?'active':''}"><span>Recupero</span><strong>00:00</strong><span><button class="mini add15">+15s</button><button class="mini skip">Salta</button></span></div></div>`;
}
async function upsertLocalSet(w,e,n,weight,reps,changes={}){
  let s=findSet(w,e.id,n);
  if(!s){s={exerciseId:e.id,setNo:n,weight:Number(weight),reps:Number(reps),completedAt:null,restEndsAt:null};w.sets.push(s);}
  Object.assign(s,{weight:Number(weight),reps:Number(reps)},changes);
  await saveState(state);
  return s;
}
async function syncSet(w,s){await mutate('upsert_set',{workoutId:w.id,set:s},state);}
function bindSets(w,e){
  document.querySelectorAll('[data-set]').forEach(block=>{
    const n=Number(block.dataset.set),kg=block.querySelector('.kg'),reps=block.querySelector('.reps'),ok=block.querySelector('.ok'),rest=block.querySelector('.rest');
    const old=findSet(w,e.id,n);
    if(old?.restEndsAt&&new Date(old.restEndsAt)>new Date())startTimer(rest,e,w,n,old.restEndsAt);
    kg.onclick=async()=>{const v=prompt('Peso (kg)',parseFloat(kg.textContent));if(v!==null&&v!==''){kg.textContent=`${v} kg`;const s=await upsertLocalSet(w,e,n,Number(v),parseInt(reps.textContent));await syncSet(w,s);}};
    reps.onclick=async()=>{const v=prompt('Ripetizioni',parseInt(reps.textContent));if(v!==null&&v!==''){reps.textContent=`${v} reps`;const s=await upsertLocalSet(w,e,n,parseFloat(kg.textContent),Number(v));await syncSet(w,s);}};
    ok.onclick=async()=>{
      ok.classList.add('done');
      const end=new Date(Date.now()+e.restSec*1000).toISOString();
      const s=await upsertLocalSet(w,e,n,parseFloat(kg.textContent),parseInt(reps.textContent),{completedAt:new Date().toISOString(),restEndsAt:end});
      await syncSet(w,s);
      startTimer(rest,e,w,n,end);
    };
  });
}
function startTimer(box,e,w,n,endsAt){
  box.classList.add('active');
  let end=new Date(endsAt).getTime();
  const out=box.querySelector('strong');
  const draw=()=>{const r=Math.max(0,Math.ceil((end-Date.now())/1000));out.textContent=`${String(Math.floor(r/60)).padStart(2,'0')}:${String(r%60).padStart(2,'0')}`;if(r<=0){out.textContent='FINE';return false}return true;};
  draw();
  if(timers.get(`${e.id}:${n}`))clearInterval(timers.get(`${e.id}:${n}`));
  const id=setInterval(()=>{if(!draw())clearInterval(id);},500);timers.set(`${e.id}:${n}`,id);
  box.querySelector('.add15').onclick=async()=>{end+=15000;const s=findSet(w,e.id,n);if(s){s.restEndsAt=new Date(end).toISOString();await syncSet(w,s);}draw();};
  box.querySelector('.skip').onclick=async()=>{clearInterval(id);box.classList.remove('active');const s=findSet(w,e.id,n);if(s){s.restEndsAt=null;await syncSet(w,s);}};
}

function renderHistory(){
  const checks=[...state.checkins].sort((a,b)=>b.date.localeCompare(a.date));
  const workouts=[...state.workouts].filter(w=>w.status==='completed').sort((a,b)=>new Date(b.finishedAt)-new Date(a.finishedAt));
  app.innerHTML=shell(`<div class="appbar"><div><small>I tuoi dati</small><strong>Storico</strong></div></div>
  <div class="content">
    <div class="exportcard"><div><div class="ey">Da inviare al PT</div><b>Excel riepilogativo completo</b><small>Peso, vita, dieta, esercizi, serie, kg e reps.</small></div><button id="exportExcel" class="btn white">Scarica Excel</button></div>

    <div class="section"><h3>Diario giornaliero</h3><span>${checks.length} giorni</span></div>
    <div class="card">${checks.length?checks.map(c=>`<div class="diaryrow"><b>${fmtDate(c.date)}</b><span>${c.weight??'—'} kg</span><span>${c.waist??'—'} cm</span><span class="${c.diet==='non_rispettata'?'bad':'good'}">${c.diet==='rispettata'?'✓ dieta':c.diet==='non_rispettata'?'✕ dieta':'—'}</span></div>`).join(''):'<div class="muted">Nessun check-in ancora.</div>'}</div>

    <div class="section"><h3>Allenamenti</h3><span>${workouts.length} completati</span></div>
    ${workouts.length?workouts.map(w=>workoutHistoryHtml(w)).join(''):'<div class="card muted">Nessun allenamento completato.</div>'}
  </div>${nav('history')}`);
  bindNav();
  document.getElementById('exportExcel').onclick=exportExcel;
}
function workoutHistoryHtml(w){
  return `<details class="histwork"><summary><span><b>${fmtDate(String(w.finishedAt).slice(0,10))} · Seduta ${w.sessionCode}</b><small>${(w.sets||[]).length} serie registrate</small></span><span>＋</span></summary><div class="histinside">${(w.exerciseSnapshot||[]).map(e=>{const sets=(w.sets||[]).filter(s=>s.exerciseId===e.id).sort((a,b)=>a.setNo-b.setNo);return `<div class="histEx"><b>${esc(e.name)}</b><div>${sets.length?sets.map(s=>`<span>${s.weight} kg × ${s.reps}</span>`).join(''):'<span class="muted">Nessuna serie registrata</span>'}</div></div>`;}).join('')}</div></details>`;
}
async function exportExcel(){
  if(!navigator.onLine)return toast('Per creare il file Excel serve Internet. I dati offline sono comunque al sicuro.');
  await flush();
  const r=await fetch('/api/export.xlsx',{credentials:'include'});
  if(!r.ok)return toast('Errore nella creazione Excel');
  const blob=await r.blob();
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`GymFlow_${state.profile.firstName}_${today()}.xlsx`;a.click();URL.revokeObjectURL(a.href);
}

function renderProfile(){
  app.innerHTML=shell(`<div class="appbar"><div><small>Profilo personale</small><strong>${esc(state.profile.firstName)} ${esc(state.profile.lastName)}</strong></div></div>
  <div class="content"><div class="profilegrid"><div class="profileitem"><small>Altezza</small><b>${state.profile.heightCm} cm</b></div><div class="profileitem"><small>Peso obiettivo</small><b>${state.profile.targetWeightKg} kg</b></div><div class="profileitem"><small>Versione scheda</small><b>v${state.program.version}</b></div><div class="profileitem"><small>Sedute</small><b>${state.program.sessions.length}</b></div></div><div class="card info"><b>Offline-first</b><p>Check-in e allenamenti vengono salvati prima sul dispositivo e sincronizzati automaticamente appena torna Internet.</p></div></div>${nav('profile')}`);
  bindNav();
}

async function boot(){
  if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
  initSync();
  let auth=null;
  try{
    if(navigator.onLine){
      const r=await fetch('/api/me',{credentials:'include'});
      if(r.ok)auth=(await r.json()).user;
    }
  }catch{}
  if(!auth)auth=await localAuth();
  if(!auth)return loginView();
  try{
    state=await bootstrap();render();
  }catch(e){loginView(e.message);}
}
boot();
