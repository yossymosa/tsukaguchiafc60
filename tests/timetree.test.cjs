/* GAS の管理者専用 TimeTree 接続を、実アカウント・外部通信なしで検証する。 */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const crypto=require("node:crypto");
const source=fs.readFileSync(path.join(__dirname,"../gas-readwrite (5).js"),"utf8");
let count=0;
const test=(name,run)=>{run();count++;console.log("OK "+name);};
function fixture(){
  const users=[{id:"ADMIN",role:"admin",password:"app-password"},{id:"SUPER",role:"super_admin",password:"super-password"},{id:"MEMBER",role:"member",password:"member-password"}];
  const props=new Map([["COACH_VOICE_SESSION_SECRET","test-signing-key"]]),cacheItems=new Map();
  const metrics={now:Date.parse("2026-11-12T00:00:00Z"),calls:[],cacheAccess:0,signInCode:200,
    signInBody:{user:{id:7}},cookie:"_session_id=provider-secret-cookie; Path=/; HttpOnly",pages:[],
    calendars:[{id:1,name:"チーム",calendar_users:[{email:"hidden@example.test"}]},{id:2,name:"個人"},{id:3,name:"削除済み",deactivated_at:1}]};
  const cache={get:key=>{const item=cacheItems.get(key);return item&&item.expires>metrics.now?item.value:null;},
    put:(key,value,ttl)=>cacheItems.set(key,{value,expires:metrics.now+ttl*1000}),remove:key=>cacheItems.delete(key)};
  class Clock extends Date{static now(){return metrics.now;}}
  const context=vm.createContext({Date:Clock,console:{log(){throw new Error("No secret logging");},error(){throw new Error("No secret logging");}},
    Utilities:{Charset:{UTF_8:"UTF-8"},DigestAlgorithm:{SHA_256:"sha256"},getUuid:()=>crypto.randomUUID(),
      base64EncodeWebSafe:value=>Buffer.from(typeof value==="string"?value:value.map(v=>v&255)).toString("base64url"),
      base64DecodeWebSafe:value=>Array.from(Buffer.from(value,"base64url")),
      computeDigest:(_algorithm,value)=>Array.from(crypto.createHash("sha256").update(value).digest()),
      computeHmacSha256Signature:(value,key)=>Array.from(crypto.createHmac("sha256",key).update(value).digest()),
      newBlob:value=>({getDataAsString:()=>Buffer.from(value.map(v=>v&255)).toString("utf8")}),
      formatDate:(value,timeZone)=>{const parts=new Intl.DateTimeFormat("en-US",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(value);const field=name=>parts.find(p=>p.type===name).value;return field("year")+"-"+field("month")+"-"+field("day");}},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>props.get(key)||null,setProperty:(key,value)=>props.set(key,value)})},
    CacheService:{getScriptCache:()=>{metrics.cacheAccess++;return cache;}},
    UrlFetchApp:{fetch:(url,options)=>{
      metrics.calls.push({url,options});let code=200,data,headers={};
      if(url.endsWith("/auth/email/signin")){code=metrics.signInCode;data=metrics.signInBody;headers={"Set-Cookie":["other=value; Path=/",metrics.cookie]};}
      else if(url.endsWith("/calendars?since=0"))data={calendars:metrics.calendars};
      else {const page=metrics.pages.shift()||{events:[],chunk:false,since:1};code=page.httpCode||200;data=page;}
      return {getResponseCode:()=>code,getContentText:()=>JSON.stringify(data),getAllHeaders:()=>headers};
    }}
  });
  vm.runInContext(source,context);context.getUserById=id=>users.find(u=>u.id===id);
  const token=context.issueCoachVoiceSession(users[0]);
  const request=(action,extra={})=>({action,coachAuthToken:token,...extra});
  const connect=()=>context.dispatch(request("connectTimeTree",{email:"team@example.test",password:"provider-password"}));
  return {context,users,props,cacheItems,cache,metrics,token,request,connect};
}
const event=(id,extra={})=>({id,calendar_id:1,title:"練習",start_at:Date.parse("2026-11-14T09:00:00+09:00"),end_at:Date.parse("2026-11-14T11:00:00+09:00"),all_day:false,updated_at:1,...extra});

