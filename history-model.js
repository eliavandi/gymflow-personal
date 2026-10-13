import {localDayKey} from './today-model.js';

export function validDayKey(key){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(key)))return false;
  const d=new Date(`${key}T12:00:00`);
  return Number.isFinite(d.getTime())&&localDayKey(d)===key;
}

export function historyRange(period='all',now=new Date()){
  const to=localDayKey(now);
  if(period==='all')return {from:'',to};
  const start=new Date(`${to}T12:00:00`);
  start.setDate(start.getDate()-Number(period)+1);
  return {from:localDayKey(start),to};
}

const number=v=>v!==null&&v!==''&&v!==undefined&&Number.isFinite(Number(v))?Number(v):null;
const sum=(items,key)=>items.reduce((total,item)=>total+item[key],0);

export function workoutStats(w){
  const sets=(w.sets||[]).filter(s=>s.completedAt&&number(s.reps)>0&&number(s.weight)!==null&&number(s.weight)>=0);
  const reps=sets.reduce((n,s)=>n+Number(s.reps),0);
  const volume=sets.reduce((n,s)=>n+Number(s.weight)*Number(s.reps),0);
  const elapsed=new Date(w.finishedAt)-new Date(w.startedAt);
  return {sets:sets.length,reps,volume,minutes:Number.isFinite(elapsed)&&elapsed>=0?elapsed/60000:null};
}

function measurement(checks,key){
  const points=checks.filter(c=>number(c[key])>0).map(c=>({date:c.date,value:Number(c[key])}));
  const first=points[0]||null,last=points.at(-1)||null;
  return {points,first,last,change:points.length>1?last.value-first.value:null,
    average:points.length?points.reduce((n,p)=>n+p.value,0)/points.length:null,
    min:points.length?Math.min(...points.map(p=>p.value)):null,
    max:points.length?Math.max(...points.map(p=>p.value)):null};
}

export function historyStats(state,range=historyRange()){
  const within=day=>validDayKey(day)&&(!range.from||day>=range.from)&&(!range.to||day<=range.to);
  const checks=(state.checkins||[]).filter(c=>within(c.date)).sort((a,b)=>a.date.localeCompare(b.date));
  const workouts=(state.workouts||[]).filter(w=>w.status==='completed'&&w.finishedAt&&within(localDayKey(w.finishedAt)))
    .sort((a,b)=>new Date(a.finishedAt)-new Date(b.finishedAt));
  const metrics=workouts.map(workoutStats),timed=metrics.filter(m=>m.minutes!==null);
  const respected=checks.filter(c=>c.diet==='rispettata').length;
  const missed=checks.filter(c=>c.diet==='non_rispettata').length;
  const exerciseMap=new Map();
  for(const w of workouts){
    const sessionExercises=new Map();
    for(const s of w.sets||[]){
      if(!s.completedAt||number(s.reps)<=0||number(s.reps)===null||number(s.weight)===null||number(s.weight)<0)continue;
      const ex=(w.exerciseSnapshot||[]).find(e=>e.id===s.exerciseId);
      const name=String(ex?.name||'Esercizio senza nome').trim();
      const key=ex?name.toLocaleLowerCase('it').replace(/\s+/g,' '):`unknown:${s.exerciseId}`;
      if(!exerciseMap.has(key))exerciseMap.set(key,{key,name,sets:0,reps:0,volume:0,bestWeight:0,history:[]});
      const entry=exerciseMap.get(key);
      entry.sets++;entry.reps+=Number(s.reps);entry.volume+=Number(s.weight)*Number(s.reps);
      entry.bestWeight=Math.max(entry.bestWeight,Number(s.weight));
      if(!sessionExercises.has(key))sessionExercises.set(key,{date:localDayKey(w.finishedAt),workoutId:w.id,sessionCode:w.sessionCode,sets:0,reps:0,volume:0,value:0});
      const point=sessionExercises.get(key);
      point.sets++;point.reps+=Number(s.reps);point.volume+=Number(s.weight)*Number(s.reps);point.value=Math.max(point.value,Number(s.weight));
    }
    for(const [key,point] of sessionExercises)exerciseMap.get(key).history.push(point);
  }
  const sessions=[...new Set(workouts.map(w=>w.sessionCode))].sort().map(code=>({code,count:workouts.filter(w=>w.sessionCode===code).length}));
  return {checks,workouts,weight:measurement(checks,'weight'),waist:measurement(checks,'waist'),
    diet:{respected,missed,recorded:respected+missed,rate:respected+missed?100*respected/(respected+missed):null},
    training:{count:workouts.length,activeDays:new Set(workouts.map(w=>localDayKey(w.finishedAt))).size,
      sets:sum(metrics,'sets'),reps:sum(metrics,'reps'),volume:sum(metrics,'volume'),
      minutes:timed.length?sum(timed,'minutes'):null,averageMinutes:timed.length?sum(timed,'minutes')/timed.length:null,sessions},
    exercises:[...exerciseMap.values()].sort((a,b)=>a.name.localeCompare(b.name,'it'))};
}
