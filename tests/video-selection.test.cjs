const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const start=html.indexOf("function ScheduleYoutubeVideoPanel(");
const source=html.slice(start,html.indexOf("\nfunction DayPage(",start));

function harness({picker,existing=false}={}){
  const hooks=[],effects=[],cleanups=[],calls=[],timers=[];let cursor=0,tree;
  const useState=init=>{const i=cursor++;if(!(i in hooks))hooks[i]=typeof init==="function"?init():init;return [hooks[i],value=>{hooks[i]=typeof value==="function"?value(hooks[i]):value;}];};
  const useRef=init=>{const i=cursor++;if(!(i in hooks))hooks[i]={current:init};return hooks[i];};
  const useEffect=(fn,deps)=>{const i=cursor++;if(!hooks[i]||deps.some((v,j)=>v!==hooks[i][j])){hooks[i]=deps;effects.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}};
  const h=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(v=>v!==false&&v!=null)});
  const context=vm.createContext({h,useState,useRef,useEffect,Fragment:"fragment",window:picker?{showOpenFilePicker:picker}:{},console,
    css:{bW:{},bS:{},bG:{}},YOUTUBE_TARGET_CHANNEL_HANDLE:"@test",YOUTUBE_TARGET_PLAYLIST_TITLE:"test",
    getHalfOptionsByFormatLabel:()=>["1st","2nd"],getYouTubeVideoIdFromUrl:()=>"",normalizeYoutubeLink:s=>s,
    makeYtTitle:(row,_schedule,half)=>row.id+half,makeLegacyYtTitle:(row,_schedule,half)=>row.id+half,
    makeYtDesc:()=>"test description",makeYtPkDesc:()=>"test description",
    setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},clearTimeout:()=>{},alert:message=>{throw new Error(message);},
    requestYouTubeAccessToken:async()=>{calls.push({action:"connect"});return {accessToken:"test-token",expiresAt:Date.now()+3600000};},
    getYouTubeChannelForUpload:async()=>({title:"test",uploadsPlaylistId:"test-uploads"}),
    getOrCreateTargetYouTubePlaylist:async()=>({id:"test-playlist",title:"test"}),
    findYouTubeUploadsByTitles:async({titles})=>existing?{[titles[0]]:[{videoId:"existing",videoUrl:"https://example.test/existing"}]}:{},
    ensureVideoInYouTubePlaylist:async()=>({added:false}),
    uploadFileToYouTube:async({file})=>{calls.push({action:"upload",file});return {id:"test-video",status:{privacyStatus:"unlisted"}};},
    api:async(action,body)=>{calls.push({action,body});return {ok:true};}
  });
  vm.runInContext(source,context);
  function render(){cursor=0;tree=context.ScheduleYoutubeVideoPanel({schedule:{id:"DAY1",date:"2026-11-08"},results:[{id:"MATCH1",opponent:"相手A"},{id:"MATCH2",opponent:"相手B"}],user:{id:"ADMIN"},isAdmin:true});while(effects.length)effects.shift()();return tree;}
  function nodes(node=tree){return node&&typeof node==="object"?[node,...node.children.flatMap(child=>nodes(child))]:[];}
  function text(node=tree){return node&&typeof node==="object"?node.children.map(text).join(""):String(node??"");}
  const buttons=()=>nodes().filter(n=>n.type==="button");
  const upload=()=>buttons().find(n=>/本をアップロード$/.test(text(n)));
  function choose(file,index=0){const input=nodes().filter(n=>n.type==="input"&&n.props.accept==="application/octet-stream")[index];assert.ok(input);const target={files:file?[file]:[]};Object.defineProperty(target,"value",{set(){target.files=[];}});input.props.onInput({currentTarget:target});input.props.onChange({currentTarget:target});render();}
  async function settle(){for(let i=0;i<20;i++)await Promise.resolve();render();}
  render();return {render,nodes,text,buttons,upload,choose,settle,calls,timers,unmount:()=>cleanups.forEach(fn=>fn?.())};
}
function unreadVideo(name="大きい試合動画.MOV"){
  const file={name,type:"video/quicktime"};
  for(const field of ["size","arrayBuffer","text","stream","slice"]){Object.defineProperty(file,field,{get(){throw new Error("選択中に動画を読み込んだ: "+field);}});}
  return file;
}

