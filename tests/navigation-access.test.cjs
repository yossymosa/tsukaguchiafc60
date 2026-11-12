/* メニュー・画面遷移・権限変更で管理者設定が一般ユーザーに表示されないことを検証。 */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const appSource=source.slice(source.indexOf("function App() {"),source.indexOf("render(h(App,{}),"));
const settingsSource=source.slice(source.indexOf("function SettingsTab("),source.indexOf("function AdminSettingsTab("));
const calendarSource=source.slice(source.indexOf("function ScheduleCalendarTab("),source.indexOf("function CalTab("));
const h=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(v=>v!==false&&v!=null)});
const nodes=tree=>tree&&typeof tree==="object"?[tree,...tree.children.flatMap(nodes)]:[];
const text=tree=>tree&&typeof tree==="object"?tree.children.map(text).join(""):String(tree??"");
function fixture(role){
  const states=[],refs=[];let cursor=0,refCursor=0,tree;
  const context={h,Fragment:"fragment",URLSearchParams,location:{search:""},window:{innerWidth:375,scrollY:0},
    localStorage:{getItem:()=>JSON.stringify({id:"USER",role})},
    useState:initial=>{const i=cursor++;if(!(i in states))states[i]=typeof initial==="function"?initial():initial;return [states[i],next=>{states[i]=typeof next==="function"?next(states[i]):next;}];},
    useRef:initial=>{const i=refCursor++;return refs[i]||(refs[i]={current:initial});},
    useCallback:fn=>fn,useEffect:()=>{},
    normalizeUiTabVisibility:value=>value,
    Element:class Element{closest(){return null;}},getComputedStyle:()=>({overflowX:"visible"})};
  for(const name of ["Login","Loader","HomeTab","ScheduleCalendarTab","MatchTab","DashTab","CameraTab","MemberTab","MemoTab","InfoTab","AdminSettingsTab","CalTab","AppHeader","AppIcon","PageIntro"]){
    context[name]=function component(){};
  }
  vm.createContext(context);vm.runInContext(settingsSource+appSource,context);
  const render=()=>{cursor=0;refCursor=0;tree=context.App();return tree;};
  const find=type=>nodes(tree).find(n=>n.type===context[type]);
  const nav=()=>nodes(tree).find(n=>n.type==="nav");
  render();
  return {context,render,find,nav,all:()=>nodes(tree),setRole:role=>{states[0]={...states[0],role};}};
}
let count=0;
const test=(name,run)=>{run();count++;console.log("OK "+name);};
test("一般メンバー・閲覧者・不明権限には設定メニューも画面も表示しない",()=>{
  for(const role of ["member","viewer","",undefined,"unknown"]){
    const f=fixture(role);
    assert.ok(!text(f.nav()).includes("設定"));
    f.find("HomeTab").props.onOpenTab("settings");f.render();
    assert.ok(f.find("HomeTab"));assert.ok(!f.find("SettingsTab"));
    assert.ok(!f.find("PageIntro"));
    assert.equal(f.context.SettingsTab({user:{role},isSuperAdmin:true}),null);
  }
});
test("管理者・特別管理者は設定を開ける",()=>{
  for(const role of ["admin","super_admin"]){
    const f=fixture(role);
    const button=nodes(f.nav()).find(n=>n.type==="button"&&text(n)==="設定");
    assert.ok(button);button.props.onClick();f.render();
    assert.ok(f.find("SettingsTab"));
    assert.equal(f.context.SettingsTab({user:{role}}).type,f.context.AdminSettingsTab);
  }
});
test("一般ユーザーは最後の資料タブからスワイプしても設定に進まない",()=>{
  const f=fixture("member");f.find("HomeTab").props.onOpenTab("docs");f.render();
  const main=f.all().find(n=>n.type==="main"),target=new f.context.Element();
  const event=(x,end=false)=>({target,currentTarget:target,touches:end?[]:[{clientX:x,clientY:200}],changedTouches:[{clientX:x,clientY:200}]});
  main.props.onTouchStart(event(290));main.props.onTouchMove(event(180));main.props.onTouchEnd(event(90,true));f.render();
  assert.ok(f.find("InfoTab"));assert.ok(!f.find("SettingsTab"));
});
test("設定を開いた状態で管理者権限を失うとその描画から設定内容を隠す",()=>{
  const f=fixture("admin");f.find("HomeTab").props.onOpenTab("settings");f.render();assert.ok(f.find("SettingsTab"));
  f.setRole("member");f.render();
  assert.ok(!text(f.nav()).includes("設定"));assert.ok(!f.find("SettingsTab"));assert.ok(!f.find("PageIntro"));assert.ok(f.find("HomeTab"));
});
test("TimeTreeは全権限で日程に表示せず接続用スクリプトも読み込まない",()=>{
  assert.ok(!/<script\b[^>]*\bsrc=["'][^"']*timetree-view\.js/i.test(source));
  const context={h,CalTab:()=>{},window:{get TimeTreePanel(){throw new Error("TimeTree must remain hidden");}}};
  vm.createContext(context);vm.runInContext(calendarSource,context);
  for(const role of ["admin","super_admin","member","viewer"]){
    const tree=context.ScheduleCalendarTab({user:{role},isAdmin:["admin","super_admin"].includes(role)});
    assert.equal(tree.type,context.CalTab);assert.ok(!text(tree).includes("TimeTree"));
  }
});
console.log(count+" navigation access tests passed");
