import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'gymflow.json');
const PORT = Number(process.env.PORT || 4173);
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const USE_POSTGRES = Boolean(DATABASE_URL);

const APP_EMAIL = String(process.env.APP_EMAIL || 'elia@gymflow.local').trim().toLowerCase();
const APP_PASSWORD = String(process.env.APP_PASSWORD || 'demo1234');
const SESSION_SECRET = String(process.env.SESSION_SECRET || 'gymflow-dev-change-this-secret');
const COOKIE_NAME = 'gymflow_session';

let pgPool = null;
let writeQueue = Promise.resolve();

const nowIso = () => new Date().toISOString();
const uid = (prefix='id') => `${prefix}_${crypto.randomUUID().replaceAll('-','')}`;

function dateKey(d = new Date()){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function seedState(){
  return {
    schemaVersion: 1,
    profile: {
      firstName: 'Elia',
      lastName: 'Vandi',
      heightCm: 193,
      targetWeightKg: 80
    },
    program: {
      id: 'program_v1',
      version: 1,
      title: 'Fullbody 3 sedute',
      updatedAt: nowIso(),
      sessions: [
        {code:'A', title:'Seduta A', exercises:[
          {id:'a1',name:'Leg press 45°',sets:4,repsMin:6,repsMax:8,restSec:150,tempo:'—',note:'',suggestedWeight:180,suggestedReps:8},
          {id:'a2',name:'Leg extension',sets:3,repsMin:8,repsMax:10,restSec:90,tempo:'1s picco',note:'',suggestedWeight:65,suggestedReps:10},
          {id:'a3',name:'Chest press',sets:3,repsMin:8,repsMax:10,restSec:90,tempo:'—',note:'',suggestedWeight:80,suggestedReps:10},
          {id:'a4',name:'Curl manubri presa supina',sets:3,repsMin:7,repsMax:9,restSec:105,tempo:'—',note:'',suggestedWeight:18,suggestedReps:9}
        ]},
        {code:'B', title:'Seduta B', exercises:[
          {id:'b1',name:'Lat machine triangolo',sets:4,repsMin:6,repsMax:8,restSec:150,tempo:'—',note:'',suggestedWeight:70,suggestedReps:8},
          {id:'b2',name:'Low Row',sets:3,repsMin:8,repsMax:10,restSec:90,tempo:'1s picco',note:'',suggestedWeight:60,suggestedReps:10},
          {id:'b3',name:'Leg curl seduto',sets:4,repsMin:8,repsMax:10,restSec:105,tempo:'3s eccentrica',note:'',suggestedWeight:45,suggestedReps:10},
          {id:'b4',name:'French press manubri',sets:3,repsMin:7,repsMax:9,restSec:105,tempo:'—',note:'',suggestedWeight:18,suggestedReps:9}
        ]},
        {code:'C', title:'Seduta C', exercises:[
          {id:'c1',name:'Rematore manubrio singolo',sets:3,repsMin:6,repsMax:8,restSec:105,tempo:'—',note:'',suggestedWeight:34,suggestedReps:8},
          {id:'c2',name:'Pulley triangolo',sets:3,repsMin:8,repsMax:10,restSec:90,tempo:'1s picco',note:'',suggestedWeight:65,suggestedReps:10},
          {id:'c3',name:'Spinte manubri panca piana',sets:3,repsMin:6,repsMax:8,restSec:120,tempo:'1s fermo',note:'',suggestedWeight:32,suggestedReps:8},
          {id:'c4',name:'OHP multipower panca 60°',sets:4,repsMin:6,repsMax:8,restSec:150,tempo:'1s fermo',note:'',suggestedWeight:50,suggestedReps:8}
        ]}
      ]
    },
    checkins: [],
    workouts: [],
    appliedMutations: []
  };
}

async function getPool(){
  if(!USE_POSTGRES) return null;
  if(pgPool) return pgPool;
  const { Pool } = await import('pg');
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : {rejectUnauthorized:false},
    max: 5
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
    return r.rows[0].data;
  }
  return JSON.parse(await fs.readFile(DB_FILE,'utf8'));
}

async function writeState(state){
  if(USE_POSTGRES){
    const pool=await getPool();
    writeQueue = writeQueue.then(()=>pool.query(
      `INSERT INTO gymflow_state (id,data,updated_at) VALUES (1,$1::jsonb,now())
       ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`,
      [JSON.stringify(state)]
    ));
    await writeQueue;
    return;
  }
  await fs.writeFile(DB_FILE,JSON.stringify(state,null,2));
}

