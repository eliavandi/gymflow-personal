import {login,logout,localAuth,bootstrap,saveState,mutate,flush,initSync} from './sync.js';
import {localDayKey,weeklyActivity,todayTasks} from './today-model.js';

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
const openSessions=new Set();
const openExercises=new Set();
let selectedHomeDay=null;
let homeDate=null;

function icon(name){
  const paths={home:'<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',workout:'<path d="M6 5v14M3 8v8M18 5v14M21 8v8M6 12h12"/>',program:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v4H9zM9 12h6M9 16h4"/>',history:'<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/>',profile:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',chevron:'<path d="m6 9 6 6 6-6"/>',check:'<path d="m5 12 4 4L19 6"/>'};
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.arrow}</svg>`;
}

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

function lastWorkoutForSession(code){
  return completedWorkouts().find(w=>w.sessionCode===code)||null;
}
function sessionChoicesHtml(){
  return `<div class="sessionchoices">${state.program.sessions.map(s=>{
    const last=lastWorkoutForSession(s.code);
    const when=last?daysAgoLabel(last.finishedAt):'mai fatta';
    return `<button class="sessionchoice" data-start-session="${s.code}">
      <div class="sessionletter">${esc(s.code)}</div>
      <div class="sessionchoicebody">
        <b>Seduta ${esc(s.code)}</b>
        <span>${s.exercises.length} esercizi · ultima: ${esc(when)}</span>
      </div>
      <div class="sessionarrow">${icon('arrow')}</div>
    </button>`;
  }).join('')}</div>`;
}
function bindSessionChoices(){
  document.querySelectorAll('[data-start-session]').forEach(b=>{
    b.onclick=()=>startWorkout(b.dataset.startSession);
  });
}
function completedSetCount(w){
  return (w?.sets||[]).filter(s=>s.completedAt).length;
}

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});
window.addEventListener('appinstalled',()=>{installPrompt=null;toast('GymFlow installata');});

window.addEventListener('gymflow-sync',e=>{
  const d=e.detail||{};
  let el=document.getElementById('syncBadge');
  if(!el){el=document.createElement('div');el.id='syncBadge';document.body.appendChild(el);}
  el.className='syncbadge '+(d.online?'online':'offline');
  el.textContent=!d.online?`Offline · ${d.pending||0} in attesa`:d.error?'Salvato sul dispositivo · riprovo':d.pending?`Sincronizzazione · ${d.pending}`:'Sincronizzato';
});

window.addEventListener('gymflow-program-refresh',e=>{
  if(!state)return;
  clearTimeout(programSaveTimer);programSaveTimer=null;
  state.program=e.detail.program;
  if(view==='program')renderProgram();
  if(view==='home')renderHome();
  toast('Scheda aggiornata: le modifiche alla vecchia scheda non sono state applicate.',5000);
});

function shell(content){
  return `<div class="shell"><header class="brandrow"><div class="brand"><span class="brandmark" aria-hidden="true">///</span> GymFlow<span class="branddot">.</span></div><button id="logoutBtn" class="btn">Esci</button></header><main class="phone">${content}</main></div>`;
}
function nav(active){
  return `<nav class="nav five" aria-label="Navigazione principale">${[['home','Oggi'],['workout','Workout'],['program','Scheda'],['history','Storico'],['profile','Profilo']].map(([key,label])=>`<button data-nav="${key}" class="${active===key?'active':''}" ${active===key?'aria-current="page"':''}>${icon(key)}<span>${label}</span></button>`).join('')}</nav>`;
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
  const now=new Date(),day=today(),week=weeklyActivity(state.workouts,now);
  if(homeDate!==day){selectedHomeDay=day;homeDate=day;}
  if(!week.days.some(d=>d.key===selectedHomeDay))selectedHomeDay=day;
  const tasks=todayTasks(c,state.workouts,now),done=tasks.filter(t=>t.done).length;
  const missing=tasks.filter(t=>!t.done).map(t=>t.label.toLowerCase());
  const range=week.days[0].date.toLocaleDateString('it-IT',{day:'numeric'})+'–'+week.days[6].date.toLocaleDateString('it-IT',{day:'numeric',month:'short'});
  app.innerHTML=shell(`<div class="appbar dashboardbar"><div><small>${now.toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'})}</small><h1>La tua giornata<span class="branddot">.</span></h1></div><div class="daycompletion" aria-label="${done} di 4 attività registrate"><b>${done}<span>/4</span></b><small>completate</small></div></div>
  <div class="content dashboard">
    <div class="dailyagenda" aria-live="polite"><span>${missing.length?'Da completare: '+missing.join(', '):'Tutto registrato per oggi.'}</span><div class="tasktrack" aria-hidden="true">${tasks.map(t=>`<i class="${t.done?'done':''}"></i>`).join('')}</div></div>
    <div class="measureheading"><h2>Peso e misure</h2><button id="dailyNotes" class="textlink">${c.notes?'Le tue note':'＋ Nota'}</button></div>
    <div class="measurestrip">
      <button id="editWeight" class="measureaction ${c.weight>0?'recorded':''}" aria-label="${c.weight>0?'Modifica peso, '+c.weight+' kg':'Inserisci il peso di oggi'}"><span>Peso <small>kg</small></span><strong>${c.weight>0?esc(String(c.weight).replace('.',',')):'—'}</strong><small>${c.weight>0?'Registrato oggi':'Inserisci il peso'} ${icon(c.weight>0?'check':'arrow')}</small></button>
      <button id="editWaist" class="measureaction ${c.waist>0?'recorded':''}" aria-label="${c.waist>0?'Modifica circonferenza vita, '+c.waist+' cm':'Inserisci la circonferenza vita di oggi'}"><span>Vita <small>cm</small></span><strong>${c.waist>0?esc(String(c.waist).replace('.',',')):'—'}</strong><small>${c.waist>0?'Registrata oggi':'Inserisci le misure'} ${icon(c.waist>0?'check':'arrow')}</small></button>
    </div>
    <section class="weeksection" aria-labelledby="weekTitle">
      <div class="weekheading"><h2 id="weekTitle">Questa settimana</h2><span>${range}</span></div>
      <div class="weekstats"><strong>${week.total}</strong><span>${week.total===1?'allenamento':'allenamenti'} <small>· ${week.activeDays} ${week.activeDays===1?'giorno attivo':'giorni attivi'}</small></span></div>
      <div class="weekcalendar" aria-label="Allenamenti della settimana">${week.days.map(d=>{
        const trained=d.workouts.length>0,selected=d.key===selectedHomeDay;
        const description=d.date.toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'})+', '+(trained?d.workouts.length+' allenamenti completati':'nessun allenamento completato');
        return `<button class="weekdate ${trained?'trained':''} ${d.key===day?'istoday':''} ${selected?'selected':''}" data-calendar-day="${d.key}" aria-pressed="${selected}" ${d.key===day?'aria-current="date"':''} aria-label="${esc(description)}"><span>${d.date.toLocaleDateString('it-IT',{weekday:'short'}).slice(0,3)}</span><b>${d.date.getDate()}</b><small>${trained?esc(d.workouts.map(w=>w.sessionCode).join('·')):d.key===day?'oggi':'·'}</small></button>`;
      }).join('')}</div>
    </section>
    <div id="dayActivity" class="dayactivity" aria-live="polite">${dayActivityHtml(week)}</div>
    <section class="dietdashboard" aria-labelledby="dietLabel"><div class="dietheading"><h2 id="dietLabel">${c.diet?'Dieta registrata':'Come va la dieta?'}</h2><span>${c.diet?icon('check'):'Da aggiornare'}</span></div><div class="diettoggle" role="group" aria-labelledby="dietLabel"><button data-diet="rispettata" aria-pressed="${c.diet==='rispettata'}" class="${c.diet==='rispettata'?'active':''}">${c.diet==='rispettata'?'✓ ':''}Rispettata</button><button data-diet="non_rispettata" aria-pressed="${c.diet==='non_rispettata'}" class="${c.diet==='non_rispettata'?'active':''}">${c.diet==='non_rispettata'?'✓ ':''}Non rispettata</button></div></section>
  </div>${nav('home')}`);
  bindNav();
  document.getElementById('editWeight').onclick=()=>openDailyCheckin('weight');
  document.getElementById('editWaist').onclick=()=>openDailyCheckin('waist');
  document.getElementById('dailyNotes').onclick=()=>openDailyCheckin('notes');
  document.querySelectorAll('[data-calendar-day]').forEach(b=>b.onclick=()=>{
    selectedHomeDay=b.dataset.calendarDay;
    document.querySelectorAll('[data-calendar-day]').forEach(x=>{const active=x.dataset.calendarDay===selectedHomeDay;x.classList.toggle('selected',active);x.setAttribute('aria-pressed',String(active));});
    document.getElementById('dayActivity').innerHTML=dayActivityHtml(week);bindDayActivity();
  });
  document.querySelectorAll('[data-diet]').forEach(b=>b.onclick=()=>{
    const value=b.dataset.diet;queueCheckin({diet:value});
    document.querySelector(`[data-diet="${value}"]`)?.focus({preventScroll:true});
  });
  bindDayActivity();
}
function dayActivityHtml(week){
  const day=week.days.find(d=>d.key===selectedHomeDay),isToday=day.key===today();
  const aw=isToday?activeWorkout():null,workouts=day.workouts;
  let title,detail,action,label,status='';
  if(aw){
    title=`Seduta ${esc(aw.sessionCode)} in corso`;detail=`${completedSetCount(aw)} serie registrate · riprendi quando vuoi`;action='workout';label='Riprendi';status='ongoing';
  }else if(workouts.length){
    title=isToday?'Allenamento completato!':day.date.toLocaleDateString('it-IT',{weekday:'long',day:'numeric'});
    detail=workouts.map(w=>`Seduta ${esc(w.sessionCode)} · ${completedSetCount(w)} serie`).join(' / ');
    action='history';label='Vedi';status='completed';
  }else{
    title=isToday?'Oggi non ti sei ancora allenato':day.date.toLocaleDateString('it-IT',{weekday:'long',day:'numeric'});
    detail=isToday?'Quando vuoi, la tua scheda è pronta.':day.key>today()?'Giornata futura.':'Nessun allenamento registrato.';
    action=isToday?'workout':'today';label=isToday?'Allenati':'Oggi';
  }
  return `<div class="daystatus ${status}"><span class="daystatusicon">${icon(status==='completed'?'check':'workout')}</span><div><b>${title}</b><small>${detail}</small></div><button class="dayaction" data-day-action="${action}">${label} ${icon('arrow')}</button></div>`;
}
function bindDayActivity(){
  document.querySelector('[data-day-action]').onclick=e=>{
    const action=e.currentTarget.dataset.dayAction;
    if(action==='today'){selectedHomeDay=today();renderHome();}
    else{view=action;render();}
  };
}
function openDailyCheckin(field){
  const c=getCheckin()||{},origin=field==='weight'?'editWeight':field==='waist'?'editWaist':'dailyNotes';
  const dialog=document.createElement('dialog');dialog.className='checkinDialog';dialog.id='dailyCheckinDialog';
  dialog.setAttribute('aria-labelledby','checkinDialogTitle');
  dialog.innerHTML=`<form id="dailyCheckinForm"><div class="dialogheading"><div><div class="ey">Il check-in di oggi</div><h2 id="checkinDialogTitle">Peso e misure</h2></div><button type="button" id="closeCheckin" class="iconbtn" aria-label="Chiudi">×</button></div><div class="dialogmetrics"><label for="weight">Peso · kg<input id="weight" type="number" min="1" step="0.1" inputmode="decimal" value="${c.weight??''}" placeholder="Es. 80,5"></label><label for="waist">Vita · cm<input id="waist" type="number" min="1" step="0.1" inputmode="decimal" value="${c.waist??''}" placeholder="Es. 84"></label></div><label class="dialognotes" for="notes">Note della giornata<input id="notes" value="${esc(c.notes||'')}" placeholder="Energia, sonno, come ti senti…"></label><div id="autosaveText" class="autosave" role="status">Salvataggio automatico, anche offline</div><button class="start" type="submit">Fatto ${icon('check')}</button></form>`;
  document.body.appendChild(dialog);
  const save=()=>{
    const weight=dialog.querySelector('#weight'),waist=dialog.querySelector('#waist');
    if(!weight.validity.valid||!waist.validity.valid)return;
    queueCheckin({weight:weight.value===''?null:Number(weight.value),waist:waist.value===''?null:Number(waist.value),notes:dialog.querySelector('#notes').value.trim()});
  };
  dialog.querySelectorAll('input').forEach(input=>input.addEventListener('input',save));
  dialog.querySelector('form').onsubmit=e=>{e.preventDefault();save();dialog.close();};
  dialog.querySelector('#closeCheckin').onclick=()=>dialog.close();
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  dialog.onclose=()=>{dialog.remove();if(view==='home'&&state){renderHome();document.getElementById(origin)?.focus({preventScroll:true});}};
  dialog.showModal();dialog.querySelector('#'+field).focus();
}
function queueCheckin(patch){
  const old=getCheckin()||{id:uid('check'),date:today()};
  const row={...old,...patch,date:today(),updatedAt:new Date().toISOString()};
  const i=state.checkins.findIndex(x=>x.date===row.date);if(i>=0)state.checkins[i]=row;else state.checkins.push(row);
  const snapshot=state;
  clearTimeout(checkSaveTimer);checkSaveTimer=setTimeout(()=>saveCheckin(row,snapshot),400);
  if(view==='home')renderHome();
  const t=document.getElementById('autosaveText');if(t)t.textContent='Salvataggio…';
}
async function saveCheckin(row,snapshot){
  try{
    await mutate('upsert_checkin',row,snapshot);
    const t=document.getElementById('autosaveText');if(t)t.textContent=navigator.onLine?'✓ Salvato · sincronizzazione automatica':'✓ Salvato offline sul dispositivo';
  }catch{toast('Salvataggio non riuscito. Riprova.',4000);}
}
function refreshHomeDate(){
  if(state&&view==='home'&&homeDate!==today()&&!document.getElementById('dailyCheckinDialog'))renderHome();
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshHomeDate();});
setInterval(refreshHomeDate,60000);

