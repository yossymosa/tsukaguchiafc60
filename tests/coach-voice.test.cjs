/* node tests/coach-voice.test.cjs — GAS の認証・非公開保存を外部通信なしで検証 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const source = fs.readFileSync(path.join(__dirname,"../gas-readwrite (5).js"),"utf8");
let count=0;
function test(name,run){run();count++;console.log("OK "+name);}
function fixture(){
  const users=[{id:"ADMIN",role:"admin",email:"admin@example.test",name:"管理者",password:"test-admin-password"},
    {id:"MEMBER",role:"member",email:"member@example.test",password:"test-member-password"},
    {id:"SUPER",role:"super_admin",password:"test-super-password"}];
  const props=new Map(), items=new Map();
  const metrics={fetches:0,created:0,clock:Date.now(),failNote:false};
  function iterator(values){let index=0;return {hasNext:()=>index<values.length,next:()=>values[index++]};}
  function blob(data,mimeType,name){
    const bytes=Buffer.isBuffer(data)?data:typeof data==="string"?Buffer.from(data):Buffer.from(data.map(v=>v&255));
    return {getBytes:()=>Array.from(bytes),getDataAsString:()=>bytes.toString("utf8"),bytes,mimeType,name};
  }
  class Item {
    constructor(name){this.id=crypto.randomUUID();this.name=name;this.access="private";this.editors=[];this.viewers=[];this.trashed=false;items.set(this.id,this);metrics.created++;}
    getId(){return this.id;} getSharingAccess(){return this.access;} getEditors(){return this.editors;} getViewers(){return this.viewers;}
    isTrashed(){return this.trashed;} setTrashed(value){this.trashed=value;return this;}
  }
  class File extends Item {constructor(value){super(value.name);this.blob=value;}getBlob(){return this.blob;}}
  class Folder extends Item {
    constructor(name){super(name);this.children=[];}
    createFolder(name){const item=new Folder(name);this.children.push(item);return item;}
    createFile(value){if(metrics.failNote&&value.mimeType==="application/json")throw new Error("Drive write failed");const item=new File(value);this.children.push(item);return item;}
    getFoldersByName(name){return iterator(this.children.filter(i=>i instanceof Folder&&i.name===name&&!i.trashed));}
    getFilesByName(name){return iterator(this.children.filter(i=>i instanceof File&&i.name===name&&!i.trashed));}
    getFilesByType(type){return iterator(this.children.filter(i=>i instanceof File&&i.blob.mimeType===type&&!i.trashed));}
  }
  class Clock extends Date {static now(){return metrics.clock;}}
  const context=vm.createContext({Date:Clock,console,
    Utilities:{Charset:{UTF_8:"UTF-8"},getUuid:()=>crypto.randomUUID(),
      base64EncodeWebSafe:data=>Buffer.from(typeof data==="string"?data:data.map(v=>v&255)).toString("base64url"),
      base64DecodeWebSafe:data=>Array.from(Buffer.from(data,"base64url")),
      base64Encode:data=>Buffer.from(data.map(v=>v&255)).toString("base64"),base64Decode:data=>Array.from(Buffer.from(data,"base64")),
      computeHmacSha256Signature:(data,key)=>Array.from(crypto.createHmac("sha256",key).update(data).digest()),newBlob:blob},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>props.get(key)||null,setProperty:(key,value)=>props.set(key,value)})},
    LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
    DriveApp:{Access:{PRIVATE:"private"},createFolder:name=>new Folder(name),getFolderById:id=>items.get(id),getFileById:id=>items.get(id)},
    UrlFetchApp:{fetch:(_url,request)=>{
      metrics.fetches++;metrics.lastRequest=JSON.parse(request.payload);
      return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({speechDetected:true,transcript:"後半は周りを見てパスを出そう。",summary:"指導のポイント\n・周りを見てパスを出す。"})}]}}]})};
    }}
  });
  vm.runInContext(source,context);
  context.sheetToObjects=name=>name==="ユーザー"?users:name==="試合結果"?[{id:"MATCH1",date:"2026-11-02"},{id:"MATCH2",date:"2026-11-02"}]:[];
  context.ensureSheetColumnsByMap=()=>{};
  context.getSpreadsheetTimeZone=()=>"Asia/Tokyo";
  context.getJstDate=()=>"2026-11-02";
  context.nowIso=()=>new Date(metrics.clock).toISOString();
  props.set("GEMINI_API_KEY","test-key-never-sent");
  const token=context.issueCoachVoiceSession(users[0]);
  const raw=Buffer.alloc(64);Buffer.from([0x1a,0x45,0xdf,0xa3]).copy(raw);
  const request=(action,extra={})=>({action,resultId:"MATCH1",id:"NOTE1",coachAuthToken:token,
    audioBase64:raw.toString("base64"),mimeType:"audio/webm",durationSec:30,label:"ハーフタイム",transcript:"後半は周りを見よう。",summary:"周りを見る。",...extra});
  return {context,users,props,items,metrics,request,token};
}

test("管理者・特別管理者のログインだけが署名セッションを発行",()=>{
  const f=fixture();
  const admin=f.context.dispatch({action:"login",email:f.users[0].email,password:f.users[0].password});
  assert.ok(admin.user.coachAuthToken);
  const member=f.context.dispatch({action:"login",email:f.users[1].email,password:f.users[1].password});
  assert.equal(member.user.coachAuthToken,"");
  assert.equal(f.context.requireCoachVoiceAdmin({coachAuthToken:f.context.issueCoachVoiceSession(f.users[2])}).id,"SUPER");
});
test("全操作で userId・role の偽装と未認証を拒否し、音声へ触れない",()=>{
  for(const action of ["getCoachVoiceNotes","analyzeCoachVoice","saveCoachVoiceNote","getCoachVoiceAudio","deleteCoachVoiceNote"]){
    const f=fixture();
    assert.throws(()=>f.context.dispatch(f.request(action,{coachAuthToken:"",userId:"ADMIN",role:"admin"})),/COACH_AUTH_REQUIRED/);
    assert.equal(f.metrics.created,0);assert.equal(f.metrics.fetches,0);
  }
});
test("一般メンバーの正規署名でも非公開記録を拒否",()=>{
  const f=fixture();
  assert.throws(()=>f.context.dispatch(f.request("getCoachVoiceNotes",{coachAuthToken:f.context.issueCoachVoiceSession(f.users[1])})),/COACH_AUTH_REQUIRED/);
});
test("署名改ざん・期限切れ・パスワード変更・降格・退会で失効",()=>{
  for(const modify of [
    f=>f.token.slice(0,-1)+(f.token.endsWith("a")?"b":"a"),
    f=>{f.metrics.clock+=8*24*60*60*1000;return f.token;},
    f=>{f.users[0].password="changed";return f.token;},
    f=>{f.users[0].role="member";return f.token;},
    f=>{f.users.shift();return f.token;}
  ]){const f=fixture();assert.throws(()=>f.context.requireCoachVoiceAdmin({coachAuthToken:modify(f)}),/COACH_AUTH_REQUIRED/);}
});
test("文字起こし・要約の解析ではファイルと共有シートを保存しない",()=>{
  const f=fixture();const result=f.context.dispatch(f.request("analyzeCoachVoice"));
  assert.ok(result.transcript.includes("後半"));assert.ok(result.summary);assert.equal(f.metrics.created,0);assert.equal(f.metrics.fetches,1);
  assert.ok(f.metrics.lastRequest.contents[0].parts[1].inlineData.data);
});
test("SafariのMP4はM4AとしてAIへ送り、元の音声形式を維持",()=>{
  const f=fixture();const mp4=Buffer.alloc(64);mp4.write("ftyp",4);
  const req=f.request("analyzeCoachVoice",{mimeType:"audio/mp4;codecs=mp4a.40.2",audioBase64:mp4.toString("base64")});
  f.context.dispatch(req);assert.equal(f.metrics.lastRequest.contents[0].parts[1].inlineData.mimeType,"audio/m4a");
  const saved=f.context.dispatch({...req,action:"saveCoachVoiceNote"}).note;assert.equal(saved.mimeType,"audio/mp4");
});
test("無効な音声・10分超・8MB超・空の要約を拒否",()=>{
  for(const extra of [{mimeType:"text/html"},{audioBase64:"invalid"},{audioBase64:Buffer.alloc(64).toString("base64")},{durationSec:602},{durationSec:0},{durationSec:Infinity},{audioBase64:"A".repeat(11184816)},{summary:""}]){
    const f=fixture();assert.throws(()=>f.context.dispatch(f.request("saveCoachVoiceNote",extra)));assert.equal(f.metrics.created,0);
  }
});
test("保存ボタンの再試行は二重保存せず、Drive IDもクライアントへ返さない",()=>{
  const f=fixture();const first=f.context.dispatch(f.request("saveCoachVoiceNote")).note;
  assert.equal(first.audioFileId,undefined);assert.equal(first.createdBy,"ADMIN");
  const before=f.metrics.created;const second=f.context.dispatch(f.request("saveCoachVoiceNote")).note;
  assert.equal(second.id,first.id);assert.equal(f.metrics.created,before);
  const list=f.context.dispatch(f.request("getCoachVoiceNotes")).notes;
  assert.equal(list.length,1);assert.equal(list[0].audioFileId,undefined);
});
test("試合間の指導記録・音声を分離",()=>{
  const f=fixture();f.context.dispatch(f.request("saveCoachVoiceNote"));
  assert.equal(f.context.dispatch(f.request("getCoachVoiceNotes",{resultId:"MATCH2"})).notes.length,0);
  assert.throws(()=>f.context.dispatch(f.request("getCoachVoiceAudio",{resultId:"MATCH2"})),/見つかりません/);
  const audio=f.context.dispatch(f.request("getCoachVoiceAudio"));assert.equal(audio.audioBase64,f.request("").audioBase64);
});
test("共有された保存先や音声では取得を拒否",()=>{
  for(const shared of ["root","audio"]){
    const f=fixture();f.context.dispatch(f.request("saveCoachVoiceNote"));
    const item=shared==="root"?f.items.get(f.props.get("COACH_VOICE_FOLDER_ID")):[...f.items.values()].find(i=>i.name==="audio-NOTE1.webm");
    item.access="anyone";assert.throws(()=>f.context.dispatch(f.request("getCoachVoiceAudio")),/共有設定/);
  }
});
test("保存中の障害では途中の音声ファイルを片付ける",()=>{
  const f=fixture();f.metrics.failNote=true;
  assert.throws(()=>f.context.dispatch(f.request("saveCoachVoiceNote")),/Drive write failed/);
  assert.equal([...f.items.values()].filter(i=>i.name==="audio-NOTE1.webm"&&!i.trashed).length,0);
  assert.equal(f.context.dispatch(f.request("getCoachVoiceNotes")).notes.length,0);
});
test("音声・文字起こし・要約をまとめて削除し、再削除も成功",()=>{
  const f=fixture();f.context.dispatch(f.request("saveCoachVoiceNote"));
  assert.equal(f.context.dispatch(f.request("deleteCoachVoiceNote")).deleted,true);
  assert.equal(f.context.dispatch(f.request("getCoachVoiceNotes")).notes.length,0);
  assert.throws(()=>f.context.dispatch(f.request("getCoachVoiceAudio")),/見つかりません/);
  assert.equal(f.context.dispatch(f.request("deleteCoachVoiceNote")).deleted,true);
});
test("一般の全データ取得には管理者限定の記録を含めない",()=>{
  const f=fixture();f.context.dispatch(f.request("saveCoachVoiceNote"));
  const result=f.context.dispatch({action:"getAll",userId:"MEMBER"});
  const json=JSON.stringify(result);assert.ok(!json.includes("周りを見る"));assert.ok(!json.includes("audioFileId"));assert.ok(!json.includes("coachAuthToken"));
});
console.log(count+" tests passed");