function b64url(input){
  return Buffer.from(input).toString('base64url');
}
function sign(payload){
  return crypto.createHmac('sha256',SESSION_SECRET).update(payload).digest('base64url');
}
function makeToken(){
  const payload=b64url(JSON.stringify({email:APP_EMAIL,exp:Date.now()+30*86400000}));
  return `${payload}.${sign(payload)}`;
}
function verifyToken(token){
  if(!token || !token.includes('.')) return false;
  const [payload,sig]=token.split('.');
  const expected=sign(payload);
  if(sig.length!==expected.length || !crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) return false;
  try{
    const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    return data.email===APP_EMAIL && Number(data.exp)>Date.now();
  }catch{return false;}
}
function parseCookies(req){
  const out={};
  for(const part of String(req.headers.cookie||'').split(';')){
    const i=part.indexOf('=');
    if(i>0) out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());
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
    if(raw.length>3_000_000) throw new Error('Body troppo grande');
  }
  if(!raw) return {};
  return JSON.parse(raw);
}

function getExercise(program, sessionCode, exerciseId){
  return program.sessions.find(s=>s.code===sessionCode)?.exercises.find(e=>e.id===exerciseId)||null;
}
function lastPerformance(state, exerciseId){
  const sessions=[...state.workouts].filter(w=>w.status==='completed').sort((a,b)=>new Date(b.finishedAt)-new Date(a.finishedAt));
  for(const w of sessions){
    const sets=(w.sets||[]).filter(s=>s.exerciseId===exerciseId).sort((a,b)=>a.setNo-b.setNo);
    if(sets.length) return sets;
  }
  return [];
}
function bootstrap(state){
  const p=structuredClone(state.program);
  for(const s of p.sessions){
    for(const e of s.exercises){
      e.lastPerformance=lastPerformance(state,e.id).map(x=>({weight:x.weight,reps:x.reps}));
    }
  }
  return {
    profile: state.profile,
    program: p,
    checkins: state.checkins,
    workouts: state.workouts
  };
}

function applyMutation(state,m){
  if(state.appliedMutations.includes(m.id)) return;
  const p=m.payload||{};
  if(m.type==='upsert_checkin'){
    let row=state.checkins.find(x=>x.date===p.date);
    if(row) Object.assign(row,p,{updatedAt:m.createdAt||nowIso()});
    else state.checkins.push({id:uid('check'),...p,updatedAt:m.createdAt||nowIso()});
  }else if(m.type==='start_workout'){
    if(!state.workouts.find(x=>x.id===p.workout.id)){
      state.workouts.push(p.workout);
    }
  }else if(m.type==='upsert_set'){
    const w=state.workouts.find(x=>x.id===p.workoutId);
    if(w){
      w.sets=w.sets||[];
      let s=w.sets.find(x=>x.exerciseId===p.set.exerciseId&&x.setNo===p.set.setNo);
      if(s) Object.assign(s,p.set);
      else w.sets.push(p.set);
      w.updatedAt=m.createdAt||nowIso();
    }
  }else if(m.type==='finish_workout'){
    const w=state.workouts.find(x=>x.id===p.workoutId);
    if(w){w.status='completed';w.finishedAt=p.finishedAt||nowIso();w.updatedAt=m.createdAt||nowIso();}
  }
  state.appliedMutations.push(m.id);
  if(state.appliedMutations.length>5000) state.appliedMutations=state.appliedMutations.slice(-3000);
}

