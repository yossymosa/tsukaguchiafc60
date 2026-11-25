const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8"),gas=fs.readFileSync(path.join(__dirname,"../gas-readwrite (5).js"),"utf8"),youtube=fs.readFileSync(path.join(__dirname,"../youtube-sync.js"),"utf8");
function part(source,a,b){const i=source.indexOf(a),j=source.indexOf(b,i);assert(i>=0&&j>i,a);return source.slice(i,j);}
function form(kind,result={}) {
  let cursor=0,tree,saved;const hooks=[];
  const h=(type,props,...children)=>typeof type==="function"?type(props||{}):({type,props:props||{},children:children.flat(Infinity).filter(x=>x!==false&&x!=null)});
  const c=vm.createContext({h,Modal:"modal",OpponentColorPicker:"picker",css:{inp:{},bG:{},bS:{}},useMemo:fn=>fn(),
    useState:init=>{const i=cursor++;if(!(i in hooks))hooks[i]=typeof init==="function"?init():init;return [hooks[i],v=>{hooks[i]=typeof v==="function"?v(hooks[i]):v;}];},
    parseFormatSelection:()=>({time:10,mode:"half"}),normalizeOpponentColor:x=>x||"blue",normalizeFormationLabel:x=>x||"",getTC:t=>({lb:({official:"公式戦",training:"トレマ",cup:"カップ戦"})[t]||t}),
    getScheduleResults:()=>[],nd:x=>x||"",DEFAULT_OPPONENT_COLOR:"blue",DEFAULT_FORMAT_TIME:10,DEFAULT_FORMAT_MODE:"half",FORMAT_TIME_OPTIONS:[10],FORMAT_MODE_OPTIONS:[{key:"half",label:"ハーフ"}],MATCH_FORMATION_PRESETS:{},buildFormatLabel:()=>"10分 ハーフ",getOpponentColor:()=>"blue",alert:m=>{throw Error(m);}});
  vm.runInContext(part(html,"function MatchTypeSelector(","// ── 試合一覧：月別タブ"),c);
  vm.runInContext(part(html,"function AddMatchModal(","// ── 成績タブ"),c);
  const schedule={id:"day",date:"2026-11-25",type:"official"};
  function render(){cursor=0;const props=kind==="add"?{schedule,results:[],schedules:[],onSave:v=>{saved=v;},onClose:()=>{}}:{result:{id:"one",opponent:"相手",type:"official",...result},schedule,members:[],onSave:v=>{saved=v;},onClose:()=>{}};tree=kind==="add"?c.AddMatchModal(props):c.EditResultModal(props);return tree;}
  function nodes(node=tree){return node&&typeof node==="object"?[node,...node.children.flatMap(nodes)]:[];}
  function text(node=tree){return node&&typeof node==="object"?node.children.map(text).join(""):String(node??"");}
  const button=label=>nodes().find(n=>n.type==="button"&&text(n)===label);
  const click=async label=>{const b=button(label);assert(b,label);await b.props.onClick();render();};
  render();return {render,nodes,text,button,click,get saved(){return saved;}};
}
(async()=>{
  let f=form("add");assert.equal(f.button("日程に合わせる").props["aria-pressed"],true);
  const input=f.nodes().find(n=>n.type==="input");input.props.onChange({target:{value:"相手A"}});f.render();await f.click("トレマ");await f.click("追加する");assert.equal(f.saved.matchType,"training");assert.equal(f.saved.type,"official");
  f=form("edit");assert.equal(f.button("日程に合わせる").props["aria-pressed"],true);await f.click("公式戦");await f.click("保存する");assert.equal(f.saved.matchType,"official");
  f=form("edit",{matchType:"training"});assert.equal(f.button("トレマ").props["aria-pressed"],true);await f.click("日程に合わせる");await f.click("保存する");assert.equal(f.saved.matchType,"");

  const tc=vm.createContext({fmt:()=>({y:2026,m:11,d:25}),normalizeType:v=>v,getTC:v=>({lb:{official:"公式戦",training:"トレマ"}[v]||v})});
  vm.runInContext(part(html,"function makeYtTitle(","// 旧テンプレ"),tc);
  assert.match(tc.makeYtTitle({opponent:"相手",matchType:"training"},{type:"official"},"1st"),/トレマ/);
  assert.match(tc.makeYtTitle({opponent:"相手"},{type:"official"},"1st"),/公式戦/);
  const dc=vm.createContext({findLinkedScheduleForResult:()=>({type:"official"}),schedules:[],normalizeType:v=>v});
  vm.runInContext(part(html,"  const getResultType=row=>", "  const parseResultShotStats")+"\nthis.match=typeMatch;",dc);
  assert.equal(dc.match({opponent:"相手",type:"official",matchType:"training"},"training"),true);
  assert.equal(dc.match({opponent:"相手",type:"official",matchType:"training"},"official"),false);
  assert.equal(dc.match({opponent:"相手",type:"official"},"official"),true);
  assert.equal(dc.match({opponent:"相手",type:"training"},"official"),true);

  const headers=["ID","相手チーム","相手カラー","試合形式","第○試合","試合種別"], cells={}, appended=[];
  const sheet={getLastRow:()=>2,getLastColumn:()=>headers.length,getRange:(row,col,rows)=>({getValues:()=>rows===1?[headers]:[["ID"],["one"]],setValue:value=>{cells[headers[col-1]]=value;}})};
  const gc=vm.createContext({MAPS:{result:{}},ensureSheetColumnsByMap:()=>{},getSheet:()=>sheet,genId:()=>"id",appendObject:(_s,_m,obj)=>appended.push(obj)});
  const add=part(gas,'case "addResult": {','// ── YouTubeタイトル');
  const update=part(gas,'case "updateResult": {','// 非公開の TimeTree');
  vm.runInContext('function run(req){switch(req.action){'+add+update+'}}',gc);
  gc.run({action:"addResult",result:{opponent:"相手",type:"official",matchType:"training"}});assert.equal(appended[0].matchType,"training");
  gc.run({action:"updateResult",result:{id:"one",matchType:"official"}});assert.equal(cells["試合種別"],"official");
  gc.run({action:"updateResult",result:{id:"one",matchType:""}});assert.equal(cells["試合種別"],"");
  cells["試合種別"]="training";gc.run({action:"updateResult",result:{id:"one",opponent:"別"}});assert.equal(cells["試合種別"],"training");

  const yc=vm.createContext({});vm.runInContext(youtube,yc);
  const fields={ID:"one","種類":"official","試合種別":"training","スケジュールID":"day"}, names=Object.keys(fields);
  const ys={getRange:(_row,col)=>({getValue:()=>fields[names[col-1]]})};
  let context=yc.buildYoutubeResultContext_(ys,names,2,{day:{type:"official"}},{});assert.equal(context.type,"training");
  fields["試合種別"]="";context=yc.buildYoutubeResultContext_(ys,names,2,{day:{type:"official"}},{});assert.equal(context.type,"official");
  fields["種類"]="training";context=yc.buildYoutubeResultContext_(ys,names,2,{day:{type:"official"}},{});assert.equal(context.type,"official");
  console.log("Match type: per-match selection, save, legacy fallback and YouTube context passed");
})().catch(e=>{console.error(e);process.exitCode=1;});
