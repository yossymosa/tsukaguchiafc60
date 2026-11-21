const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../gas-readwrite (5).js"),"utf8");
function fixture(){
  const members=[{id:"A",name:"あお"},{id:"B",name:"そら"},{id:"C",name:"りく"}],attendance=[{scheduleId:"S1",memberId:"A",status:"○"},{scheduleId:"S1",memberId:"B",status:"×"},{scheduleId:"S2",memberId:"C",status:"○"}];
  const rows=[["MVP","ID"],["","S1"],["","S2"]],writes=[];
  const sheet={getLastRow:()=>rows.length,getLastColumn:()=>rows[0].length,getRange:(row,col,count=1,width=1)=>({getValues:()=>rows.slice(row-1,row-1+count).map(r=>r.slice(col-1,col-1+width)),setValue:value=>writes.push({row,col,value})})};
  const context=vm.createContext({});vm.runInContext(source,context);
  context.sheetToObjects=name=>name==="出欠"?attendance:name==="メンバー"?members:[];context.getSheet=()=>sheet;
  const save=extra=>context.dispatch({action:"updateMvp",scheduleId:"S1",...extra});
  return {members,attendance,rows,writes,save};
}
let count=0;const test=(name,run)=>{run();count++;console.log("OK "+name);};
test("MVPを当日の出席者IDで保存し、現在の選手名を返す",()=>{
  const f=fixture(),response=f.save({memberId:"A",mvp:"古い名前"});assert.equal(response.mvp,"あお");assert.equal(response.memberId,"A");assert.deepEqual(f.writes,[{row:2,col:1,value:"あお"}]);
});
test("欠席・未定・未回答・別日程の出席者や不明IDは書き込み前に拒否",()=>{
  for(const extra of [{memberId:"B",mvp:"そら"},{memberId:"C",mvp:"りく"},{memberId:"UNKNOWN",mvp:"あお"}]){
    const f=fixture();assert.throws(()=>f.save(extra),/出欠が「○」/);assert.equal(f.writes.length,0);
  }
  for(const status of ["△","未",""]){const f=fixture();f.attendance[0].status=status;assert.throws(()=>f.save({memberId:"A",mvp:"あお"}),/出欠が「○」/);assert.equal(f.writes.length,0);}
});
test("候補の表示後に出欠が変わっても最新の状態で判定",()=>{
  const f=fixture();f.attendance.push({scheduleId:"S1",memberId:"A",status:"×"});assert.throws(()=>f.save({memberId:"A",mvp:"あお"}),/出欠が「○」/);assert.equal(f.writes.length,0);
});
test("旧画面の名前指定を保ち、同名の選手はIDで区別",()=>{
  const f=fixture();assert.equal(f.save({mvp:"あお"}).memberId,"A");
  const g=fixture();g.members.push({id:"D",name:"あお"});g.attendance.push({scheduleId:"S1",memberId:"D",status:"○"});
  assert.throws(()=>g.save({mvp:"あお"}),/出欠が「○」/);assert.equal(g.writes.length,0);assert.equal(g.save({memberId:"D",mvp:"あお"}).memberId,"D");
});
test("既存MVPの解除は可能で、存在しない日程を成功にしない",()=>{
  const f=fixture();assert.equal(f.save({mvp:""}).mvp,"");assert.deepEqual(f.writes,[{row:2,col:1,value:""}]);
  const g=fixture();assert.throws(()=>g.save({scheduleId:"missing",memberId:"A",mvp:"あお"}),/日程が見つかりません/);assert.equal(g.writes.length,0);
});
console.log(count+" MVP server tests passed");
