import {login,logout,localAuth,bootstrap,saveState,mutate,flush,initSync} from './sync.js';

const app=document.getElementById('app');
const toastEl=document.getElementById('toast');
let state=null;
let selectedSession='A';
let view='home';
let activeExerciseId=null;
let checkSaveTimer=null;
let programSaveTimer=null;
let timers=new Map();
let installPrompt=null;
let importDraft=null;

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const fmtDate=s=>new Date(s+'T12:00:00').toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric'});
const uid=p=>`${p}_${crypto.randomUUID().replaceAll('-','')}`;
function toast(msg,ms=2600){toastEl.textContent=msg;toastEl.classList.remove('hidden');setTimeout(()=>toastEl.classList.add('hidden'),ms);}
function activeWorkout(){return state?.workouts?.find(w=>w.status==='in_progress')||null;}
function sessionTemplate(code){return state?.program?.sessions?.find(s=>s.code===code)||null;}
function getCheckin(date=today()){return state.checkins.find(c=>c.date===date)||null;}
function restLabel(sec){const m=Math.floor(Number(sec||0)/60),s=Number(sec||0)%60;return s?`${m}m${s}s`:`${m}m`;}
function restInput(sec){const n=Number(sec||0),m=Math.floor(n/60),s=n%60;return s?`${m}:${String(s).padStart(2,'0')}`:`${m}:00`;}
function parseRestInput(v){
  const s=String(v||'').trim().toLowerCase().replace(',','.');
  let m=s.match(/^(\d+):(\d+)$/);if(m)return Number(m[1])*60+Number(m[2]);
  m=s.match(/^(\d+)\s*m(?:in)?\s*(\d+)?/);if(m)return Number(m[1])*60+Number(m[2]||0);
  m=s.match(/^(\d+)\s*['′]\s*(\d+)?/);if(m)return Number(m[1])*60+Number(m[2]||0);
  const n=Number(s);return Number.isFinite(n)?Math.max(0,Math.round(n)):90;
}

function completedWorkouts(){
  return [...(state?.workouts||[])]
    .filter(w=>w.status==='completed'&&w.finishedAt)
    .sort((a,b)=>new Date(b.finishedAt)-new Date(a.finishedAt));
}
function daysAgoLabel(iso){
  if(!iso)return '—';
  const then=new Date(iso),now=new Date();
  const a=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const b=new Date(then.getFullYear(),then.getMonth(),then.getDate());
  const days=Math.max(0,Math.round((a-b)/86400000));
  if(days===0)return 'oggi';
  if(days===1)return 'ieri';
  return `${days} giorni fa`;
}
function compactDateTime(iso){
  if(!iso)return '—';
  const d=new Date(iso);
  return d.toLocaleDateString('it-IT',{day:'2-digit',month:'short'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
}
function gapDays(newerIso,olderIso){
  if(!newerIso||!olderIso)return null;
  const ms=new Date(newerIso)-new Date(olderIso);
  return Math.max(0,Math.round(ms/86400000));
}
function recentWorkoutHtml(limit=3){
  const ws=completedWorkouts().slice(0,limit);
  if(!ws.length)return `<div class="recentempty">Nessun allenamento completato ancora.</div>`;
  return ws.map((w,i)=>{
    const older=completedWorkouts()[i+1];
    const gap=older?gapDays(w.finishedAt,older.finishedAt):null;
    const label=i===0?'ULTIMO':i===1?'PRECEDENTE':'PRIMA';
    return `<button class="recentwork ${i===0?'latest':''}" data-open-history="1">
      <div class="recentbadge">${esc(w.sessionCode)}</div>
      <div class="recentmain">
        <small>${label} ALLENAMENTO</small>
        <b>Seduta ${esc(w.sessionCode)} · ${compactDateTime(w.finishedAt)}</b>
        <span>${daysAgoLabel(w.finishedAt)}${gap!==null?` · intervallo ${gap} ${gap===1?'giorno':'giorni'}`:''}</span>
      </div>
      <div class="recentchev">›</div>
    </button>`;
  }).join('');
}

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});
window.addEventListener('appinstalled',()=>{installPrompt=null;toast('GymFlow installata');});

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
  return `<div class="nav five">
    <button data-nav="home" class="${active==='home'?'active':''}">Oggi</button>
    <button data-nav="workout" class="${active==='workout'?'active':''}">Workout</button>
    <button data-nav="program" class="${active==='program'?'active':''}">Scheda</button>
    <button data-nav="history" class="${active==='history'?'active':''}">Storico</button>
    <button data-nav="profile" class="${active==='profile'?'active':''}">Profilo</button>
  </div>`;
}
function bindNav(){
  document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{view=b.dataset.nav;render();});
  const lo=document.getElementById('logoutBtn');
  if(lo)lo.onclick=async()=>{await logout();state=null;loginView();};
}

