import test from 'node:test';
import assert from 'node:assert/strict';
import {localDayKey,weeklyActivity,todayTasks} from '../today-model.js';

test('calendar starts on Monday and counts sessions separately from active days',()=>{
  const now=new Date(2026,9,8,12);
  const workouts=[
    {status:'completed',finishedAt:new Date(2026,9,5,18).toISOString()},
    {status:'completed',finishedAt:new Date(2026,9,8,7).toISOString()},
    {status:'completed',finishedAt:new Date(2026,9,8,19).toISOString()},
    {status:'cancelled',finishedAt:new Date(2026,9,7,18).toISOString()},
    {status:'in_progress',startedAt:now.toISOString()},
    {status:'completed',finishedAt:new Date(2026,9,4,18).toISOString()}
  ];
  const week=weeklyActivity(workouts,now);
  assert.equal(week.days[0].key,'2026-10-05');assert.equal(week.days[6].key,'2026-10-11');
  assert.equal(week.total,3);assert.equal(week.activeDays,2);assert.equal(week.days[3].workouts.length,2);
});

test('Sunday and year boundaries remain in the correct Monday–Sunday week',()=>{
  const week=weeklyActivity([],new Date(2027,0,3,23));
  assert.equal(week.days[0].key,'2026-12-28');assert.equal(week.days[6].key,'2027-01-03');
  assert.equal(weeklyActivity([],new Date(2027,0,4)).days[0].key,'2027-01-04');
});

test('timestamps use the local calendar day, including sessions near midnight',()=>{
  const now=new Date(2026,9,8,0,15);
  const workout={status:'completed',finishedAt:now.toISOString()};
  assert.equal(localDayKey(workout.finishedAt),'2026-10-08');
  assert.equal(weeklyActivity([workout],now).days[3].workouts.length,1);
});

test('reminders update independently; active or malformed workouts do not count as completed',()=>{
  const now=new Date(2026,9,8,12);
  const malformed=[{status:'completed'},{status:'completed',finishedAt:'invalid'},{status:'in_progress',startedAt:now.toISOString()}];
  assert.equal(todayTasks({},malformed,now).filter(t=>t.done).length,0);
  assert.equal(todayTasks({weight:80,waist:84,diet:'non_rispettata'},malformed,now).filter(t=>t.done).length,3);
  assert.equal(todayTasks({weight:80,waist:84,diet:'rispettata'},[{status:'completed',finishedAt:now.toISOString()}],now).filter(t=>t.done).length,4);
  assert.equal(todayTasks({weight:80},[{status:'completed',finishedAt:new Date(2026,9,7,12).toISOString()}],now).find(t=>t.key==='workout').done,false);
});
