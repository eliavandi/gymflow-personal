import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = __dirname;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'gymflow.json');
const PORT = Number(process.env.PORT || 4173);
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const USE_POSTGRES = Boolean(DATABASE_URL);

const APP_EMAIL = String(process.env.APP_EMAIL || 'elia@gymflow.local').trim().toLowerCase();
const APP_PASSWORD = String(process.env.APP_PASSWORD || 'demo1234');
const SESSION_SECRET = String(process.env.SESSION_SECRET || 'gymflow-dev-change-this-secret');
const COOKIE_NAME = 'gymflow_session';
const BUILD_ID = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

let pgPool = null;
let writeQueue = Promise.resolve();

const nowIso = () => new Date().toISOString();
const uid = (prefix='id') => `${prefix}_${crypto.randomUUID().replaceAll('-','')}`;

function dateKey(d = new Date()){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function seedState(){
  return {
    schemaVersion: 2,
    profile: { firstName:'Elia', lastName:'Vandi', heightCm:193, targetWeightKg:80 },
    program: {
      id:'program_v1', version:1, title:'Fullbody 3 sedute', updatedAt:nowIso(),
      sourceType:'demo', sourceFileName:null,
      sessions:[
        {code:'A',title:'Seduta A',exercises:[
          {id:'a1',name:'Leg press 45°',sets:4,repsMin:6,repsMax:8,restSec:150,tempo:'—',note:'',suggestedWeight:180,suggestedReps:8},
          {id:'a2',name:'Leg extension',sets:3,repsMin:8,repsMax:10,restSec:90,tempo:'1s picco',note:'',suggestedWeight:65,suggestedReps:10},
          {id:'a3',name:'Chest press',sets:3,repsMin:8,repsMax:10,restSec:90,tempo:'—',note:'',suggestedWeight:80,suggestedReps:10}
        ]},
        {code:'B',title:'Seduta B',exercises:[
          {id:'b1',name:'Lat machine triangolo',sets:4,repsMin:6,repsMax:8,restSec:150,tempo:'—',note:'',suggestedWeight:70,suggestedReps:8},
          {id:'b2',name:'Low Row',sets:3,repsMin:8,repsMax:10,restSec:90,tempo:'1s picco',note:'',suggestedWeight:60,suggestedReps:10},
          {id:'b3',name:'Leg curl seduto',sets:4,repsMin:8,repsMax:10,restSec:105,tempo:'3s eccentrica',note:'',suggestedWeight:45,suggestedReps:10}
        ]},
        {code:'C',title:'Seduta C',exercises:[
          {id:'c1',name:'Rematore manubrio singolo',sets:3,repsMin:6,repsMax:8,restSec:105,tempo:'—',note:'',suggestedWeight:34,suggestedReps:8},
          {id:'c2',name:'Pulley triangolo',sets:3,repsMin:8,repsMax:10,restSec:90,tempo:'1s picco',note:'',suggestedWeight:65,suggestedReps:10},
          {id:'c3',name:'Spinte manubri panca piana',sets:3,repsMin:6,repsMax:8,restSec:120,tempo:'1s fermo',note:'',suggestedWeight:32,suggestedReps:8}
        ]}
      ]
    },
    programHistory: [],
    checkins: [],
    workouts: [],
    appliedMutations: []
  };
}

function normalizeState(s){
  const seed=seedState();
  if(!s || typeof s!=='object') return seed;
  s.schemaVersion=2;
  s.profile=s.profile||seed.profile;
  s.program=s.program||seed.program;
  s.programHistory=Array.isArray(s.programHistory)?s.programHistory:[];
  s.checkins=Array.isArray(s.checkins)?s.checkins:[];
  s.workouts=Array.isArray(s.workouts)?s.workouts:[];
  s.appliedMutations=Array.isArray(s.appliedMutations)?s.appliedMutations:[];
  return s;
}

async function getPool(){
  if(!USE_POSTGRES) return null;
  if(pgPool) return pgPool;
  const { Pool } = await import('pg');
  pgPool = new Pool({
    connectionString:DATABASE_URL,
    ssl:process.env.PGSSLMODE==='disable'?false:{rejectUnauthorized:false},
    max:5
  });
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS gymflow_state (
      id integer PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  return pgPool;
}

async function ensureState(){
  if(USE_POSTGRES){
    const pool=await getPool();
    const r=await pool.query('SELECT id FROM gymflow_state WHERE id=1');
    if(!r.rowCount){
      await pool.query('INSERT INTO gymflow_state (id,data) VALUES (1,$1::jsonb)',[JSON.stringify(seedState())]);
    }
    return;
  }
  await fs.mkdir(DATA_DIR,{recursive:true});
  try{await fs.access(DB_FILE);}catch{
    await fs.writeFile(DB_FILE,JSON.stringify(seedState(),null,2));
  }
}

async function readState(){
  await ensureState();
  if(USE_POSTGRES){
    const pool=await getPool();
    const r=await pool.query('SELECT data FROM gymflow_state WHERE id=1');
    return normalizeState(r.rows[0].data);
  }
  return normalizeState(JSON.parse(await fs.readFile(DB_FILE,'utf8')));
}

async function writeState(state){
  state=normalizeState(state);
  if(USE_POSTGRES){
    const pool=await getPool();
    writeQueue=writeQueue.then(()=>pool.query(
      `INSERT INTO gymflow_state (id,data,updated_at) VALUES (1,$1::jsonb,now())
       ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()`,
      [JSON.stringify(state)]
    ));
    await writeQueue;
    return;
  }
  await fs.writeFile(DB_FILE,JSON.stringify(state,null,2));
}

function b64url(input){ return Buffer.from(input).toString('base64url'); }
function sign(payload){ return crypto.createHmac('sha256',SESSION_SECRET).update(payload).digest('base64url'); }
function makeToken(){
  const payload=b64url(JSON.stringify({email:APP_EMAIL,exp:Date.now()+30*86400000}));
  return `${payload}.${sign(payload)}`;
}
function verifyToken(token){
  if(!token||!token.includes('.'))return false;
  const [payload,sig]=token.split('.');
  const expected=sign(payload);
  if(sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return false;
  try{
    const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    return data.email===APP_EMAIL&&Number(data.exp)>Date.now();
  }catch{return false;}
}
function parseCookies(req){
  const out={};
  for(const part of String(req.headers.cookie||'').split(';')){
    const i=part.indexOf('=');
    if(i>0)out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}
function isAuth(req){return verifyToken(parseCookies(req)[COOKIE_NAME]);}
function cookie(req,token,maxAge){
  const secure=String(req.headers['x-forwarded-proto']||'').toLowerCase().includes('https');
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure?'; Secure':''}`;
}
function json(res,status,data,headers={}){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});
  res.end(JSON.stringify(data));
}
async function bodyJson(req){
  let raw='';
  for await(const chunk of req){
    raw+=chunk;
    if(raw.length>15_000_000)throw new Error('File troppo grande: massimo circa 10 MB');
  }
  if(!raw)return {};
  return JSON.parse(raw);
}

function cleanText(v){
  return String(v??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
}
function norm(v){
  return cleanText(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
function safeNumber(v, fallback=0){
  if(typeof v==='number'&&Number.isFinite(v))return v;
  const m=cleanText(v).replace(',','.').match(/-?\d+(?:\.\d+)?/);
  return m?Number(m[0]):fallback;
}
function sessionCodeFromText(v){
  const n=norm(v);
  if(!n)return null;
  if(/^(a|seduta a|sessione a|allenamento a|workout a)$/.test(n)||/\b(full ?body|giorno|day|workout|seduta|allenamento)\s*1\b/.test(n))return 'A';
  if(/^(b|seduta b|sessione b|allenamento b|workout b)$/.test(n)||/\b(full ?body|giorno|day|workout|seduta|allenamento)\s*2\b/.test(n))return 'B';
  if(/^(c|seduta c|sessione c|allenamento c|workout c)$/.test(n)||/\b(full ?body|giorno|day|workout|seduta|allenamento)\s*3\b/.test(n))return 'C';
  if(/\bseduta\s*a\b|\ballenamento\s*a\b|\bworkout\s*a\b/.test(n))return 'A';
  if(/\bseduta\s*b\b|\ballenamento\s*b\b|\bworkout\s*b\b/.test(n))return 'B';
  if(/\bseduta\s*c\b|\ballenamento\s*c\b|\bworkout\s*c\b/.test(n))return 'C';
  return null;
}
function parseRest(v){
  const raw=cleanText(v).toLowerCase().replace(',','.').replace(/[–—]/g,'-');
  if(!raw)return 90;

  const parseOne=(part)=>{
    part=cleanText(part);
    let m=part.match(/(\d+)\s*[:]\s*(\d+)/);
    if(m)return Number(m[1])*60+Number(m[2]);
    m=part.match(/(\d+)\s*(?:m|min|minuti?)\s*(?:(\d+)\s*(?:s|sec|secondi?))?/);
    if(m)return Number(m[1])*60+Number(m[2]||0);
    m=part.match(/(\d+)\s*['′]\s*(?:(\d+)\s*["″]?)?/);
    if(m)return Number(m[1])*60+Number(m[2]||0);
    const n=safeNumber(part,90);
    if(/\bmin\b|minuti?/.test(part))return Math.round(n*60);
    return Math.max(0,Math.round(n));
  };

  // Se il PT indica un intervallo (es. 2'-3' oppure 1'30"-2'),
  // usiamo il valore medio: 150s e 105s rispettivamente.
  const parts=raw.split(/\s*-\s*/).filter(Boolean);
  if(parts.length>=2){
    const a=parseOne(parts[0]);
    const b=parseOne(parts[1]);
    return Math.round((a+b)/2);
  }
  return parseOne(raw);
}
function parseReps(v){
  const raw=cleanText(v).replace(/[–—]/g,'-');
  const nums=(raw.match(/\d+/g)||[]).map(Number);
  if(nums.length>=2)return [nums[0],nums[1]];
  if(nums.length===1)return [nums[0],nums[0]];
  return [8,10];
}
function parseScheme(v){
  const raw=cleanText(v).replace(/[×X]/g,'x').replace(/[–—]/g,'-');
  // Supporta sia 4x6-8 sia il formato del tuo file 4x6/8.
  const m=raw.match(/(\d+)\s*x\s*(\d+)(?:\s*(?:-|\/)\s*(\d+))?/i);
  if(m)return {sets:Number(m[1]),repsMin:Number(m[2]),repsMax:Number(m[3]||m[2])};
  return null;
}
function headerKind(v){
  const n=norm(v);
  if(!n)return null;
  const hasSerie=/\bserie\b|\bsets?\b/.test(n);
  const hasRep=/\breps?\b|\brip\b|ripetizion/.test(n);
  if((hasSerie&&hasRep)||/serie.*ripetizion/.test(n))return 'scheme';
  if(/eserciz|exercise|movimento/.test(n))return 'exercise';
  if(/\bseduta\b|\bsessione\b|\ballenamento\b|\bworkout\b|\bgiorno\b/.test(n))return 'session';
  if(hasSerie)return 'sets';
  if(hasRep)return 'reps';
  if(/recuper|rest|pausa/.test(n))return 'rest';
  if(/\bcarico\b|\bpeso\b|\bweight\b|kg/.test(n))return 'weight';
  if(/cadenza|\btempo\b|\btut\b/.test(n))return 'tempo';
  if(/note|indicaz|tecnica|comment/.test(n))return 'note';
  if(/^(week|settimana)\s*1$/.test(n))return 'performance';
  return null;
}
function rowTexts(ws,rowNo){
  const row=ws.getRow(rowNo);
  const max=Math.max(ws.columnCount,12);
  const out=[];
  for(let c=1;c<=Math.min(max,30);c++)out.push(cleanText(row.getCell(c).text||row.getCell(c).value));
  return out;
}
function headerMap(cells){
  const map={};
  cells.forEach((v,i)=>{
    const k=headerKind(v);
    if(k&&map[k]===undefined)map[k]=i;
  });
  return map;
}
function headerScore(map){
  return (map.exercise!==undefined?4:0)+(map.scheme!==undefined?2:0)+(map.sets!==undefined?1:0)+(map.reps!==undefined?1:0)+(map.rest!==undefined?1:0)+(map.weight!==undefined?1:0);
}
function parsePerformance(v){
  const raw=cleanText(v).replace(',','.');
  if(!raw)return {weight:null,reps:null};

  const weightMatch=raw.match(/(\d+(?:\.\d+)?)\s*kg\b/i);
  const weight=weightMatch?Number(weightMatch[1]):null;

  // Rimuoviamo il peso prima di leggere le ripetizioni:
  // "8-8-7 116kg" -> [8,8,7]
  // "40kg 6-6-6" -> [6,6,6]
  const withoutWeight=raw.replace(/(\d+(?:\.\d+)?)\s*kg\b/ig,' ');
  const reps=(withoutWeight.match(/\d+/g)||[]).map(Number).filter(n=>n>0&&n<100);
  return {weight,reps:reps.length?reps:null};
}

function parseExerciseFromRow(cells,map,code,index){
  const name=cleanText(cells[map.exercise]);
  if(!name||headerKind(name)==='exercise')return null;
  const n=norm(name);
  if(/^(totale|total|note|notes|riscaldamento|warm up)$/.test(n))return null;

  let sets=3,repsMin=8,repsMax=10;
  if(map.scheme!==undefined){
    const s=parseScheme(cells[map.scheme]);
    if(s){sets=s.sets;repsMin=s.repsMin;repsMax=s.repsMax;}
  }
  if(map.sets!==undefined)sets=Math.max(1,Math.round(safeNumber(cells[map.sets],sets)));
  if(map.reps!==undefined)[repsMin,repsMax]=parseReps(cells[map.reps]);

  const restSec=map.rest!==undefined?parseRest(cells[map.rest]):90;
  const perf=map.performance!==undefined?parsePerformance(cells[map.performance]):{weight:null,reps:null};
  const suggestedWeight=map.weight!==undefined?safeNumber(cells[map.weight],perf.weight??0):(perf.weight??0);
  const suggestedReps=perf.reps?.length?perf.reps[0]:repsMax;
  const tempo=map.tempo!==undefined?cleanText(cells[map.tempo])||'—':'—';
  const note=map.note!==undefined?cleanText(cells[map.note]):'';

  return {
    id:`${code.toLowerCase()}_${crypto.randomUUID().replaceAll('-','').slice(0,12)}`,
    name,
    sets,
    repsMin,
    repsMax,
    restSec,
    tempo,
    note,
    suggestedWeight,
    suggestedReps
  };
}

async function parseWorkbook(filename,dataBase64,currentProgram){
  const ext=path.extname(filename||'').toLowerCase();
  if(!['.xlsx','.xlsm','.csv'].includes(ext)){
    throw new Error('Formato non supportato. Usa .xlsx, .xlsm oppure .csv. Se hai un vecchio .xls, salvalo come .xlsx.');
  }
  const buffer=Buffer.from(String(dataBase64||''),'base64');
  if(!buffer.length)throw new Error('File vuoto');

  const sessionsMap=new Map([['A',[]],['B',[]],['C',[]]]);
  const warnings=[];

  if(ext==='.csv'){
    const txt=buffer.toString('utf8').replace(/^\uFEFF/,'');
    const lines=txt.split(/\r?\n/).filter(x=>x.trim());
    if(lines.length<2)throw new Error('CSV vuoto o non riconosciuto');
    const sep=(lines[0].match(/;/g)||[]).length>=(lines[0].match(/,/g)||[]).length?';':',';
    const rows=lines.map(line=>line.split(sep).map(x=>cleanText(x.replace(/^"|"$/g,''))));
    const map=headerMap(rows[0]);
    if(map.exercise===undefined)throw new Error('Non trovo la colonna Esercizio nel CSV');
    let currentCode='A';
    rows.slice(1).forEach((cells,i)=>{
      const fromCol=map.session!==undefined?sessionCodeFromText(cells[map.session]):null;
      if(fromCol)currentCode=fromCol;
      const ex=parseExerciseFromRow(cells,map,currentCode,i);
      if(ex)sessionsMap.get(currentCode).push(ex);
    });
  }else{
    const wb=new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    if(!wb.worksheets.length)throw new Error('Il file Excel non contiene fogli');

    wb.worksheets.forEach((ws,wsIndex)=>{
      let currentCode=sessionCodeFromText(ws.name)||['A','B','C'][wsIndex]||'A';
      let map=null;
      let foundHeader=false;

      for(let r=1;r<=ws.rowCount;r++){
        const cells=rowTexts(ws,r);
        const combined=cells.filter(Boolean).join(' ');
        const labelCode=sessionCodeFromText(combined);
        const firstCellCode=sessionCodeFromText(cells[0]);
        const nonEmpty=cells.filter(Boolean).length;

        const candidate=headerMap(cells);
        if(candidate.exercise!==undefined && headerScore(candidate)>=4){
          map=candidate;
          foundHeader=true;
          continue;
        }

        // FIX IMPORTANTE PER IL FILE DI ELIA:
        // "Fullbody 1/2/3" è nella colonna A della STESSA RIGA
        // del primo esercizio. Non dobbiamo saltare quella riga:
        // cambiamo seduta e poi continuiamo a leggerla come esercizio.
        if(firstCellCode)currentCode=firstCellCode;
        else if(labelCode && nonEmpty<=4){
          currentCode=labelCode;
          continue;
        }

        if(!map)continue;
        const fromCol=map.session!==undefined?sessionCodeFromText(cells[map.session]):null;
        const code=fromCol||currentCode;
        if(!sessionsMap.has(code))continue;
        const ex=parseExerciseFromRow(cells,map,code,r);
        if(ex)sessionsMap.get(code).push(ex);
      }

      if(!foundHeader)warnings.push(`Nel foglio "${ws.name}" non ho trovato una riga intestazioni riconoscibile.`);
    });
  }

  const sessions=['A','B','C'].map(code=>({
    code,
    title:`Seduta ${code}`,
    exercises:sessionsMap.get(code)
  }));

  const total=sessions.reduce((a,s)=>a+s.exercises.length,0);
  if(!total){
    throw new Error('Non sono riuscito a riconoscere esercizi. Servono intestazioni tipo Esercizio, Serie, Reps, Recupero.');
  }
  for(const s of sessions){
    if(!s.exercises.length)warnings.push(`Seduta ${s.code}: nessun esercizio riconosciuto.`);
  }

  return {
    id:uid('program'),
    version:Number(currentProgram?.version||0)+1,
    title:currentProgram?.title||'Scheda allenamento',
    updatedAt:nowIso(),
    sourceType:'excel',
    sourceFileName:filename,
    sessions
  };
}

function normalizeProgramInput(input,current,incrementVersion=false){
  const src=input&&typeof input==='object'?input:{};
  const sessions=['A','B','C'].map(code=>{
    const found=(src.sessions||[]).find(s=>String(s.code||'').toUpperCase()===code)||{code,exercises:[]};
    return {
      code,
      title:cleanText(found.title)||`Seduta ${code}`,
      exercises:(found.exercises||[]).map((e,i)=>({
        id:cleanText(e.id)||`${code.toLowerCase()}_${crypto.randomUUID().replaceAll('-','').slice(0,12)}`,
        name:cleanText(e.name)||`Esercizio ${i+1}`,
        sets:Math.max(1,Math.round(Number(e.sets)||3)),
        repsMin:Math.max(1,Math.round(Number(e.repsMin)||8)),
        repsMax:Math.max(1,Math.round(Number(e.repsMax)||Number(e.repsMin)||10)),
        restSec:Math.max(0,Math.round(Number(e.restSec)||90)),
        tempo:cleanText(e.tempo)||'—',
        note:cleanText(e.note),
        suggestedWeight:Number(e.suggestedWeight)||0,
        suggestedReps:Math.max(1,Math.round(Number(e.suggestedReps)||Number(e.repsMax)||10))
      }))
    };
  });
  return {
    id:incrementVersion?uid('program'):(cleanText(src.id)||current?.id||uid('program')),
    version:incrementVersion?Number(current?.version||0)+1:Number(src.version||current?.version||1),
    title:cleanText(src.title)||current?.title||'Scheda allenamento',
    updatedAt:nowIso(),
    sourceType:cleanText(src.sourceType)||'manual',
    sourceFileName:src.sourceFileName||null,
    sessions
  };
}

function lastPerformance(state,exerciseId){
  const sessions=[...state.workouts].filter(w=>w.status==='completed').sort((a,b)=>new Date(b.finishedAt)-new Date(a.finishedAt));
  for(const ws of sessions){
    const sets=(ws.sets||[]).filter(s=>s.exerciseId===exerciseId).sort((a,b)=>a.setNo-b.setNo);
    if(sets.length)return sets;
  }
  return [];
}
function bootstrap(state){
  const p=structuredClone(state.program);
  for(const s of p.sessions||[]){
    for(const e of s.exercises||[]){
      e.lastPerformance=lastPerformance(state,e.id).map(x=>({weight:x.weight,reps:x.reps}));
    }
  }
  return {profile:state.profile,program:p,checkins:state.checkins,workouts:state.workouts};
}

function applyMutation(state,m){
  if(state.appliedMutations.includes(m.id))return;
  const p=m.payload||{};
  if(m.type==='upsert_checkin'){
    let row=state.checkins.find(x=>x.date===p.date);
    if(row)Object.assign(row,p,{updatedAt:m.createdAt||nowIso()});
    else state.checkins.push({id:uid('check'),...p,updatedAt:m.createdAt||nowIso()});
  }else if(m.type==='start_workout'){
    if(!state.workouts.find(x=>x.id===p.workout?.id)&&p.workout)state.workouts.push(p.workout);
  }else if(m.type==='upsert_set'){
    let w=state.workouts.find(x=>x.id===p.workoutId);
    if(!w&&p.workout){w=structuredClone(p.workout);state.workouts.push(w);}
    if(w&&p.set){
      w.sets=w.sets||[];
      let s=w.sets.find(x=>x.exerciseId===p.set.exerciseId&&x.setNo===p.set.setNo);
      if(s)Object.assign(s,p.set);else w.sets.push(p.set);
      w.updatedAt=m.createdAt||nowIso();
    }
  }else if(m.type==='finish_workout'){
    let w=state.workouts.find(x=>x.id===p.workoutId);
    if(!w&&p.workout){w=structuredClone(p.workout);state.workouts.push(w);}
    if(w){w.status='completed';w.finishedAt=p.finishedAt||nowIso();w.updatedAt=m.createdAt||nowIso();}
  }else if(m.type==='save_program'){
    state.program=normalizeProgramInput(p.program,state.program,false);
  }
  state.appliedMutations.push(m.id);
  if(state.appliedMutations.length>5000)state.appliedMutations=state.appliedMutations.slice(-3000);
}

async function exportWorkbook(state){
  const wb=new ExcelJS.Workbook();
  wb.creator='GymFlow';
  wb.created=new Date();

  const diario=wb.addWorksheet('DIARIO');
  diario.columns=[
    {header:'Data',key:'date',width:14},{header:'Peso (kg)',key:'weight',width:14},
    {header:'Vita (cm)',key:'waist',width:14},{header:'Dieta',key:'diet',width:20},
    {header:'Allenamento',key:'workout',width:18},{header:'Note',key:'notes',width:28}
  ];
  const allDates=new Set(state.checkins.map(c=>c.date));
  state.workouts.filter(w=>w.status==='completed').forEach(w=>allDates.add(String(w.finishedAt||w.startedAt).slice(0,10)));
  [...allDates].sort().forEach(date=>{
    const c=state.checkins.find(x=>x.date===date)||{};
    const ws=state.workouts.filter(w=>w.status==='completed'&&String(w.finishedAt||w.startedAt).slice(0,10)===date);
    diario.addRow({
      date,weight:c.weight??'',waist:c.waist??'',
      diet:c.diet==='rispettata'?'Rispettata':c.diet==='non_rispettata'?'Non rispettata':'',
      workout:ws.map(w=>`Seduta ${w.sessionCode}`).join(', '),notes:c.notes||''
    });
  });

  const allenamenti=wb.addWorksheet('ALLENAMENTI');
  allenamenti.columns=[
    {header:'Data',key:'date',width:14},{header:'Seduta',key:'session',width:12},
    {header:'Esercizio',key:'exercise',width:34},{header:'Serie',key:'sets',width:52}
  ];
  for(const w of [...state.workouts].filter(x=>x.status==='completed').sort((a,b)=>new Date(a.finishedAt)-new Date(b.finishedAt))){
    for(const ex of w.exerciseSnapshot||[]){
      const sets=(w.sets||[]).filter(s=>s.exerciseId===ex.id).sort((a,b)=>a.setNo-b.setNo);
      allenamenti.addRow({
        date:String(w.finishedAt||w.startedAt).slice(0,10),session:w.sessionCode,exercise:ex.name,
        sets:sets.map(s=>`${s.weight} kg × ${s.reps}`).join(' | ')
      });
    }
  }

  const dettaglio=wb.addWorksheet('DETTAGLIO_SERIE');
  dettaglio.columns=[
    {header:'Data',key:'date',width:14},{header:'Seduta',key:'session',width:12},
    {header:'Esercizio',key:'exercise',width:34},{header:'N° serie',key:'setNo',width:12},
    {header:'Kg',key:'weight',width:12},{header:'Ripetizioni',key:'reps',width:14}
  ];
  for(const w of [...state.workouts].filter(x=>x.status==='completed').sort((a,b)=>new Date(a.finishedAt)-new Date(b.finishedAt))){
    for(const ex of w.exerciseSnapshot||[]){
      const sets=(w.sets||[]).filter(s=>s.exerciseId===ex.id).sort((a,b)=>a.setNo-b.setNo);
      for(const s of sets)dettaglio.addRow({
        date:String(w.finishedAt||w.startedAt).slice(0,10),session:w.sessionCode,exercise:ex.name,
        setNo:s.setNo,weight:s.weight,reps:s.reps
      });
    }
  }

  for(const ws of [diario,allenamenti,dettaglio]){
    ws.views=[{state:'frozen',ySplit:1}];
    ws.getRow(1).font={bold:true};
    ws.autoFilter={from:{row:1,column:1},to:{row:1,column:ws.columnCount}};
  }
  return wb.xlsx.writeBuffer();
}

async function handleApi(req,res,url){
  const p=url.pathname;
  const method=req.method||'GET';

  if(p==='/api/health')return json(res,200,{ok:true,storage:USE_POSTGRES?'postgres':'json',build:BUILD_ID,time:nowIso()});

  if(p==='/api/login'&&method==='POST'){
    const {email,password}=await bodyJson(req);
    if(String(email||'').trim().toLowerCase()!==APP_EMAIL||String(password||'')!==APP_PASSWORD){
      return json(res,401,{error:'Credenziali non valide'});
    }
    return json(res,200,{user:{email:APP_EMAIL,role:'client'}},{'Set-Cookie':cookie(req,makeToken(),30*86400)});
  }
  if(p==='/api/logout'&&method==='POST'){
    return json(res,200,{ok:true},{'Set-Cookie':cookie(req,'',0)});
  }
  if(p==='/api/me'&&method==='GET'){
    if(!isAuth(req))return json(res,401,{error:'Non autenticato'});
    return json(res,200,{user:{email:APP_EMAIL,role:'client'}});
  }
  if(!isAuth(req))return json(res,401,{error:'Non autenticato'});

  if(p==='/api/bootstrap'&&method==='GET'){
    const state=await readState();
    return json(res,200,bootstrap(state));
  }

  if(p==='/api/sync'&&method==='POST'){
    const {mutations=[]}=await bodyJson(req);
    if(!Array.isArray(mutations))return json(res,400,{error:'mutations non valido'});
    const state=await readState();
    for(const m of mutations){if(m?.id&&m?.type)applyMutation(state,m);}
    await writeState(state);
    return json(res,200,{ok:true,applied:mutations.map(m=>m.id)});
  }

  if(p==='/api/program/import'&&method==='POST'){
    const {filename,dataBase64}=await bodyJson(req);
    try{
      const state=await readState();
      const program=await parseWorkbook(filename,dataBase64,state.program);
      const summary=program.sessions.map(s=>({code:s.code,count:s.exercises.length,names:s.exercises.slice(0,4).map(e=>e.name)}));
      const warnings=[];
      for(const s of program.sessions)if(!s.exercises.length)warnings.push(`Seduta ${s.code}: nessun esercizio riconosciuto`);
      return json(res,200,{program,summary,warnings});
    }catch(err){
      return json(res,400,{error:err.message||'Impossibile leggere il file Excel'});
    }
  }

  if(p==='/api/program/replace'&&method==='POST'){
    const {program}=await bodyJson(req);
    const state=await readState();
    if(!program?.sessions)return json(res,400,{error:'Scheda non valida'});
    state.programHistory.push(structuredClone(state.program));
    if(state.programHistory.length>30)state.programHistory=state.programHistory.slice(-30);
    const next=normalizeProgramInput(program,state.program,true);
    next.sourceType=program.sourceType||'excel';
    next.sourceFileName=program.sourceFileName||null;
    state.program=next;
    await writeState(state);
    return json(res,200,{program:bootstrap(state).program});
  }

  if(p==='/api/export.xlsx'&&method==='GET'){
    const state=await readState();
    const buffer=await exportWorkbook(state);
    res.writeHead(200,{
      'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':`attachment; filename="GymFlow_${state.profile.firstName}_${dateKey()}.xlsx"`,
      'Cache-Control':'no-store','Content-Length':buffer.length
    });
    return res.end(buffer);
  }

  return json(res,404,{error:'Endpoint non trovato'});
}

const MIME={
  '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8',
  '.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml',
  '.png':'image/png','.ico':'image/x-icon'
};

async function serveStatic(req,res,url){
  let reqPath=decodeURIComponent(url.pathname);
  if(reqPath==='/'||reqPath==='')reqPath='/index.html';
  const full=path.resolve(PUBLIC_DIR,'.'+reqPath);
  if(!full.startsWith(path.resolve(PUBLIC_DIR))){res.writeHead(403);return res.end('Forbidden');}
  try{
    const stat=await fs.stat(full);
    if(stat.isDirectory())throw new Error('dir');
    let data=await fs.readFile(full);
    const ext=path.extname(full);

    // L'HTML riceve automaticamente una versione nuova ad ogni deploy.
    // Così app.js/styles.css cambiano URL e non possono restare bloccati
    // nella vecchia cache del browser o del Service Worker.
    if(ext==='.html'){
      data=Buffer.from(data.toString('utf8').replaceAll('__BUILD_VERSION__',BUILD_ID),'utf8');
    }

    const noCache=new Set(['.html','.js','.css','.webmanifest']);
    res.writeHead(200,{
      'Content-Type':MIME[ext]||'application/octet-stream',
      'Cache-Control':noCache.has(ext)?'no-store, no-cache, must-revalidate, max-age=0':'public, max-age=86400',
      'Pragma':noCache.has(ext)?'no-cache':undefined,
      'Expires':noCache.has(ext)?'0':undefined
    });
    res.end(data);
  }catch{
    let index=await fs.readFile(path.join(PUBLIC_DIR,'index.html'),'utf8');
    index=index.replaceAll('__BUILD_VERSION__',BUILD_ID);
    res.writeHead(200,{
      'Content-Type':'text/html; charset=utf-8',
      'Cache-Control':'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma':'no-cache',
      'Expires':'0'
    });
    res.end(index);
  }
}

await ensureState();
const server=http.createServer(async(req,res)=>{
  try{
    const proto=req.headers['x-forwarded-proto']||'http';
    const host=req.headers.host||`localhost:${PORT}`;
    const url=new URL(req.url||'/',`${proto}://${host}`);
    if(url.pathname.startsWith('/api/'))await handleApi(req,res,url);else await serveStatic(req,res,url);
  }catch(err){
    console.error(err);
    json(res,500,{error:err.message||'Errore server'});
  }
});
server.listen(PORT,()=>{
  console.log(`GymFlow in esecuzione sulla porta ${PORT}`);
  console.log(`Storage: ${USE_POSTGRES?'PostgreSQL cloud':'JSON locale'}`);
  console.log(`Login: ${APP_EMAIL}`);
});