function loginView(error=''){
  app.innerHTML=`<div class="loginwrap"><div class="loginhero"><div class="ey">GymFlow</div><h1>Il tuo allenamento.<br>Sempre con te.</h1><p>Funziona anche senza Internet dopo il primo accesso online.</p></div><div class="card loginbox"><div class="ey">Accesso personale</div><div class="field"><label>Email</label><input id="email" value="elia@gymflow.local"></div><div class="field"><label>Password</label><input id="password" type="password"></div><button id="loginBtn" class="start">Accedi</button><div class="err">${esc(error)}</div></div></div>`;
  document.getElementById('loginBtn').onclick=async()=>{
    const b=document.getElementById('loginBtn');b.disabled=true;
    try{await login(document.getElementById('email').value,document.getElementById('password').value);state=await bootstrap();render();}
    catch(e){loginView(e.message);}
  };
}

function render(){
  if(!state)return loginView();
  if(view==='home')return renderHome();
  if(view==='workout')return renderWorkout();
  if(view==='exercise')return renderExercise();
  if(view==='program')return renderProgram();
  if(view==='history')return renderHistory();
  if(view==='profile')return renderProfile();
}

function renderHome(){
  const c=getCheckin()||{};
  app.innerHTML=shell(`<div class="appbar"><div><small>${new Date().toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'})}</small><strong>Ciao ${esc(state.profile.firstName)}</strong></div></div>
  <div class="content">
    ${activeWorkout()?`<button id="resume" class="resume"><b>Allenamento in corso · Seduta ${activeWorkout().sessionCode}</b><span>Riprendi →</span></button>`:''}
    <div class="hero"><div class="ey">Scegli allenamento</div><h1>Let’s do it</h1><div class="sessions">${state.program.sessions.map(s=>`<button class="sess ${selectedSession===s.code?'active':''}" data-session="${s.code}"><b>${s.code}</b><span>${s.exercises.length} esercizi</span></button>`).join('')}</div><button id="startWorkout" class="start">Inizia allenamento ${selectedSession}</button></div>

    <div class="section recenttitle"><h3>Ultimi allenamenti</h3><span>ordine e cadenza</span></div>
    <div class="recentlist">${recentWorkoutHtml(3)}</div>

    <div class="section"><h3>Check-in di oggi</h3><span>salvataggio automatico</span></div>
    <div class="checkgrid">
      <div class="checkitem"><label>Peso · kg</label><input id="weight" type="number" step="0.1" value="${c.weight??''}" placeholder="Inserisci"></div>
      <div class="checkitem"><label>Vita · cm</label><input id="waist" type="number" step="0.1" value="${c.waist??''}" placeholder="Inserisci"></div>
      <div class="checkitem full"><label>Dieta</label><div class="diettoggle"><button data-diet="rispettata" class="${c.diet==='rispettata'?'active':''}">✓ Rispettata</button><button data-diet="non_rispettata" class="${c.diet==='non_rispettata'?'active':''}">✕ Non rispettata</button></div></div>
      <div class="checkitem full"><label>Note</label><input id="notes" value="${esc(c.notes||'')}" placeholder="Opzionale"></div>
    </div>
    <div id="autosaveText" class="autosave">Ogni modifica viene salvata automaticamente sul dispositivo.</div>

    <div class="quickgrid">
      <button id="programQuick" class="quick"><b>Gestisci scheda</b><span>Importa Excel o modifica A/B/C →</span></button>
      <button id="historyQuick" class="quick"><b>Storico completo</b><span>Dati e allenamenti →</span></button>
    </div>
  </div>${nav('home')}`);
  bindNav();
  document.querySelectorAll('[data-session]').forEach(b=>b.onclick=()=>{selectedSession=b.dataset.session;renderHome();});
  document.getElementById('startWorkout').onclick=startWorkout;
  if(document.getElementById('resume'))document.getElementById('resume').onclick=()=>{view='workout';render();};
  document.getElementById('historyQuick').onclick=()=>{view='history';render();};
  document.getElementById('programQuick').onclick=()=>{view='program';render();};
  document.querySelectorAll('[data-open-history]').forEach(b=>b.onclick=()=>{view='history';render();});
  ['weight','waist','notes'].forEach(id=>document.getElementById(id).addEventListener('input',scheduleCheckinSave));
  document.querySelectorAll('[data-diet]').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('[data-diet]').forEach(x=>x.classList.remove('active'));b.classList.add('active');scheduleCheckinSave();
  });
}
function scheduleCheckinSave(){
  const t=document.getElementById('autosaveText');if(t)t.textContent='Salvataggio…';
  clearTimeout(checkSaveTimer);checkSaveTimer=setTimeout(saveCheckin,400);
}
async function saveCheckin(){
  const old=getCheckin()||{id:uid('check'),date:today()};
  const row={...old,date:today(),
    weight:document.getElementById('weight').value===''?null:Number(document.getElementById('weight').value),
    waist:document.getElementById('waist').value===''?null:Number(document.getElementById('waist').value),
    diet:document.querySelector('[data-diet].active')?.dataset.diet||null,
    notes:document.getElementById('notes').value.trim(),updatedAt:new Date().toISOString()};
  const i=state.checkins.findIndex(x=>x.date===row.date);if(i>=0)state.checkins[i]=row;else state.checkins.push(row);
  await mutate('upsert_checkin',row,state);
  const t=document.getElementById('autosaveText');if(t)t.textContent=navigator.onLine?'✓ Salvato · sincronizzazione automatica':'✓ Salvato offline sul dispositivo';
}

