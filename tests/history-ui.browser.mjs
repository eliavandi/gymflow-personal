// Run against a local server with GYMFLOW_PLAYWRIGHT_MODULE pointing to Playwright's index.mjs.
// All API writes are intercepted: this check never edits the user's diary.
import assert from 'node:assert/strict';
import {seedState,applyMutation} from '../server.mjs';
const {chromium}=await import(process.env.GYMFLOW_PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Europe/Rome'});
const page=await context.newPage();
const errors=[];
let authenticated=false;
page.on('pageerror',e=>errors.push(e.message));
const state=seedState();
state.checkins=[
  {id:'july',date:'2026-07-01',weight:86,waist:91,diet:'non_rispettata',notes:'Inizio percorso'},
  {id:'sept',date:'2026-09-20',weight:83,waist:88,diet:'rispettata',notes:'Buona energia'},
  {id:'today',date:'2026-10-13',weight:80,waist:84,diet:'rispettata',notes:'Oggi'}
];
state.workouts=[['2026-07-02',60],['2026-09-21',65],['2026-10-12',70]].map(([date,weight],i)=>({
  id:'w'+i,sessionCode:'A',status:'completed',startedAt:date+'T18:00:00+02:00',finishedAt:date+'T19:00:00+02:00',
  exerciseSnapshot:[{id:'press'+i,name:'Chest press'}],
  sets:[{exerciseId:'press'+i,setNo:1,weight,reps:10,completedAt:date+'T18:05:00+02:00'},
    {exerciseId:'press'+i,setNo:2,weight,reps:8,completedAt:date+'T18:10:00+02:00'},
    {exerciseId:'press'+i,setNo:3,weight:100,reps:10,completedAt:null}]
}));
await context.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let body;
  if(path==='/api/me'&&!authenticated){await route.fulfill({status:401,contentType:'application/json',body:'{"error":"Non autenticato"}'});return;}
  if(path==='/api/me'||path==='/api/login'){authenticated=true;body={user:{email:'elia@gymflow.local',role:'client'}};}
  else if(path==='/api/bootstrap')body={profile:state.profile,program:state.program,checkins:state.checkins,workouts:state.workouts};
  else if(path==='/api/sync'){
    const {mutations}=route.request().postDataJSON();
    for(const m of mutations)applyMutation(state,m);
    body={ok:true,applied:mutations.map(m=>m.id),rejected:[]};
  }else if(path==='/api/logout')body={ok:true};
  else throw new Error('Unexpected API request: '+path);
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
});
async function history(){await page.locator('[data-nav="history"]').click();await page.locator('#addPastCheckin').waitFor();}
async function noOverflow(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
try{
  await page.clock.setFixedTime(new Date('2026-10-13T12:00:00+02:00'));
  await page.goto(process.env.GYMFLOW_TEST_URL||'http://127.0.0.1:4188');
  await page.waitForFunction(()=>sessionStorage.getItem('gymflow-sw-reloaded')==='1');
  await page.locator('#password').fill('demo1234');await page.locator('#loginBtn').click();
  await page.locator('#editWeight').waitFor();
  await page.locator('#pastCheckin').click();
  const dialog=page.locator('#dailyCheckinDialog');
  await dialog.locator('#date').fill('2025-04-01');await dialog.locator('#date').dispatchEvent('change');
  assert.equal(await dialog.locator('#weight').inputValue(),'');
  await dialog.locator('#weight').fill('90');await dialog.locator('#waist').fill('95');
  await dialog.locator('#checkinDiet').selectOption('non_rispettata');
  await dialog.locator('#notes').fill('Misure di un anno fa');
  await dialog.locator('#date').fill('2025-04-02');await dialog.locator('#date').dispatchEvent('change');
  assert.equal(await dialog.locator('#weight').inputValue(),'');
  assert.equal(await dialog.locator('#notes').inputValue(),'');
  await dialog.locator('#weight').fill('89');await dialog.locator('#checkinDiet').selectOption('rispettata');
  await dialog.locator('button[type="submit"]').click();
  await dialog.waitFor({state:'detached'});
  assert.match(await page.locator('#editWeight').innerText(),/80/);
  await history();
  assert.equal(await page.locator('.diaryentry').count(),5);
  assert.match(await page.locator('.statdelta').first().innerText(),/-10/);
  await page.locator('[data-edit-checkin="2025-04-01"]').click();
  assert.equal(await dialog.locator('#weight').inputValue(),'90');
  assert.equal(await dialog.locator('#notes').inputValue(),'Misure di un anno fa');
  await dialog.locator('#weight').fill('91');await dialog.locator('button[type="submit"]').click();
  await dialog.waitFor({state:'detached'});
  assert.equal(await page.locator('.diaryentry').count(),5);
  await page.locator('[data-stats-period="30"]').click();
  assert.equal(await page.locator('.diaryentry').count(),2);
  assert.match(await page.locator('.statsoverview').innerText(),/2\s+Allenamenti/);
  await page.locator('[data-stats-period="custom"]').click();
  await page.locator('#statsFrom').fill('2025-04-01');await page.locator('#statsTo').fill('2025-04-02');
  await page.locator('#statsDateForm button').click();
  assert.equal(await page.locator('.diaryentry').count(),2);
  assert.equal(await page.locator('#statsExercise').isDisabled(),true);
  await page.locator('[data-stats-period="all"]').click();
  await page.locator('.chartpoint').first().click();
  assert.match(await page.locator('.chartreading').first().innerText(),/01\/04\/2025: 91 kg/);
  await noOverflow();
  await page.screenshot({path:'test-results/history-mobile.png',fullPage:true});
  await page.setViewportSize({width:320,height:640});await noOverflow();
  await page.locator('#addPastCheckin').click();await noOverflow();
  assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await dialog.locator('#closeCheckin').click();await dialog.waitFor({state:'detached'});
  await page.setViewportSize({width:1280,height:900});await noOverflow();
  await page.screenshot({path:'test-results/history-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await context.setOffline(true);
  await page.locator('#addPastCheckin').click();
  await dialog.locator('#date').fill('2024-01-15');await dialog.locator('#date').dispatchEvent('change');
  await dialog.locator('#weight').fill('95');await dialog.locator('#notes').fill('Registrato offline');
  await dialog.locator('button[type="submit"]').click();await dialog.waitFor({state:'detached'});
  await page.reload();await page.locator('[data-nav="history"]').waitFor();await history();
  assert.equal(await page.locator('[data-edit-checkin="2024-01-15"]').count(),1);
  await context.setOffline(false);
  await page.waitForFunction(()=>document.getElementById('syncBadge')?.textContent==='Sincronizzato');
  await page.reload();await page.locator('[data-nav="history"]').waitFor();await history();
  assert.equal(await page.locator('[data-edit-checkin="2024-01-15"]').count(),1);
  assert.equal(state.checkins.find(c=>c.date==='2024-01-15').weight,95);
  assert.equal(state.checkins.find(c=>c.date==='2026-10-13').weight,80);
  assert.deepEqual(errors,[]);
  console.log('PASS: historical inserts/edits, date switching, filters, chart reading, responsive layout, offline reload and sync.');
}finally{await browser.close();}
