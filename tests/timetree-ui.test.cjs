/* 管理者本人確認と TimeTree 接続の取り違え、失効、画面移動の競合を検証。 */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../timetree-view.js"),"utf8");
function harness({role="admin",token="signed-admin-token",connected=false,failAction="",deferred=null}={}){
  const hooks=[],effects=[],cleanups=[],calls=[];let cursor=0,tree;
  const user={id:"ADMIN",role,email:"admin@example.test",coachAuthToken:token};
  const useState=initial=>{const i=cursor++;if(!(i in hooks))hooks[i]=typeof initial==="function"?initial():initial;return [hooks[i],value=>{hooks[i]=typeof value==="function"?value(hooks[i]):value;}];};
  const useRef=initial=>{const i=cursor++;if(!(i in hooks))hooks[i]={current:initial};return hooks[i];};
  const useEffect=(fn,deps)=>{const i=cursor++;if(!hooks[i]||deps.some((value,j)=>value!==hooks[i][j])){hooks[i]=deps;effects.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}};
  const h=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(v=>v!==false&&v!=null)});
  const window={preact:{h},preactHooks:{useState,useRef,useEffect}};
  for(const name of ["localStorage","sessionStorage"])Object.defineProperty(window,name,{get(){throw new Error("TimeTree data must not use persistent storage");}});
  const context=vm.createContext({window});vm.runInContext(source,context);
  const sample={id:"E1",title:"練習",startAt:Date.parse("2030-11-12T09:00:00+09:00"),endAt:Date.parse("2030-11-12T11:00:00+09:00"),startDate:"2030-11-12",endDate:"2030-11-12",allDay:false,location:"グラウンド",note:"<img src=x onerror=alert(1)>",recurring:false};
  const api=async(action,body)=>{
    calls.push({action,body});if(deferred&&action==="getTimeTreeEvents")return deferred;
    if(action===failAction)throw new Error("COACH_AUTH_REQUIRED: 管理者の本人確認をやり直してください");
    if(action==="login")return {user:{...user,role:"admin",coachAuthToken:"renewed-admin-token"}};
    if(action==="connectTimeTree"){connected=true;return {connected:true,calendars:[{id:"1",name:"チーム"},{id:"2",name:"個人"}]};}
    if(action==="getTimeTreeCalendars")return {connected,calendars:connected?[{id:"1",name:"チーム"},{id:"2",name:"個人"}]:[]};
    if(action==="getTimeTreeEvents")return {calendar:{id:"1",name:"チーム"},events:[sample,{...sample,id:"RECUR",title:"毎週の練習",recurring:true}],fetchedAt:"2026-11-12T00:00:00Z"};
    if(action==="disconnectTimeTree"){connected=false;return {connected:false};}
    throw new Error("Unexpected action "+action);
  };
  function render(){cursor=0;tree=context.window.TimeTreePanel({user,api});if(tree&&typeof tree.type==="function")tree=tree.type(tree.props);while(effects.length)effects.shift()();return tree;}
  function nodes(node=tree){return node&&typeof node==="object"?[node,...node.children.flatMap(child=>nodes(child))]:[];}
  function text(node=tree){return node&&typeof node==="object"?node.children.map(text).join(""):String(node??"");}
  function input(id,value){const node=nodes().find(n=>n.props.id===id);assert.ok(node,"Missing input "+id);const event={currentTarget:{value}};(node.props.onInput||node.props.onChange)(event);render();}
  const button=label=>nodes().find(n=>n.type==="button"&&text(n)===label);
  const submit=()=>nodes().find(n=>n.type==="form").props.onSubmit({preventDefault(){}});
  async function settle(){for(let round=0;round<3;round++){for(let i=0;i<15;i++)await Promise.resolve();render();}}
  render();return {nodes,text,input,button,submit,settle,calls,render,user,sample,unmount:()=>cleanups.forEach(fn=>fn?.())};
}
module.exports=(async()=>{
  let count=0;const test=async(name,run)=>{await run();count++;console.log("OK "+name);};
  await test("一般メンバー・閲覧者には画面を出さず API も呼ばない",async()=>{
    for(const role of ["member","viewer",""]){const f=harness({role});await f.settle();assert.equal(f.nodes().length,0);assert.equal(f.calls.length,0);f.unmount();}
  });
  await test("古いログインはアプリ本人確認をしてから TimeTree の入力へ進む",async()=>{
    const f=harness({token:""});assert.ok(f.text().includes("このアプリのパスワード"));assert.equal(f.calls.length,0);
    f.input("tt-admin-password","app-password");await f.submit();await f.settle();assert.equal(f.calls[0].action,"login");assert.equal(f.calls[0].body.password,"app-password");
    assert.ok(f.text().includes("TimeTreeのメールアドレス"));assert.ok(!f.text().includes("app-password"));assert.ok(f.calls.some(c=>c.action==="getTimeTreeCalendars"&&c.body.coachAuthToken==="renewed-admin-token"));f.unmount();
  });
  await test("TimeTree 接続のパスワードは送信直後に入力から消しカレンダー選択を待つ",async()=>{
    const f=harness();await f.settle();f.input("tt-email","team@example.test");f.input("tt-password","provider-password");const pending=f.submit();f.render();
    assert.equal(f.nodes().find(n=>n.props.id==="tt-password").props.value,"");await pending;await f.settle();
    const connect=f.calls.find(c=>c.action==="connectTimeTree");assert.equal(connect.body.password,"provider-password");assert.equal(connect.body.coachAuthToken,"signed-admin-token");
    assert.equal(f.calls.filter(c=>c.action==="getTimeTreeEvents").length,0);assert.equal(f.button("予定を表示する").props.disabled,true);f.unmount();
  });
  await test("選んだカレンダーだけを表示し本文を HTML として実行しない",async()=>{
    const f=harness({connected:true});await f.settle();f.input("tt-calendar","1");await f.button("予定を表示する").props.onClick();await f.settle();
    assert.equal(f.calls.find(c=>c.action==="getTimeTreeEvents").body.calendarId,"1");assert.ok(f.text().includes("グラウンド"));assert.ok(f.text().includes("<img src=x onerror=alert(1)>"));
    assert.ok(!f.nodes().some(n=>n.type==="img"||n.props.dangerouslySetInnerHTML));assert.ok(f.text().includes("繰り返し予定の原本"));
    f.input("tt-calendar","2");assert.ok(!f.text().includes("グラウンド"));assert.equal(f.button("予定を表示する").props.disabled,false);f.unmount();
  });
  await test("権限失効時は取得した予定と接続を消し本人確認へ戻す",async()=>{
    const f=harness({connected:true,failAction:"getTimeTreeEvents"});await f.settle();f.input("tt-calendar","1");await f.button("予定を表示する").props.onClick();await f.settle();
    assert.ok(f.text().includes("管理者の本人確認"));assert.ok(!f.text().includes("接続済み"));assert.ok(!f.text().includes("グラウンド"));f.unmount();
  });
  await test("接続解除で表示内容と選択を消しログイン画面へ戻す",async()=>{
    const f=harness({connected:true});await f.settle();f.input("tt-calendar","1");await f.button("予定を表示する").props.onClick();await f.settle();
    await f.button("接続を解除").props.onClick();await f.settle();assert.ok(f.calls.some(c=>c.action==="disconnectTimeTree"));assert.ok(f.text().includes("TimeTreeのメールアドレス"));assert.ok(!f.text().includes("グラウンド"));f.unmount();
  });
  await test("画面を閉じたあとに取得が終わっても予定を反映しない",async()=>{
    let resolve;const pending=new Promise(r=>{resolve=r;});const f=harness({connected:true,deferred:pending});await f.settle();f.input("tt-calendar","1");const loading=f.button("予定を表示する").props.onClick();f.unmount();
    resolve({events:[{...f.sample,title:"反映してはいけない予定"}],fetchedAt:"2026-11-12"});await loading;f.render();assert.ok(!f.text().includes("反映してはいけない予定"));
  });
  console.log(count+" TimeTree UI tests passed");
})();