test("未認証・偽装 role・一般メンバーは全操作で外部通信前に拒否",()=>{
  for(const action of ["connectTimeTree","getTimeTreeCalendars","getTimeTreeEvents","disconnectTimeTree"]){
    for(const kind of ["missing","member","forged"]){
      const f=fixture();let token=kind==="member"?f.context.issueCoachVoiceSession(f.users[2]):"";
      if(kind==="forged")token=f.token.slice(0,-2)+"XX";
      assert.throws(()=>f.context.dispatch(f.request(action,{coachAuthToken:token,userId:"ADMIN",role:"admin"})),/COACH_AUTH_REQUIRED/);
      assert.equal(f.metrics.calls.length,0);assert.equal(f.metrics.cacheAccess,0);
    }
  }
});
test("接続情報の保存・応答からパスワードと生Cookieを分離",()=>{
  const f=fixture();const result=f.connect();assert.equal(result.connected,true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.calendars)),[{id:"1",name:"チーム"},{id:"2",name:"個人"}]);
  assert.ok(!JSON.stringify(result).includes("provider-secret"));assert.ok(!JSON.stringify(result).includes("hidden@example"));
  assert.ok(!JSON.stringify([...f.cacheItems.values()]).includes("provider-password"));assert.equal(f.props.size,1);
  const login=f.metrics.calls[0];assert.equal(login.url,"https://timetreeapp.com/api/v1/auth/email/signin");assert.equal(login.options.method,"put");
  assert.equal(JSON.parse(login.options.payload).password,"provider-password");
  assert.equal(f.metrics.calls[1].options.headers.Cookie,"_session_id=provider-secret-cookie");
});
test("別の管理者・新しい署名セッションでは接続を共有しない",()=>{
  const f=fixture();f.connect();const before=f.metrics.calls.length;
  for(const token of [f.context.issueCoachVoiceSession(f.users[1]),(()=>{f.metrics.now++;return f.context.issueCoachVoiceSession(f.users[0]);})()]){
    const result=f.context.dispatch(f.request("getTimeTreeCalendars",{coachAuthToken:token}));assert.equal(result.connected,false);
  }
  assert.equal(f.metrics.calls.length,before);
});
test("降格・署名失効・パスワード変更・退会後は接続中でも拒否",()=>{
  for(const change of [f=>f.users[0].role="member",f=>f.users[0].password="changed",f=>f.users.shift(),f=>f.metrics.now+=8*86400000]){
    const f=fixture();f.connect();const before=f.metrics.calls.length;change(f);
    assert.throws(()=>f.context.dispatch(f.request("getTimeTreeEvents",{calendarId:"1"})),/COACH_AUTH_REQUIRED/);assert.equal(f.metrics.calls.length,before);
  }
});
test("6時間の期限・接続解除・キャッシュの早期消失で再接続が必要",()=>{
  for(const expire of [f=>f.metrics.now+=21600001,f=>f.context.dispatch(f.request("disconnectTimeTree")),f=>f.cacheItems.clear()]){
    const f=fixture();f.connect();expire(f);const before=f.metrics.calls.length;
    assert.equal(f.context.dispatch(f.request("getTimeTreeCalendars")).connected,false);
    assert.throws(()=>f.context.dispatch(f.request("getTimeTreeEvents",{calendarId:"1"})),/TIMETREE_LOGIN_REQUIRED/);assert.equal(f.metrics.calls.length,before);
  }
});
test("カレンダーの権限とIDを確認し任意URL・未参加のIDは使わない",()=>{
  for(const id of ["99","1/../../user","https://example.test","1?since=0"]){
    const f=fixture();f.connect();const before=f.metrics.calls.length;
    assert.throws(()=>f.context.dispatch(f.request("getTimeTreeEvents",{calendarId:id})),/閲覧できません/);
    assert.equal(f.metrics.calls.length,before+1);assert.ok(f.metrics.calls.at(-1).url.endsWith("/calendars?since=0"));
  }
});
test("複数ページ・更新・削除・別カレンダー・不正日付を正しく処理",()=>{
  const f=fixture();f.connect();f.metrics.pages=[
    {events:[event("A"),event("B"),event("R",{recurrences:["RRULE:FREQ=WEEKLY"]})],chunk:true,since:100},
    {events:[event("A",{title:"変更後",updated_at:3}),event("A",{title:"古い版",updated_at:2}),event("B",{deactivated_at:4,updated_at:4}),event("X",{calendar_id:2}),event("BAD",{start_at:null})],chunk:false,since:200}
  ];
  const result=f.context.dispatch(f.request("getTimeTreeEvents",{calendarId:"1"}));
  assert.equal(result.events.length,2);assert.equal(result.events.find(e=>e.id==="A").title,"変更後");assert.equal(result.events.find(e=>e.id==="R").recurring,true);
  assert.equal(result.events[0].startDate,"2026-11-14");assert.ok(f.metrics.calls.at(-1).url.endsWith("?since=100"));
  assert.ok(f.metrics.calls.slice(1).every(c=>c.options.method==="get"));
});
test("途中取得・循環ページ・無効な応答を成功や空予定に見せない",()=>{
  for(const pages of [[{events:[],chunk:true,since:1},{events:[],chunk:true,since:1}],[{events:[],chunk:true,since:"https://example.test"}],[{unexpected:"response"}]]){
    const f=fixture();f.connect();f.metrics.pages=pages;assert.throws(()=>f.context.dispatch(f.request("getTimeTreeEvents",{calendarId:"1"})),/読み取れません/);
  }
});
test("プロバイダーの認証失効でCookieを破棄し秘密入りのエラー本文を返さない",()=>{
  const f=fixture();f.connect();f.metrics.pages=[{httpCode:400,error:{code:-493,message:"provider-secret-cookie"}}];
  assert.throws(()=>f.context.dispatch(f.request("getTimeTreeEvents",{calendarId:"1"})),err=>/TIMETREE_LOGIN_REQUIRED/.test(err.message)&&!err.message.includes("provider-secret"));
  assert.equal(f.context.dispatch(f.request("getTimeTreeCalendars")).connected,false);
});
test("ログイン失敗・アクセス集中の内容を安全に返す",()=>{
  for(const code of [400,401,403,429,500]){
    const f=fixture();f.metrics.signInCode=code;f.metrics.signInBody={error:{message:"provider-password provider-secret-cookie"}};
    assert.throws(()=>f.connect(),err=>!err.message.includes("provider-password")&&!err.message.includes("provider-secret"));
    assert.equal(f.context.dispatch(f.request("getTimeTreeCalendars")).connected,false);
  }
});
test("終日の日付・メモの長さ・本文の文字列を保持",()=>{
  const f=fixture();f.connect();f.metrics.pages=[{events:[event("D",{all_day:true,start_timezone:"America/Los_Angeles",end_timezone:"America/Los_Angeles",note:"<img src=x onerror=alert(1)>"+"あ".repeat(10010),attachment:{images:[{secret:"private-file"}]}})],chunk:false}];
  const data=f.context.dispatch(f.request("getTimeTreeEvents",{calendarId:"1"}));assert.equal(data.events[0].startDate,"2026-11-13");
  assert.equal(data.events[0].note.length,10000);assert.equal(data.events[0].noteTruncated,true);assert.ok(!JSON.stringify(data).includes("private-file"));
});
console.log(count+" TimeTree server tests passed");
