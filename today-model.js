export function localDayKey(value=new Date()){
  const d=new Date(value);
  if(!Number.isFinite(d.getTime()))return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function weeklyActivity(workouts,now=new Date()){
  const monday=new Date(now);
  monday.setHours(12,0,0,0);
  monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
  const days=Array.from({length:7},(_,i)=>{
    const date=new Date(monday);date.setDate(date.getDate()+i);
    const key=localDayKey(date);
    return {key,date,workouts:workouts.filter(w=>w.status==='completed'&&w.finishedAt&&localDayKey(w.finishedAt)===key)};
  });
  return {days,total:days.reduce((n,d)=>n+d.workouts.length,0),activeDays:days.filter(d=>d.workouts.length).length};
}

export function todayTasks(checkin,workouts,now=new Date()){
  const trained=workouts.some(w=>w.status==='completed'&&w.finishedAt&&localDayKey(w.finishedAt)===localDayKey(now));
  return [
    {key:'weight',label:'Peso',done:checkin.weight>0},
    {key:'waist',label:'Misure',done:checkin.waist>0},
    {key:'workout',label:'Allenamento',done:trained},
    {key:'diet',label:'Dieta',done:Boolean(checkin.diet)}
  ];
}
