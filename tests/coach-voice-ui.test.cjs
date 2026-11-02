/* ブラウザー・マイクを置換し、録音から保存までの操作と破棄を検証する。 */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const crypto=require("node:crypto");
const source=fs.readFileSync(path.join(__dirname,"../coach-voice.js"),"utf8");
function harness({denyMic=false,token="signed-token",failSave=false,failAnalyze=false,mimeType="audio/webm"}={}){
  const hooks=[],pending=[],cleanups=[],calls=[],urls=new Set();let cursor=0,clock=1000,tree;
  const tracks=[{stopped:false,stop(){this.stopped=true;}}];const guard={current:()=>true};
  const useState=init=>{const i=cursor++;if(!(i in hooks))hooks[i]=typeof init==="function"?init():init;return [hooks[i],value=>{hooks[i]=typeof value==="function"?value(hooks[i]):value;}];};
  const useRef=init=>{const i=cursor++;if(!(i in hooks))hooks[i]={current:init};return hooks[i];};
  const useEffect=(fn,deps)=>{const i=cursor++;const previous=hooks[i];if(!previous||deps.some((v,j)=>v!==previous[j])){hooks[i]=deps;pending.push(()=>{if(cleanups[i])cleanups[i]();cleanups[i]=fn();});}};
  const h=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(v=>v!==false&&v!==null&&v!==undefined)});
  const listeners=new Map();
  const window={preact:{h},preactHooks:{useState,useRef,useEffect},crypto:crypto.webcrypto,
    confirm:()=>true,alert:()=>{},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),
    localStorage:{setItem(){throw new Error("音声を自動保存してはいけません");}},sessionStorage:{setItem(){throw new Error("音声を自動保存してはいけません");}}};
  const raw=Buffer.alloc(64);if(mimeType==="audio/mp4")raw.write("ftyp",4);else Buffer.from([0x1a,0x45,0xdf,0xa3]).copy(raw);const audio=new Blob([raw],{type:mimeType});
  const stored=[];
  class Recorder{
    static isTypeSupported(type){return type.startsWith(mimeType);}
    constructor(_stream,options){this.mimeType=options.mimeType;this.state="inactive";}
    start(){this.state="recording";}
    stop(){this.state="inactive";Promise.resolve().then(()=>{if(this.ondataavailable)this.ondataavailable({data:tracks.some(t=>t.stopped)?new Blob([]):audio});if(this.onstop)this.onstop();});}
  }
  class Reader{readAsDataURL(blob){blob.arrayBuffer().then(bytes=>{this.result="data:"+blob.type+";base64,"+Buffer.from(bytes).toString("base64");this.onload();});}}
  const api=async(action,body)=>{
    calls.push({action,body});
    if(action==="getCoachVoiceNotes")return {notes:[...stored]};
    if(action==="login")return {user:{id:"ADMIN",role:"admin",coachAuthToken:"renewed-token"}};
    if(action==="analyzeCoachVoice"){if(failAnalyze)throw new Error("文字起こしサービスに接続できませんでした");return {transcript:"後半は周りを見よう。",summary:"・周りを見る。"};}
    if(action==="saveCoachVoiceNote"){
      if(failSave)throw new Error("timeout");
      const note={...body,createdAt:new Date().toISOString(),createdByName:"管理者"};stored.push(note);return {note};
    }
    if(action==="updateCoachVoiceNote"){const note={...stored.find(n=>n.id===body.id),...body,updatedAt:new Date().toISOString()};stored.splice(0,stored.length,note);return {note};}
    if(action==="getCoachVoiceAudio")return {audioBase64:raw.toString("base64"),mimeType};
    return {deleted:true};
  };
  class Clock extends Date{static now(){return clock;}}
  vm.runInNewContext(source,{window,navigator:{mediaDevices:{getUserMedia:async()=>{if(denyMic){const e=new Error("denied");e.name="NotAllowedError";throw e;}return {getTracks:()=>tracks,getAudioTracks:()=>tracks};}}},
    MediaRecorder:Recorder,Blob,FileReader:Reader,Uint8Array,Date:Clock,
    URL:{createObjectURL:()=>{const id="blob:"+crypto.randomUUID();urls.add(id);return id;},revokeObjectURL:url=>urls.delete(url)},
    setInterval:()=>1,clearInterval:()=>{},atob:data=>Buffer.from(data,"base64").toString("binary")});
  function render(){cursor=0;tree=window.CoachVoiceNotes({match:{id:"MATCH1"},user:{id:"ADMIN",email:"admin@example.test",coachAuthToken:token},api,leaveGuardRef:guard});while(pending.length)pending.shift()();return tree;}
  function nodes(node=tree){return node&&typeof node==="object"?[node,...node.children.flatMap(child=>nodes(child))]:[];}
  function text(node=tree){return node&&typeof node==="object"?node.children.map(text).join(""):String(node??"");}
  function button(label){const node=nodes().find(n=>n.type==="button"&&text(n)===label);assert.ok(node,"button not found: "+label);return node;}
  async function settle(){for(let i=0;i<15;i++){await Promise.resolve();}render();}
  function unmount(){for(const cleanup of cleanups)if(typeof cleanup==="function")cleanup();}
  render();
  return {render,settle,unmount,nodes,text,button,calls,tracks,guard,urls,listeners,advance:()=>{clock+=30000;},setFailSave:value=>{failSave=value;},setFailAnalyze:value=>{failAnalyze=value;}};
}
async function record(f){await f.settle();await f.button("🎙 録音を開始").props.onClick();await f.settle();f.advance();f.button("■ 停止して文字起こし・要約").props.onClick();await f.settle();}
module.exports=(async()=>{
  let count=0;
  async function test(name,run){await run();count++;console.log("OK "+name);}
  await test("録音停止でAI解析し、保存を選ぶまでは保存APIを呼ばない",async()=>{
    const f=harness();await record(f);assert.ok(f.text().includes("未保存"));
    assert.equal(f.calls.filter(c=>c.action==="analyzeCoachVoice").length,1);
    assert.equal(f.calls.filter(c=>c.action==="saveCoachVoiceNote").length,0);
    assert.equal(f.nodes().find(n=>n.type==="textarea"&&n.props.value==="・周りを見る。").props.value,"・周りを見る。");
    assert.ok(f.tracks.every(t=>t.stopped));f.unmount();assert.equal(f.urls.size,0);
  });
  await test("修正した要約と元音声を明示的な保存ボタンから一緒に保存",async()=>{
    const f=harness();await record(f);
    f.nodes().find(n=>n.type==="textarea"&&n.props.value==="・周りを見る。").props.onInput({target:{value:"修正した指導ポイント"}});f.render();
    await f.button("音声・文字起こし・要約を保存").props.onClick();await f.settle();
    const saved=f.calls.find(c=>c.action==="saveCoachVoiceNote");assert.equal(saved.body.summary,"修正した指導ポイント");assert.ok(saved.body.audioBase64);assert.equal(saved.body.coachAuthToken,"signed-token");
    assert.ok(!f.text().includes("未保存"));assert.ok(f.text().includes("管理者限定で保存しました"));assert.equal(f.urls.size,0);f.unmount();
  });
  await test("破棄した録音は保存されず、メモリーの音声URLを解放",async()=>{
    const f=harness();await record(f);f.button("保存せず破棄").props.onClick();await f.settle();
    assert.equal(f.urls.size,0);assert.equal(f.calls.filter(c=>c.action==="saveCoachVoiceNote").length,0);assert.ok(f.button("🎙 録音を開始"));f.unmount();
  });
  await test("録音中の移動を止め、画面終了時にマイクを解放",async()=>{
    const f=harness();await f.settle();await f.button("🎙 録音を開始").props.onClick();await f.settle();assert.equal(f.guard.current(),false);
    f.unmount();await f.settle();assert.ok(f.tracks.every(t=>t.stopped));assert.equal(f.calls.filter(c=>c.action==="analyzeCoachVoice").length,0);
  });
  await test("マイク拒否から復帰し、録音も解析も保存も行わない",async()=>{
    const f=harness({denyMic:true});await f.settle();await f.button("🎙 録音を開始").props.onClick();await f.settle();
    assert.ok(f.text().includes("マイクの使用が許可されていません"));assert.equal(f.button("🎙 録音を開始").props.disabled,false);assert.equal(f.calls.filter(c=>c.action==="analyzeCoachVoice").length,0);f.unmount();
  });
  await test("既存ログインに署名がなければ本人確認してから取得",async()=>{
    const f=harness({token:""});await f.settle();assert.equal(f.calls.length,0);
    f.nodes().find(n=>n.type==="input"&&n.props.type==="password").props.onInput({target:{value:"password"}});f.render();
    await f.nodes().find(n=>n.type==="form").props.onSubmit({preventDefault(){}});await f.settle();
    const read=f.calls.find(c=>c.action==="getCoachVoiceNotes");assert.equal(read.body.coachAuthToken,"renewed-token");f.unmount();
  });
  await test("保存応答の失敗時も録音を保持し、同じIDで再試行",async()=>{
    const f=harness({failSave:true});await record(f);await f.button("音声・文字起こし・要約を保存").props.onClick();await f.settle();
    assert.ok(f.text().includes("未保存"));assert.equal(f.button("保存せず破棄").props.disabled,true);assert.equal(f.guard.current(),false);
    f.setFailSave(false);await f.button("保存を再確認").props.onClick();await f.settle();
    const saves=f.calls.filter(c=>c.action==="saveCoachVoiceNote");assert.equal(saves[0].body.id,saves[1].body.id);assert.equal(f.guard.current(),true);f.unmount();
  });
  await test("iPhoneのMP4で最後の音声を受け取ってからマイクを止めて保存",async()=>{
    const f=harness({mimeType:"audio/mp4"});await record(f);
    assert.equal(f.calls.find(c=>c.action==="analyzeCoachVoice").body.mimeType,"audio/mp4");
    assert.ok(f.tracks.every(t=>t.stopped));
    await f.button("音声・文字起こし・要約を保存").props.onClick();await f.settle();
    assert.equal(f.calls.find(c=>c.action==="saveCoachVoiceNote").body.mimeType,"audio/mp4");f.unmount();
  });
  await test("AIの失敗後も録音を保存でき、保存した音声で文字起こしを再試行",async()=>{
    const f=harness({failAnalyze:true});await record(f);
    assert.equal(f.button("録音音声を保存").props.disabled,false);
    await f.button("録音音声を保存").props.onClick();await f.settle();
    const saved=f.calls.find(c=>c.action==="saveCoachVoiceNote");assert.equal(saved.body.transcript,"");assert.ok(saved.body.audioBase64);
    f.setFailAnalyze(false);await f.button("文字起こし・要約を作成").props.onClick();await f.settle();
    assert.equal(f.calls.filter(c=>c.action==="updateCoachVoiceNote").length,0);
    await f.button("文字起こし・要約を保存").props.onClick();await f.settle();
    const update=f.calls.find(c=>c.action==="updateCoachVoiceNote");assert.equal(update.body.id,saved.body.id);assert.ok(update.body.transcript);assert.equal(update.body.audioBase64,undefined);
    assert.equal(f.calls.filter(c=>c.action==="saveCoachVoiceNote").length,1);f.unmount();
  });
  console.log(count+" UI flow tests passed");
})();