async function exportWorkbook(state){
  const wb=new ExcelJS.Workbook();
  wb.creator='GymFlow';
  wb.created=new Date();

  const diario=wb.addWorksheet('DIARIO');
  diario.columns=[
    {header:'Data',key:'date',width:14},
    {header:'Peso (kg)',key:'weight',width:14},
    {header:'Vita (cm)',key:'waist',width:14},
    {header:'Dieta',key:'diet',width:20},
    {header:'Allenamento',key:'workout',width:18},
    {header:'Note',key:'notes',width:28}
  ];
  const allDates=new Set(state.checkins.map(c=>c.date));
  state.workouts.filter(w=>w.status==='completed').forEach(w=>allDates.add(String(w.finishedAt||w.startedAt).slice(0,10)));
  [...allDates].sort().forEach(date=>{
    const c=state.checkins.find(x=>x.date===date)||{};
    const ws=state.workouts.filter(w=>w.status==='completed'&&String(w.finishedAt||w.startedAt).slice(0,10)===date);
    diario.addRow({
      date,
      weight:c.weight??'',
      waist:c.waist??'',
      diet:c.diet==='rispettata'?'Rispettata':c.diet==='non_rispettata'?'Non rispettata':'',
      workout:ws.map(w=>`Seduta ${w.sessionCode}`).join(', '),
      notes:c.notes||''
    });
  });

  const allenamenti=wb.addWorksheet('ALLENAMENTI');
  allenamenti.columns=[
    {header:'Data',key:'date',width:14},
    {header:'Seduta',key:'session',width:12},
    {header:'Esercizio',key:'exercise',width:34},
    {header:'Serie',key:'sets',width:52}
  ];
  for(const w of [...state.workouts].filter(x=>x.status==='completed').sort((a,b)=>new Date(a.finishedAt)-new Date(b.finishedAt))){
    for(const ex of w.exerciseSnapshot||[]){
      const sets=(w.sets||[]).filter(s=>s.exerciseId===ex.id).sort((a,b)=>a.setNo-b.setNo);
      allenamenti.addRow({
        date:String(w.finishedAt||w.startedAt).slice(0,10),
        session:w.sessionCode,
        exercise:ex.name,
        sets:sets.map(s=>`${s.weight} kg × ${s.reps}`).join(' | ')
      });
    }
  }

  const dettaglio=wb.addWorksheet('DETTAGLIO_SERIE');
  dettaglio.columns=[
    {header:'Data',key:'date',width:14},
    {header:'Seduta',key:'session',width:12},
    {header:'Esercizio',key:'exercise',width:34},
    {header:'N° serie',key:'setNo',width:12},
    {header:'Kg',key:'weight',width:12},
    {header:'Ripetizioni',key:'reps',width:14}
  ];
  for(const w of [...state.workouts].filter(x=>x.status==='completed').sort((a,b)=>new Date(a.finishedAt)-new Date(b.finishedAt))){
    for(const ex of w.exerciseSnapshot||[]){
      const sets=(w.sets||[]).filter(s=>s.exerciseId===ex.id).sort((a,b)=>a.setNo-b.setNo);
      for(const s of sets){
        dettaglio.addRow({
          date:String(w.finishedAt||w.startedAt).slice(0,10),
          session:w.sessionCode,
          exercise:ex.name,
          setNo:s.setNo,
          weight:s.weight,
          reps:s.reps
        });
      }
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

  if(p==='/api/health') return json(res,200,{ok:true,storage:USE_POSTGRES?'postgres':'json',time:nowIso()});

  if(p==='/api/login'&&method==='POST'){
    const {email,password}=await bodyJson(req);
    if(String(email||'').trim().toLowerCase()!==APP_EMAIL || String(password||'')!==APP_PASSWORD){
      return json(res,401,{error:'Credenziali non valide'});
    }
    return json(res,200,{user:{email:APP_EMAIL,role:'client'}},{'Set-Cookie':cookie(req,makeToken(),30*86400)});
  }

  if(p==='/api/logout'&&method==='POST'){
    return json(res,200,{ok:true},{'Set-Cookie':cookie(req,'',0)});
  }

  if(p==='/api/me'&&method==='GET'){
    if(!isAuth(req)) return json(res,401,{error:'Non autenticato'});
    return json(res,200,{user:{email:APP_EMAIL,role:'client'}});
  }

  if(!isAuth(req)) return json(res,401,{error:'Non autenticato'});

  if(p==='/api/bootstrap'&&method==='GET'){
    const state=await readState();
    return json(res,200,bootstrap(state));
  }

  if(p==='/api/sync'&&method==='POST'){
    const {mutations=[]}=await bodyJson(req);
    if(!Array.isArray(mutations)) return json(res,400,{error:'mutations non valido'});
    const state=await readState();
    for(const m of mutations){
      if(!m?.id||!m?.type) continue;
      applyMutation(state,m);
    }
    await writeState(state);
    return json(res,200,{ok:true,applied:mutations.map(m=>m.id)});
  }

  if(p==='/api/export.xlsx'&&method==='GET'){
    const state=await readState();
    const buffer=await exportWorkbook(state);
    res.writeHead(200,{
      'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':`attachment; filename="GymFlow_${state.profile.firstName}_${dateKey()}.xlsx"`,
      'Cache-Control':'no-store',
      'Content-Length':buffer.length
    });
    return res.end(buffer);
  }

  return json(res,404,{error:'Endpoint non trovato'});
}

const MIME={
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.webmanifest':'application/manifest+json; charset=utf-8',
  '.svg':'image/svg+xml',
  '.png':'image/png',
  '.ico':'image/x-icon'
};

async function serveStatic(req,res,url){
  let reqPath=decodeURIComponent(url.pathname);
  if(reqPath==='/'||reqPath==='') reqPath='/index.html';
  const full=path.resolve(PUBLIC_DIR,'.'+reqPath);
  if(!full.startsWith(path.resolve(PUBLIC_DIR))){
    res.writeHead(403);return res.end('Forbidden');
  }
  try{
    const stat=await fs.stat(full);
    if(stat.isDirectory()) throw new Error('dir');
    const data=await fs.readFile(full);
    res.writeHead(200,{
      'Content-Type':MIME[path.extname(full)]||'application/octet-stream',
      'Cache-Control':path.extname(full)==='.html'?'no-cache':'public, max-age=3600'
    });
    res.end(data);
  }catch{
    const index=await fs.readFile(path.join(PUBLIC_DIR,'index.html'));
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});
    res.end(index);
  }
}

await ensureState();

const server=http.createServer(async(req,res)=>{
  try{
    const proto=req.headers['x-forwarded-proto']||'http';
    const host=req.headers.host||`localhost:${PORT}`;
    const url=new URL(req.url||'/',`${proto}://${host}`);
    if(url.pathname.startsWith('/api/')) await handleApi(req,res,url);
    else await serveStatic(req,res,url);
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
