const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const between=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const helpers=between("function getTC(","const TC=")+between("function toHalfWidthDigits(","function getGradeNumber(")+between("function nd(","function todayLocal(")+between("function getMonthlyLeaders(","function MonthlyRankings(");
const context=vm.createContext({});vm.runInContext(helpers,context);
const members=[{id:"A",name:"あお",number:8},{id:"B",name:"そら",number:2},{id:"C",name:"りく",number:10},{id:"D",name:"れん",number:4}];
const goal=(scorerId,assistId="",extra={})=>({scorerId,assistId,...extra});
const result=(id,goals,extra={})=>({id,date:"2026-11-21",type:"official",goals,...extra});
const rank=(results,schedules=[],roster=members,today="2026-11-21")=>JSON.parse(JSON.stringify(context.getMonthlyLeaders(results,schedules,roster,today)));
let count=0;const test=async(name,run)=>{await run();count++;console.log("OK "+name);};
function panelFixture({attendance=[{memberId:"A",status:"○"},{memberId:"B",status:"×"},{memberId:"C",status:"△"},{memberId:"D",status:"○"}],role="admin",deferred,fail=false,saveFails=false}={}){
  let cursor=0,tree;const hooks=[],effects=[],cleanups=[],calls=[],saves=[];
  const schedule={id:"S1",mvp:"そら"},roster=members.map(m=>({...m,position:""}));
  const useState=initial=>{const i=cursor++;if(!(i in hooks))hooks[i]=typeof initial==="function"?initial():initial;return [hooks[i],value=>{hooks[i]=typeof value==="function"?value(hooks[i]):value;}];};
  const useRef=initial=>{const i=cursor++;return hooks[i]||(hooks[i]={current:initial});};
  const useMemo=fn=>{cursor++;return fn();};
  const useEffect=(fn,deps)=>{const i=cursor++;if(!hooks[i]||deps.some((value,j)=>value!==hooks[i][j])){hooks[i]=deps;effects.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}};
  const h=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(v=>v!==false&&v!=null)});
  const api=async(action,body)=>{calls.push({action,body});if(fail)throw new Error("offline");return deferred||{attend:attendance};};
  const ctx=vm.createContext({useState,useRef,useMemo,useEffect,h,Fragment:"fragment",api,css:{inp:{},bG:{},bS:{}}});
  vm.runInContext(between("function getAttendingMvpMembers(","function DayPage("),ctx);
  const onSaveMvp=async(...args)=>{saves.push(args);if(saveFails)throw new Error("出席者を再読み込みしてください。");schedule.mvp=args[1];};
  const render=()=>{cursor=0;tree=ctx.ScheduleMvpPanel({schedule,members:roster,isAdmin:role==="admin",onSaveMvp});while(effects.length)effects.shift()();return tree;};
  const nodes=(node=tree)=>node&&typeof node==="object"?[node,...node.children.flatMap(child=>nodes(child))]:[];
  const text=(node=tree)=>node&&typeof node==="object"?node.children.map(text).join(""):String(node??"");
  const button=label=>nodes().find(n=>n.type==="button"&&text(n)===label);
  const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();render();};
  render();return {render,settle,nodes,text,button,calls,saves,schedule,
    choose(id){nodes().find(n=>n.type==="select").props.onChange({target:{value:id}});render();},
    fail(value){fail=value;},unmount(){cleanups.forEach(fn=>fn?.());}};
}
module.exports=(async()=>{
  await test("今月の得点・アシストを別々に集計し、上位3人と同順位を表示",()=>{
    const data=rank([result("R1",[goal("A","C"),goal("A","B"),goal("B","C"),goal("B"),goal("C","A"),goal("D","B")])]);
    assert.deepEqual(data.goals.map(r=>[r.member.id,r.value,r.rank]),[["B",2,1],["A",2,1],["D",1,3]]);
    assert.deepEqual(data.assists.map(r=>[r.member.id,r.value,r.rank]),[["B",2,1],["C",2,1],["A",1,3]]);
  });
  await test("前月・翌月・別年・5年帯同・オウンゴール・失点・PK戦を混ぜない",()=>{
    const data=rank([result("ok",[goal("A","B"),goal("C","D",{goalType:"PK"}),goal("A","B",{goalType:"オウンゴール"}),goal("A","B",{team:"them"})],{pkKickers:[{memberId:"A",success:true}]}),
      result("old",[goal("A")],{date:"2026-10-31"}),result("next",[goal("A")],{date:"2026-12-01"}),result("year",[goal("A")],{date:"2025-11-21"}),
      result("five",[goal("A")],{scheduleId:"FIVE"}),result("five-type",[goal("A")],{type:"five_accompany"})],[{id:"FIVE",date:"2026-11-21",type:"5年帯同"}]);
    assert.deepEqual(data.goals.map(r=>[r.member.id,r.value]),[["A",1],["C",1]]);
    assert.deepEqual(data.assists.map(r=>[r.member.id,r.value]),[["B",1],["D",1]]);
    assert.equal(rank([result("old",[goal("A")])],[],members,"2026-12-01").goals.length,0);
  });
  await test("旧名義データとJSONを読み、重複した試合や不明な選手を二重集計しない",()=>{
    const rows=[result("R1",JSON.stringify([goal("","",{scorerName:"あお",assistName:"そら"})])),result("R1",[goal("A")]),result("bad","invalid"),result("unknown",[goal("missing")])];
    const original=JSON.stringify(rows);const data=rank(rows);
    assert.deepEqual(data.goals.map(r=>[r.member.id,r.value]),[["A",1]]);assert.equal(data.assists[0].member.id,"B");assert.equal(JSON.stringify(rows),original);
    assert.equal(rank([result("ambiguous",[goal("","",{scorerName:"あお"})])],[],[...members,{id:"X",name:"あお"}]).goals.length,0);
  });
  await test("記録がない月も安全に空のランキングを返す",()=>{
    assert.deepEqual(rank([]),{goals:[],assists:[]});
    assert.ok(!source.includes("日々の挑戦を、チームの力に。"));
  });
  await test("MVP候補はポジション未設定でも出席○の選手だけを背番号順に表示",async()=>{
    const f=panelFixture();assert.equal(f.nodes().find(n=>n.type==="select").props.disabled,true);await f.settle();
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0])),{action:"getAttend",body:{scheduleId:"S1"}});
    assert.deepEqual(f.nodes().filter(n=>n.type==="option"&&n.props.value).map(n=>n.props.value),["D","A"]);
    assert.equal(f.nodes().find(n=>n.type==="select").props.value,"");assert.equal(f.button("MVPを保存").props.disabled,true);
    f.choose("A");await f.button("MVPを保存").props.onClick();f.render();assert.deepEqual(f.saves,[["S1","あお","A"]]);assert.ok(f.text().includes("今回のMVPあお"));f.unmount();
  });
  await test("出席者ゼロ・取得失敗では全選手へ戻さず、再読み込み後に選択可能",async()=>{
    const empty=panelFixture({attendance:[]});await empty.settle();assert.equal(empty.nodes().filter(n=>n.type==="option"&&n.props.value).length,0);assert.equal(empty.button("MVPを保存").props.disabled,true);empty.unmount();
    const f=panelFixture({fail:true});await f.settle();assert.ok(f.nodes().some(n=>n.props.role==="alert"));assert.equal(f.nodes().filter(n=>n.type==="option"&&n.props.value).length,0);
    f.fail(false);f.button("出席者を再読み込み").props.onClick();f.render();await f.settle();assert.equal(f.nodes().filter(n=>n.type==="option"&&n.props.value).length,2);f.unmount();
  });
  await test("一般メンバーにはMVPの編集や出欠取得を出さず、保存失敗も成功に見せない",async()=>{
    const member=panelFixture({role:"member"});await member.settle();assert.equal(member.calls.length,0);assert.equal(member.nodes().some(n=>n.type==="select"||n.type==="button"),false);member.unmount();
    const f=panelFixture({saveFails:true});await f.settle();f.choose("A");await f.button("MVPを保存").props.onClick();f.render();assert.ok(f.nodes().some(n=>n.props.role==="alert"));assert.equal(f.schedule.mvp,"そら");assert.equal(f.button("MVPを保存").props.disabled,true);f.unmount();
  });
  console.log(count+" home ranking and MVP UI tests passed");
})();