module.exports=(async()=>{
  let count=0;async function test(name,run){await run();count++;console.log("OK "+name);}
  await test("動画選択は名前だけを即表示し、動画本体・サイズ・通信に触れない",async()=>{
    const f=harness();assert.equal(f.upload().props.disabled,true);f.choose(unreadVideo());await f.settle();
    assert.ok(f.text().includes("大きい試合動画.MOV"));assert.equal(f.upload().props.disabled,false);assert.equal(f.calls.length,0);assert.equal(f.timers.length,0);f.unmount();
  });
  await test("複数の枠の選択を保持し、input/changeの二重通知も同じ枠に反映",async()=>{
    const f=harness();f.choose(unreadVideo("前半.MOV"),0);f.choose(unreadVideo("次の試合.MP4"),2);
    assert.ok(f.text().includes("前半.MOV"));assert.ok(f.text().includes("次の試合.MP4"));assert.ok(f.text(f.upload()).includes("2 本"));assert.equal(f.timers.length,0);f.unmount();
  });
  await test("キャンセルと不正なファイルでは前の選択を消さない",async()=>{
    const f=harness();f.choose(unreadVideo());f.choose(null);assert.ok(f.text().includes("大きい試合動画.MOV"));
    f.choose({name:"メモ.pdf",type:"application/pdf"});assert.ok(f.text().includes("動画ファイル（MOV・MP4など）を選んでください"));assert.ok(f.text().includes("大きい試合動画.MOV"));f.unmount();
  });
  await test("ファイルハンドルは名前だけ表示し、アップロードを押してからgetFileする",async()=>{
    let opened=0;const file=unreadVideo();const f=harness({picker:async()=>[{name:file.name,getFile:async()=>{opened++;return file;}}]});
    await f.buttons().find(n=>f.text(n)==="ファイルから選ぶ").props.onClick();f.render();assert.equal(opened,0);assert.equal(f.calls.length,0);assert.ok(f.text().includes(file.name));
    await f.upload().props.onClick();await f.settle();assert.equal(opened,1);assert.equal(f.calls.filter(c=>c.action==="upload").length,1);assert.equal(f.calls.find(c=>c.action==="upload").file,file);f.unmount();
  });
  await test("YouTubeに同じ動画があればファイルを開かず既存リンクを使う",async()=>{
    const f=harness({existing:true,picker:async()=>[{name:"試合.MOV",getFile:async()=>{throw new Error("既存動画の再送信は不要");}}]});
    await f.buttons().find(n=>f.text(n)==="ファイルから選ぶ").props.onClick();f.render();await f.upload().props.onClick();await f.settle();
    assert.equal(f.calls.filter(c=>c.action==="upload").length,0);assert.ok(f.calls.some(c=>c.action==="saveYoutubeUploadLink"));f.unmount();
  });
  await test("ファイル選択APIが利用できなければ通常のファイル選択へ復帰",async()=>{
    const f=harness({picker:async()=>{const e=new Error("blocked");e.name="SecurityError";throw e;}});
    await f.buttons().find(n=>f.text(n)==="ファイルから選ぶ").props.onClick();f.render();f.choose(unreadVideo());assert.equal(f.upload().props.disabled,false);f.unmount();
  });
  await test("画面を閉じた後に戻るファイル選択は反映しない",async()=>{
    let resolve;const f=harness({picker:()=>new Promise(r=>{resolve=r;})});
    const pending=f.buttons().find(n=>f.text(n)==="ファイルから選ぶ").props.onClick();f.unmount();resolve([{name:"試合.MOV"}]);await pending;f.render();assert.ok(!f.text().includes("試合.MOV"));
  });
  console.log(count+" video selection tests passed");
})();