async function startWorkout(){
  if(activeWorkout()){view='workout';return render();}
  const template=sessionTemplate(selectedSession);
  if(!template||!template.exercises.length)return toast(`La seduta ${selectedSession} non contiene esercizi`);
  const w={id:uid('ws'),sessionCode:selectedSession,programId:state.program.id,programVersion:state.program.version,
    startedAt:new Date().toISOString(),finishedAt:null,status:'in_progress',
    exerciseSnapshot:structuredClone(template.exercises),sets:[]};
  state.workouts.push(w);await mutate('start_workout',{workout:w},state);view='workout';render();
}

function renderWorkout(){
  const w=activeWorkout();
  if(!w){
    app.innerHTML=shell(`<div class="appbar"><div><small>Allenamento</small><strong>Nessuna seduta attiva</strong></div></div>
    <div class="content">
      <div class="card"><div class="ey">Pronto per allenarti</div><b>Scegli A, B o C dalla schermata Oggi.</b></div>
      <div class="section recenttitle"><h3>Ultime sedute</h3><span>ordine e cadenza</span></div>
      <div class="recentlist">${recentWorkoutHtml(3)}</div>
    </div>${nav('workout')}`);
    bindNav();
    document.querySelectorAll('[data-open-history]').forEach(b=>b.onclick=()=>{view='history';render();});
    return;
  }
  app.innerHTML=shell(`<div class="appbar"><div><small>Allenamento in corso</small><strong>Seduta ${esc(w.sessionCode)}</strong></div><button id="finishWorkout" class="btn">Termina</button></div>
  <div class="content">
    <div class="helper"><div class="ey">Informazioni</div><h3>Ordine libero degli esercizi</h3><p>Questa è solo una descrizione. Gli esercizi veri iniziano qui sotto e puoi aprirli nell’ordine che preferisci.</p></div>
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
  await mutate('finish_workout',{workoutId:w.id,finishedAt:w.finishedAt,workout:w},state);
  toast('Allenamento salvato');view='home';render();
}

function lastSet(exerciseId,setNo){
  const finished=[...state.workouts].filter(w=>w.status==='completed').sort((a,b)=>new Date(b.finishedAt)-new Date(a.finishedAt));
  for(const w of finished){const s=(w.sets||[]).find(x=>x.exerciseId===exerciseId&&x.setNo===setNo);if(s)return s;}
  return null;
}
function suggest(ex,setNo){const last=lastSet(ex.id,setNo);return {weight:last?.weight??ex.suggestedWeight??0,reps:last?.reps??ex.suggestedReps??ex.repsMax};}
function renderExercise(){
  const w=activeWorkout();if(!w){view='workout';return render();}
  const e=w.exerciseSnapshot.find(x=>x.id===activeExerciseId)||w.exerciseSnapshot[0];activeExerciseId=e.id;
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
  const s=findSet(w,e.id,n),sug=s||suggest(e,n);
  return `<div class="seriesblock" data-set="${n}"><div class="srow"><span>Serie ${n}</span><button class="kg">${sug.weight} kg</button><button class="reps">${sug.reps} reps</button><button class="ok ${s?.completedAt?'done':''}">✓</button></div><div class="rest ${s?.restEndsAt&&new Date(s.restEndsAt)>new Date()?'active':''}"><span>Recupero</span><strong>00:00</strong><span><button class="mini add15">+15s</button><button class="mini skip">Salta</button></span></div></div>`;
}
async function upsertLocalSet(w,e,n,weight,reps,changes={}){
  let s=findSet(w,e.id,n);
  if(!s){s={exerciseId:e.id,setNo:n,weight:Number(weight),reps:Number(reps),completedAt:null,restEndsAt:null};w.sets.push(s);}
  Object.assign(s,{weight:Number(weight),reps:Number(reps)},changes);await saveState(state);return s;
}
async function syncSet(w,s){await mutate('upsert_set',{workoutId:w.id,set:s,workout:w},state);}
function bindSets(w,e){
  document.querySelectorAll('[data-set]').forEach(block=>{
    const n=Number(block.dataset.set),kg=block.querySelector('.kg'),reps=block.querySelector('.reps'),ok=block.querySelector('.ok'),rest=block.querySelector('.rest');
    const old=findSet(w,e.id,n);if(old?.restEndsAt&&new Date(old.restEndsAt)>new Date())startTimer(rest,e,w,n,old.restEndsAt);
    kg.onclick=async()=>{const v=prompt('Peso (kg)',parseFloat(kg.textContent));if(v!==null&&v!==''){kg.textContent=`${v} kg`;const s=await upsertLocalSet(w,e,n,Number(v),parseInt(reps.textContent));await syncSet(w,s);}};
    reps.onclick=async()=>{const v=prompt('Ripetizioni',parseInt(reps.textContent));if(v!==null&&v!==''){reps.textContent=`${v} reps`;const s=await upsertLocalSet(w,e,n,parseFloat(kg.textContent),Number(v));await syncSet(w,s);}};
    ok.onclick=async()=>{
      ok.classList.add('done');const end=new Date(Date.now()+e.restSec*1000).toISOString();
      const s=await upsertLocalSet(w,e,n,parseFloat(kg.textContent),parseInt(reps.textContent),{completedAt:new Date().toISOString(),restEndsAt:end});
      await syncSet(w,s);startTimer(rest,e,w,n,end);
    };
  });
}
function startTimer(box,e,w,n,endsAt){
  box.classList.add('active');let end=new Date(endsAt).getTime();const out=box.querySelector('strong');
  const draw=()=>{const r=Math.max(0,Math.ceil((end-Date.now())/1000));out.textContent=`${String(Math.floor(r/60)).padStart(2,'0')}:${String(r%60).padStart(2,'0')}`;if(r<=0){out.textContent='FINE';return false}return true;};
  draw();if(timers.get(`${e.id}:${n}`))clearInterval(timers.get(`${e.id}:${n}`));
  const id=setInterval(()=>{if(!draw())clearInterval(id);},500);timers.set(`${e.id}:${n}`,id);
  box.querySelector('.add15').onclick=async()=>{end+=15000;const s=findSet(w,e.id,n);if(s){s.restEndsAt=new Date(end).toISOString();await syncSet(w,s);}draw();};
  box.querySelector('.skip').onclick=async()=>{clearInterval(id);box.classList.remove('active');const s=findSet(w,e.id,n);if(s){s.restEndsAt=null;await syncSet(w,s);}};
}

/* ===== GESTIONE SCHEDA ===== */
function renderProgram(){
  app.innerHTML=shell(`<div class="appbar"><div><small>La tua programmazione</small><strong>Scheda</strong></div></div>
  <div class="content">
    <div class="importcard">
      <div><div class="ey">Importazione automatica</div><h3>Carica il file Excel del PT</h3><p>GymFlow prova a riconoscere da solo sedute A/B/C, esercizi, serie, reps, recuperi, carichi, cadenza e note.</p></div>
      <input id="excelFile" type="file" accept=".xlsx,.xlsm,.csv" class="hidden">
      <button id="importExcel" class="start">Importa Excel</button>
      <small>Formati: .xlsx, .xlsm, .csv. I vecchi .xls vanno prima salvati come .xlsx.</small>
    </div>

    <div class="programtop"><div><div class="ey">Scheda attuale</div><b>${esc(state.program.title)}</b><small>v${state.program.version}${state.program.sourceFileName?' · '+esc(state.program.sourceFileName):''}</small></div><div id="programSaved" class="programsaved">✓ Salvata</div></div>

    ${state.program.sessions.map(sessionEditorHtml).join('')}
  </div>${nav('program')}`);
  bindNav();
  document.getElementById('importExcel').onclick=()=>document.getElementById('excelFile').click();
  document.getElementById('excelFile').onchange=handleExcelFile;
  bindProgramEditor();
}
function sessionEditorHtml(s){
  return `<section class="sessionedit" data-session-edit="${s.code}">
    <div class="sessionhead"><div><div class="ey">Allenamento</div><h3>Seduta ${s.code}</h3></div><button class="btn addexercise" data-add="${s.code}">+ Esercizio</button></div>
    <div class="exerciseeditlist">${s.exercises.length?s.exercises.map((e,i)=>exerciseEditorHtml(s,e,i)).join(''):'<div class="emptyprogram">Nessun esercizio. Aggiungine uno o importa il file Excel.</div>'}</div>
  </section>`;
}
function exerciseEditorHtml(s,e,i){
  return `<div class="exedit" data-edit-ex="${s.code}:${i}">
    <div class="exedithead"><b>${i+1}. ${esc(e.name)}</b><div><button class="iconbtn moveup" title="Sposta su">↑</button><button class="iconbtn movedown" title="Sposta giù">↓</button><button class="iconbtn danger deleteex" title="Elimina">×</button></div></div>
    <div class="editgrid">
      <label class="span2">Esercizio<input data-field="name" value="${esc(e.name)}"></label>
      <label>Serie<input data-field="sets" type="number" min="1" value="${e.sets}"></label>
      <label>Reps min<input data-field="repsMin" type="number" min="1" value="${e.repsMin}"></label>
      <label>Reps max<input data-field="repsMax" type="number" min="1" value="${e.repsMax}"></label>
      <label>Recupero<input data-field="restSec" value="${restInput(e.restSec)}" placeholder="1:30"></label>
      <label>Carico iniziale kg<input data-field="suggestedWeight" type="number" step="0.5" value="${e.suggestedWeight||0}"></label>
      <label>Reps proposte<input data-field="suggestedReps" type="number" min="1" value="${e.suggestedReps||e.repsMax}"></label>
      <label>Cadenza<input data-field="tempo" value="${esc(e.tempo||'—')}"></label>
      <label class="span2">Note<input data-field="note" value="${esc(e.note||'')}"></label>
    </div>
  </div>`;
}
function bindProgramEditor(){
  document.querySelectorAll('[data-edit-ex]').forEach(card=>{
    const [code,idxS]=card.dataset.editEx.split(':'),idx=Number(idxS);
    card.querySelectorAll('[data-field]').forEach(input=>{
      input.addEventListener('input',()=>{
        const e=state.program.sessions.find(s=>s.code===code).exercises[idx],field=input.dataset.field;
        if(['sets','repsMin','repsMax','suggestedWeight','suggestedReps'].includes(field))e[field]=Number(input.value)||0;
        else if(field==='restSec')e.restSec=parseRestInput(input.value);
        else e[field]=input.value;
        if(field==='name')card.querySelector('.exedithead>b').textContent=`${idx+1}. ${input.value||'Esercizio'}`;
        scheduleProgramSave();
      });
    });
    card.querySelector('.deleteex').onclick=()=>{
      if(!confirm('Eliminare questo esercizio dalla scheda?'))return;
      state.program.sessions.find(s=>s.code===code).exercises.splice(idx,1);saveProgramImmediate();
    };
    card.querySelector('.moveup').onclick=()=>moveExercise(code,idx,-1);
    card.querySelector('.movedown').onclick=()=>moveExercise(code,idx,1);
  });
  document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>addExercise(b.dataset.add));
}
function addExercise(code){
  const s=state.program.sessions.find(x=>x.code===code);
  s.exercises.push({id:uid(code.toLowerCase()),name:'Nuovo esercizio',sets:3,repsMin:8,repsMax:10,restSec:90,tempo:'—',note:'',suggestedWeight:0,suggestedReps:10});
  saveProgramImmediate();
}
function moveExercise(code,idx,delta){
  const arr=state.program.sessions.find(s=>s.code===code).exercises,n=idx+delta;
  if(n<0||n>=arr.length)return;
  [arr[idx],arr[n]]=[arr[n],arr[idx]];saveProgramImmediate();
}
function scheduleProgramSave(){
  const x=document.getElementById('programSaved');if(x)x.textContent='Salvataggio…';
  clearTimeout(programSaveTimer);programSaveTimer=setTimeout(saveProgram,700);
}
async function saveProgram(){
  state.program.updatedAt=new Date().toISOString();
  await mutate('save_program',{program:state.program},state);
  const x=document.getElementById('programSaved');if(x)x.textContent=navigator.onLine?'✓ Salvata':'✓ Salvata offline';
}
async function saveProgramImmediate(){
  await saveProgram();renderProgram();
}

async function handleExcelFile(e){
  const file=e.target.files?.[0];if(!file)return;
  if(!navigator.onLine)return toast('Per importare un nuovo Excel serve Internet. Dopo l’importazione la scheda sarà disponibile offline.');
  const btn=document.getElementById('importExcel');btn.disabled=true;btn.textContent='Analisi Excel…';
  try{
    const dataBase64=await fileToBase64(file);
    const r=await fetch('/api/program/import',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:file.name,dataBase64})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||'Errore importazione');
    importDraft=d.program;
    showImportPreview(d);
  }catch(err){toast(err.message,4500);}
  finally{btn.disabled=false;btn.textContent='Importa Excel';e.target.value='';}
}
function fileToBase64(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(String(r.result).split(',')[1]||'');
    r.onerror=()=>reject(new Error('Impossibile leggere il file'));
    r.readAsDataURL(file);
  });
}
function showImportPreview(d){
  const bg=document.createElement('div');bg.className='modalbg';bg.id='importModal';
  bg.innerHTML=`<div class="modal"><div class="ey">Anteprima importazione</div><h2>Ho letto la tua scheda</h2>
    <p class="muted">Controlla il numero di esercizi riconosciuti prima di sostituire la scheda attuale.</p>
    <div class="importsummary">${d.summary.map(s=>`<div class="importsession"><b>Seduta ${s.code}</b><strong>${s.count} esercizi</strong><small>${s.names.map(esc).join(' · ')||'Nessun esercizio'}</small></div>`).join('')}</div>
    ${(d.warnings||[]).length?`<div class="warn">${d.warnings.map(x=>`<div>⚠ ${esc(x)}</div>`).join('')}</div>`:''}
    <div class="modalactions"><button id="cancelImport" class="btn">Annulla</button><button id="confirmImport" class="btn white">Usa questa scheda</button></div>
  </div>`;
  document.body.appendChild(bg);
  document.getElementById('cancelImport').onclick=()=>{importDraft=null;bg.remove();};
  document.getElementById('confirmImport').onclick=commitImport;
}
async function commitImport(){
  if(!importDraft)return;
  const b=document.getElementById('confirmImport');b.disabled=true;b.textContent='Salvataggio…';
  try{
    const r=await fetch('/api/program/replace',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({program:importDraft})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||'Errore salvataggio');
    state.program=d.program;
    await saveState(state);
    importDraft=null;document.getElementById('importModal')?.remove();
    selectedSession='A';toast('Scheda importata correttamente');renderProgram();
  }catch(err){toast(err.message,4500);b.disabled=false;b.textContent='Usa questa scheda';}
}

/* ===== STORICO ===== */
function renderHistory(){
  const checks=[...state.checkins].sort((a,b)=>b.date.localeCompare(a.date));
  const workouts=[...state.workouts].filter(w=>w.status==='completed').sort((a,b)=>new Date(b.finishedAt)-new Date(a.finishedAt));
  app.innerHTML=shell(`<div class="appbar"><div><small>I tuoi dati</small><strong>Storico</strong></div></div>
  <div class="content">
    <div class="exportcard"><div><div class="ey">Da inviare al PT</div><b>Excel riepilogativo completo</b><small>Peso, vita, dieta, esercizi, serie, kg e reps.</small></div><button id="exportExcel" class="btn white">Scarica Excel</button></div>
    <div class="section"><h3>Diario giornaliero</h3><span>${checks.length} giorni</span></div>
    <div class="card">${checks.length?checks.map(c=>`<div class="diaryrow"><b>${fmtDate(c.date)}</b><span>${c.weight??'—'} kg</span><span>${c.waist??'—'} cm</span><span class="${c.diet==='non_rispettata'?'bad':'good'}">${c.diet==='rispettata'?'✓ dieta':c.diet==='non_rispettata'?'✕ dieta':'—'}</span></div>`).join(''):'<div class="muted">Nessun check-in ancora.</div>'}</div>
    <div class="section"><h3>Allenamenti</h3><span>dal più recente · ${workouts.length} completati</span></div>
    ${workouts.length?workouts.map((w,i)=>workoutHistoryHtml(w,i,workouts)).join(''):'<div class="card muted">Nessun allenamento completato.</div>'}
  </div>${nav('history')}`);
  bindNav();document.getElementById('exportExcel').onclick=exportExcel;
}
function workoutHistoryHtml(w,index=0,all=[]){
  const older=all[index+1];
  const gap=older?gapDays(w.finishedAt,older.finishedAt):null;
  const rank=index===0?'ULTIMO':index===1?'PRECEDENTE':'';
  return `<details class="histwork ${index===0?'latesthist':''}">
    <summary>
      <span>
        ${rank?`<em>${rank}</em>`:''}
        <b>${fmtDate(String(w.finishedAt).slice(0,10))} · Seduta ${esc(w.sessionCode)}</b>
        <small>${daysAgoLabel(w.finishedAt)} · ${(w.sets||[]).length} serie${gap!==null?` · intervallo ${gap} ${gap===1?'giorno':'giorni'}`:''}</small>
      </span><span>＋</span>
    </summary>
    <div class="histinside">${(w.exerciseSnapshot||[]).map(e=>{const sets=(w.sets||[]).filter(s=>s.exerciseId===e.id).sort((a,b)=>a.setNo-b.setNo);return `<div class="histEx"><b>${esc(e.name)}</b><div>${sets.length?sets.map(s=>`<span>${s.weight} kg × ${s.reps}</span>`).join(''):'<span class="muted">Nessuna serie registrata</span>'}</div></div>`;}).join('')}</div>
  </details>`;
}
async function exportExcel(){
  if(!navigator.onLine)return toast('Per creare il file Excel serve Internet. I dati offline sono comunque al sicuro.');
  await flush();
  const r=await fetch('/api/export.xlsx',{credentials:'include'});
  if(!r.ok)return toast('Errore nella creazione Excel');
  const blob=await r.blob(),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`GymFlow_${state.profile.firstName}_${today()}.xlsx`;a.click();URL.revokeObjectURL(a.href);
}

function renderProfile(){
  const standalone=window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true;
  app.innerHTML=shell(`<div class="appbar"><div><small>Profilo personale</small><strong>${esc(state.profile.firstName)} ${esc(state.profile.lastName)}</strong></div></div>
  <div class="content">
    <div class="profilegrid"><div class="profileitem"><small>Altezza</small><b>${state.profile.heightCm} cm</b></div><div class="profileitem"><small>Peso obiettivo</small><b>${state.profile.targetWeightKg} kg</b></div><div class="profileitem"><small>Versione scheda</small><b>v${state.program.version}</b></div><div class="profileitem"><small>Sedute</small><b>${state.program.sessions.length}</b></div></div>
    <div class="card info"><b>Offline-first</b><p>Check-in, scheda e allenamenti vengono salvati sul dispositivo e sincronizzati automaticamente quando torna Internet.</p></div>
    <div class="installcard"><div><div class="ey">Telefono</div><b>${standalone?'GymFlow è installata':'Installa GymFlow'}</b><p>${standalone?'La stai usando come app dalla schermata Home.':'Su iPhone apri questo sito in Safari, poi Condividi → Aggiungi alla schermata Home. Se sei nel browser interno di ChatGPT/WhatsApp, scegli prima “Apri in Safari”.'}</p></div>${standalone?'':`<button id="installBtn" class="btn white">Installa / istruzioni</button>`}</div>
  </div>${nav('profile')}`);
  bindNav();
  if(document.getElementById('installBtn'))document.getElementById('installBtn').onclick=async()=>{
    if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;}
    else alert('iPhone: apri GymFlow in Safari → premi Condividi (quadrato con freccia) → Aggiungi alla schermata Home. Se hai aperto il link dentro ChatGPT, WhatsApp o un altro browser interno, scegli prima “Apri in Safari”.');
  };
}

async function boot(){
  if('serviceWorker' in navigator){
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(sessionStorage.getItem('gymflow-sw-reloaded')==='1')return;
      sessionStorage.setItem('gymflow-sw-reloaded','1');
      location.reload();
    });
    navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(reg=>reg.update()).catch(()=>{});
  }
  initSync();
  let auth=null;
  try{if(navigator.onLine){const r=await fetch('/api/me',{credentials:'include'});if(r.ok)auth=(await r.json()).user;}}catch{}
  if(!auth)auth=await localAuth();
  if(!auth)return loginView();
  try{state=await bootstrap();render();}catch(e){loginView(e.message);}
}
boot();
