import test from 'node:test';
import assert from 'node:assert/strict';
import {validDayKey,historyRange,historyStats,workoutStats} from '../history-model.js';
import {seedState,applyMutation} from '../server.mjs';

const range={from:'2026-09-01',to:'2026-10-13'};
const completed=(id,date,sets,exercises=[{id:'press',name:'Chest press'}])=>({
  id,sessionCode:'A',status:'completed',startedAt:date+'T10:00:00',finishedAt:date+'T11:00:00',sets,exerciseSnapshot:exercises
});
const set=(weight,reps,extra={})=>({exerciseId:'press',weight,reps,completedAt:'2026-10-01T10:05:00',...extra});

test('date ranges use calendar days across month and year boundaries',()=>{
  assert.equal(validDayKey('2026-02-29'),false);
  assert.equal(validDayKey('2024-02-29'),true);
  assert.equal(validDayKey('2026-13-01'),false);
  assert.equal(validDayKey(''),false);
  assert.deepEqual(historyRange('30',new Date(2027,0,5,12)),{from:'2026-12-07',to:'2027-01-05'});
});

test('backdated check-ins can be edited without changing today or creating duplicates',()=>{
  const state=seedState();
  const apply=(id,payload)=>applyMutation(state,{id,type:'upsert_checkin',payload});
  apply('today',{date:'2026-10-13',weight:80});
  apply('past',{date:'2025-06-01',weight:90,waist:95,diet:'non_rispettata',notes:'Vecchia misura'});
  apply('past-edit',{date:'2025-06-01',weight:89,waist:94,diet:'rispettata',notes:'Misura corretta'});
  assert.equal(state.checkins.length,2);
  assert.equal(state.checkins.find(c=>c.date==='2026-10-13').weight,80);
  assert.equal(state.checkins.find(c=>c.date==='2025-06-01').weight,89);
  assert.equal(historyStats(state,{from:'',to:'2026-10-13'}).weight.change,-9);
});

test('measurements are chronological, missing entries stay missing, and diet uses recorded days only',()=>{
  const state={checkins:[
    {date:'2026-10-01',weight:82,waist:null,diet:'rispettata'},
    {date:'2026-09-01',weight:85,waist:90,diet:'non_rispettata'},
    {date:'2026-10-13',weight:null,waist:86,notes:'Solo vita'},
    {date:'2026-08-31',weight:100,waist:110,diet:'rispettata'},
    {date:'2026-10-14',weight:79,diet:'rispettata'},
    {date:'2026-02-30',weight:50}
  ],workouts:[]};
  const stats=historyStats(state,range);
  assert.equal(stats.checks.length,3);
  assert.equal(stats.weight.first.value,85);assert.equal(stats.weight.last.value,82);
  assert.equal(stats.weight.change,-3);assert.equal(stats.weight.average,83.5);
  assert.equal(stats.waist.change,-4);assert.equal(stats.waist.points.length,2);
  assert.deepEqual(stats.diet,{respected:1,missed:1,recorded:2,rate:50});
  assert.equal(historyStats({checkins:[],workouts:[]},range).weight.change,null);
  assert.equal(historyStats({checkins:[],workouts:[]},range).diet.rate,null);
});

test('training totals exclude unfinished, cancelled and malformed sets but count bodyweight reps',()=>{
  const w=completed('one','2026-10-01',[
    set(40,10),set(45,8),set(0,12),set(80,10,{completedAt:null}),set(null,8),set(10,null),set(-1,10)
  ]);
  assert.deepEqual(workoutStats(w),{sets:3,reps:30,volume:760,minutes:60});
  const stats=historyStats({checkins:[],workouts:[w,
    {...w,id:'cancelled',status:'cancelled'}, {...w,id:'active',status:'in_progress'},
    {...w,id:'invalid',finishedAt:'invalid'}, completed('two','2026-10-01',[set(50,6)])
  ]},range);
  assert.equal(stats.training.count,2);assert.equal(stats.training.activeDays,1);
  assert.equal(stats.training.sets,4);assert.equal(stats.training.reps,36);assert.equal(stats.training.volume,1060);
  assert.equal(stats.exercises[0].history.length,2);assert.equal(stats.exercises[0].bestWeight,50);
});

test('exercise history survives changed program IDs and dates are filtered using local time',()=>{
  const workouts=[completed('one','2026-09-01',[set(40,10)]),
    completed('two','2026-10-01',[set(50,8,{exerciseId:'new-id'})],[{id:'new-id',name:'Chest press'}])];
  const stats=historyStats({checkins:[],workouts},range);
  assert.equal(stats.exercises.length,1);assert.equal(stats.exercises[0].sets,2);
  const narrowed=historyStats({checkins:[],workouts},{from:'2026-10-01',to:'2026-10-01'});
  assert.equal(narrowed.training.count,1);assert.equal(narrowed.exercises[0].bestWeight,50);
});