async function startWorkout(code){
  const target=code||selectedSession||'A';
  const current=activeWorkout();

  if(current){
    if(current.sessionCode===target){
      view='workout';
      return render();
    }

    const done=completedSetCount(current);
    if(done>0){
      const ok=confirm(`Hai già registrato ${done} ${done===1?'serie':'serie'} nella seduta ${current.sessionCode}. Vuoi annullarla e iniziare la seduta ${target}?`);
      if(!ok)return;
    }
    await cancelWorkout(current,{silent:true,stay:true});
  }

  const template=sessionTemplate(target);
  if(!template||!template.exercises.length)return toast(`La seduta ${target} non contiene esercizi`);

  const w={
    id:uid('ws'),
    sessionCode:target,
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
  view='workout';
  render();
}

async function cancelWorkout(w=activeWorkout(),options={}){
  if(!w)return;
  const done=completedSetCount(w);

  if(!options.silent && done>0){
    const ok=confirm(`Annullare la seduta ${w.sessionCode}? Le ${done} serie registrate in questo allenamento non compariranno nello storico.`);
    if(!ok)return;
  }

  w.status='cancelled';
  w.cancelledAt=new Date().toISOString();
  w.updatedAt=w.cancelledAt;
  await mutate('cancel_workout',{workoutId:w.id,cancelledAt:w.cancelledAt},state);

  if(!options.silent)toast(`Seduta ${w.sessionCode} annullata`);
  if(!options.stay){
    view='home';
    render();
  }
}

function renderWorkout(){
  const w=activeWorkout();

  if(!w){
    app.innerHTML=shell(`<div class="appbar"><div><small>Allenamento</small><strong>Scegli la seduta</strong></div></div>
    <div class="content">
      ${sessionChoicesHtml()}
      <div class="section recenttitle"><h3>Ultime sedute</h3><span>ordine e cadenza</span></div>
      <div class="recentlist">${recentWorkoutHtml(3)}</div>
    </div>${nav('workout')}`);
    bindNav();
    bindSessionChoices();
    document.querySelectorAll('[data-open-history]').forEach(b=>b.onclick=()=>{view='history';render();});
    return;
  }

  const totalSets=(w.exerciseSnapshot||[]).reduce((sum,e)=>sum+Number(e.sets||0),0);
  const done=completedSetCount(w);
  const pct=totalSets?Math.round(done/totalSets*100):0;

  app.innerHTML=shell(`<div class="appbar workoutbar">
    <div><small>Allenamento in corso</small><strong>Seduta ${esc(w.sessionCode)}</strong></div>
    <button id="leaveWorkout" class="btn">Esci</button>
  </div>
  <div class="content">
    <div class="workprogress">
      <div><b>${done}/${totalSets}</b><span>serie completate</span></div>
      <div class="progressbar"><i style="width:${pct}%"></i></div>
    </div>

    <div class="section"><h3>Esercizi</h3><span>scegli l'ordine che vuoi</span></div>
    ${w.exerciseSnapshot.map(e=>{
      const completed=(w.sets||[]).filter(s=>s.exerciseId===e.id&&s.completedAt).length;
      return `<button class="exercise ${completed>=e.sets?'exercisecomplete':''}" data-ex="${e.id}">
        <div><b>${esc(e.name)}</b><small>${e.sets}×${e.repsMin}-${e.repsMax} · recupero ${restLabel(e.restSec)}</small></div>
        <span>${completed}/${e.sets} ›</span>
      </button>`;
    }).join('')}

    <div class="workoutactions">
      <button id="finishWorkout" class="start">Termina allenamento</button>
      <button id="cancelWorkout" class="cancelwork">Annulla allenamento</button>
    </div>
  </div>${nav('workout')}`);

  bindNav();
  document.querySelectorAll('[data-ex]').forEach(b=>b.onclick=()=>{activeExerciseId=b.dataset.ex;view='exercise';render();});
  document.getElementById('leaveWorkout').onclick=()=>{view='home';render();};
  document.getElementById('finishWorkout').onclick=finishWorkout;
  document.getElementById('cancelWorkout').onclick=()=>cancelWorkout(w);
}

async function finishWorkout(){
  const w=activeWorkout();if(!w)return;
  const done=completedSetCount(w);
  if(done===0){
    const ok=confirm('Non hai registrato nessuna serie. Vuoi davvero terminare questo allenamento?');
    if(!ok)return;
  }
  w.status='completed';
  w.finishedAt=new Date().toISOString();
  await mutate('finish_workout',{workoutId:w.id,finishedAt:w.finishedAt,workout:w},state);
  toast('Allenamento salvato');
  view='home';
  render();
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
  app.innerHTML=shell(`<div class="appbar"><div><small>Seduta ${w.sessionCode}</small><strong>Esercizio</strong></div><button id="backWorkout" class="btn">Esercizi</button></div>
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
  <div class="content programcontent">
    <div class="importcard">
      <div><div class="ey">Dal tuo personal trainer</div><h3>La tua scheda, in un file.</h3><p>Importa l’Excel e controlla l’anteprima prima di confermare.</p></div>
      <input id="excelFile" type="file" accept=".xlsx,.xlsm,.csv" class="hidden">
      <button id="importExcel" class="start">Importa Excel</button>
      <small>Formati: .xlsx, .xlsm, .csv. I vecchi .xls vanno prima salvati come .xlsx.</small>
    </div>

    <div class="programtop"><div><div class="ey">Il tuo programma</div><b>${esc(state.program.title)}</b><small>${state.program.sessions.reduce((n,s)=>n+s.exercises.length,0)} esercizi · ${state.program.sessions.length} sedute${state.program.sourceFileName?' · '+esc(state.program.sourceFileName):''}</small></div><div id="programSaved" class="programsaved" role="status">✓ Salvata</div></div>
    <p class="editorhint">Apri una seduta, poi un esercizio per modificarlo.</p>

    ${state.program.sessions.map(sessionEditorHtml).join('')}
  </div>${nav('program')}`);
  bindNav();
  document.getElementById('importExcel').onclick=()=>document.getElementById('excelFile').click();
  document.getElementById('excelFile').onchange=handleExcelFile;
  bindProgramEditor();
}
function sessionEditorHtml(s){
  return `<details class="sessionedit" data-session-edit="${s.code}" ${openSessions.has(s.code)?'open':''}>
    <summary class="sessionhead"><span class="sessioninitial">${esc(s.code)}</span><span><b>Seduta ${esc(s.code)}</b><small>${s.exercises.length} esercizi · ${s.exercises.reduce((n,e)=>n+Number(e.sets||0),0)} serie</small></span><span class="disclosure">${icon('chevron')}</span></summary>
    <div class="exerciseeditlist">${s.exercises.length?s.exercises.map((e,i)=>exerciseEditorHtml(s,e,i)).join(''):'<div class="emptyprogram">Nessun esercizio. Aggiungine uno o importa il file Excel.</div>'}</div>
    <button class="textlink addexercise" data-add="${s.code}">+ Aggiungi esercizio</button>
  </details>`;
}
function exerciseEditorHtml(s,e,i){
  return `<details class="exedit" data-edit-ex="${s.code}:${i}" data-exercise-id="${esc(e.id)}" ${openExercises.has(e.id)?'open':''}>
    <summary class="exedithead"><span class="exnumber">${String(i+1).padStart(2,'0')}</span><span class="exheading"><b>${esc(e.name)}</b><small class="exsummary">${exerciseSummary(e)}</small></span><span class="disclosure">${icon('chevron')}</span></summary>
    <div class="exeditbody"><div class="exedittools"><span>Modifica esercizio</span><div><button class="iconbtn moveup" aria-label="Sposta su" ${i===0?'disabled':''}>↑</button><button class="iconbtn movedown" aria-label="Sposta giù" ${i===s.exercises.length-1?'disabled':''}>↓</button><button class="iconbtn danger deleteex" aria-label="Elimina esercizio">×</button></div></div>
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
    </div></div>
  </details>`;
}
function exerciseSummary(e){return `${e.sets} serie × ${e.repsMin}${e.repsMax!==e.repsMin?'–'+e.repsMax:''} reps · ${restLabel(e.restSec)} recupero`;}
function bindProgramEditor(){
  document.querySelectorAll('[data-session-edit]').forEach(el=>el.addEventListener('toggle',()=>{if(el.open)openSessions.add(el.dataset.sessionEdit);else openSessions.delete(el.dataset.sessionEdit);}));
  document.querySelectorAll('[data-edit-ex]').forEach(card=>{
    card.addEventListener('toggle',()=>{if(card.open)openExercises.add(card.dataset.exerciseId);else openExercises.delete(card.dataset.exerciseId);});
    const [code,idxS]=card.dataset.editEx.split(':'),idx=Number(idxS);
    card.querySelectorAll('[data-field]').forEach(input=>{
      input.addEventListener('input',()=>{
        const e=state.program.sessions.find(s=>s.code===code).exercises[idx],field=input.dataset.field;
        if(['sets','repsMin','repsMax','suggestedWeight','suggestedReps'].includes(field))e[field]=Number(input.value)||0;
        else if(field==='restSec')e.restSec=parseRestInput(input.value);
        else e[field]=input.value;
        if(field==='name')card.querySelector('.exheading>b').textContent=input.value||'Esercizio';
        card.querySelector('.exsummary').textContent=exerciseSummary(e);
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
  openSessions.add(code);openExercises.add(s.exercises.at(-1).id);
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
  clearTimeout(programSaveTimer);programSaveTimer=null;
  if(!state)return;
  state.program.updatedAt=new Date().toISOString();
  await mutate('save_program',{program:state.program},state);
  const x=document.getElementById('programSaved');if(x)x.textContent=navigator.onLine?'✓ Salvata':'✓ Salvata offline';
}
async function saveProgramImmediate(){
  await saveProgram();if(state&&view==='program')renderProgram();
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
    if(programSaveTimer)await saveProgram();
    if(!await flush())throw new Error('Attendi la sincronizzazione delle modifiche e riprova. La scheda attuale è al sicuro.');
    const r=await fetch('/api/program/replace',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({program:importDraft})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||'Errore salvataggio');
    state.program=d.program;
    await saveState(state);
    openSessions.clear();openExercises.clear();
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
