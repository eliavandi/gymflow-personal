import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {seedState,parseWorkbook,normalizeProgramInput,applyMutation} from '../server.mjs';

async function importExample(current){
  const wb=new ExcelJS.Workbook();
  const sheet=wb.addWorksheet('Allenamento');
  for(const code of ['A','B','C']){
    sheet.addRow(['Esercizio','Serie x reps','Recupero','Seduta']);
    for(let i=1;i<=8;i++)sheet.addRow([`Squat ${code} ${i}`,'4x6/8',"2' - 3'",code]);
    sheet.addRow([]);
  }
  return parseWorkbook('example.xlsx',Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),current);
}

test('reads every row in all three Excel blocks, including sets and rest ranges',async()=>{
  const program=await importExample(seedState().program);
  assert.deepEqual(program.sessions.map(s=>s.exercises.length),[8,8,8]);
  for(const session of program.sessions){
    assert.equal(session.exercises.at(-1).name,`Squat ${session.code} 8`);
    for(const e of session.exercises){
      assert.equal(e.sets,4);assert.equal(e.repsMin,6);assert.equal(e.repsMax,8);assert.equal(e.restSec,150);
    }
  }
});

test('queued edits from before an import cannot restore the demo program',async()=>{
  const state=seedState();
  const old=structuredClone(state.program);
  state.program=normalizeProgramInput(await importExample(state.program),state.program,true);
  const imported=structuredClone(state.program);
  const mutation={id:'old-offline-save',type:'save_program',payload:{program:old}};
  assert.equal(applyMutation(state,mutation),'stale_program');
  assert.deepEqual(state.program,imported);
  assert.equal(applyMutation(state,mutation),'stale_program');
  assert.deepEqual(state.program.sessions.map(s=>s.exercises.length),[8,8,8]);
});

test('valid current-program edits and independent check-ins still synchronize',async()=>{
  const state=seedState();
  const edit=structuredClone(state.program);
  edit.sessions[0].exercises[0].name='Updated exercise';
  const mutation={id:'current-edit',type:'save_program',payload:{program:edit}};
  applyMutation(state,mutation);
  assert.equal(state.program.sessions[0].exercises[0].name,'Updated exercise');
  applyMutation(state,mutation);
  assert.equal(state.appliedMutations.filter(id=>id===mutation.id).length,1);
  applyMutation(state,{id:'check-in',type:'upsert_checkin',payload:{date:'2026-10-08',weight:80,waist:83}});
  assert.equal(state.checkins[0].weight,80);
});

test('a mismatched generation is rejected even if either id or version matches',()=>{
  const state=seedState();
  for(const program of [{...state.program,id:'another-program'},{...state.program,version:2}]){
    assert.equal(applyMutation(state,{id:crypto.randomUUID(),type:'save_program',payload:{program}}),'stale_program');
  }
});
