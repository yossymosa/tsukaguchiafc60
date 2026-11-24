const assert=require("node:assert/strict"), fs=require("node:fs"), path=require("node:path"), vm=require("node:vm");
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const start=html.indexOf("function ScheduleYoutubeVideoPanel(");
const source=html.slice(start,html.indexOf("\nfunction DayPage(",start));
function fixture({linkFails=false,linkedVideo="",onRefresh}={}) {
  const hooks=[],effects=[],calls=[];let cursor=0,tree;
  const useState=init=>{const i=cursor++;if(!(i in hooks))hooks[i]=typeof init==="function"?init():init;return [hooks[i],v=>{hooks[i]=typeof v==="function"?v(hooks[i]):v;}];};
  const useRef=init=>{const i=cursor++;if(!(i in hooks))hooks[i]={current:init};return hooks[i];};
  const useEffect=(fn,deps)=>{const i=cursor++;if(!hooks[i]||deps.some((v,j)=>v!==hooks[i][j])){hooks[i]=deps;effects.push(fn);}};
  const h=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(v=>v!==false&&v!=null)});
  const c=vm.createContext({h,useState,useRef,useEffect,Fragment:"fragment",window:{},URLSearchParams,Date,console,css:{inp:{},bW:{},bS:{},bG:{}},
    YOUTUBE_TARGET_CHANNEL_HANDLE:"@test",YOUTUBE_TARGET_PLAYLIST_TITLE:"test",
    getHalfOptionsByFormatLabel:()=>["1st","2nd"],getYouTubeVideoIdFromUrl:url=>(String(url).match(/v=([\w-]{11})/)||[])[1]||"",
    makeYtTitle:(row,_schedule,half)=>row.id+" "+half,makeLegacyYtTitle:()=>"legacy",makeYtDesc:()=>"score and saves",makeYtPkDesc:()=>"PK",
    requestYouTubeAccessToken:async()=>{calls.push({action:"auth"});return {accessToken:"token",expiresAt:Date.now()+3600000};},
    getYouTubeChannelForUpload:async()=>({id:"channel",title:"team",uploadsPlaylistId:"uploads"}),
    getOrCreateTargetYouTubePlaylist:async()=>{calls.push({action:"playlist"});return {id:"playlist"};},
    youtubeApiJson:async url=>{calls.push({action:"list",url});const page=new URLSearchParams(url.split("?")[1]).get("pageToken");return page?{items:[{contentDetails:{videoId:"BBBBBBBBBBB"},snippet:{title:"Second"}}]}:{items:[{contentDetails:{videoId:"AAAAAAAAAAA",videoPublishedAt:"2026-11-24"},snippet:{title:"Live recording"}}],nextPageToken:"next"};},
    updateYouTubeVideoTextOnly:async args=>{calls.push({action:"update",args});},
    api:async(action,body)=>{calls.push({action,body});if(linkFails)throw Error("save failed");return {ok:true};},
    confirm:()=>true,alert:message=>{throw Error(message);},setTimeout:()=>1,clearTimeout:()=>{}});
  vm.runInContext(source,c);
  const results=[{id:"MATCH1",opponent:"相手",youtubeUrl1st:linkedVideo},{id:"MATCH2",opponent:"相手B"}];
  const render=()=>{cursor=0;tree=c.ScheduleYoutubeVideoPanel({schedule:{id:"DAY1"},results,user:{id:"ADMIN"},isAdmin:true,onUpdated:onRefresh||(()=>calls.push({action:"refresh"}))});while(effects.length)effects.shift()();return tree;};
  const nodes=(node=tree)=>node&&typeof node==="object"?[node,...node.children.flatMap(nodes)]:[];
  const text=(node=tree)=>node&&typeof node==="object"?node.children.map(text).join(""):String(node??"");
  const button=label=>nodes().find(n=>n.type==="button"&&text(n)===label);
  const click=async label=>{const b=button(label);assert(b,`missing ${label}`);await b.props.onClick();render();};
  const choose=(i,value)=>{const el=nodes().filter(n=>n.type==="select")[i];assert(el);el.props.onChange({currentTarget:{value}});render();};
  render();return {render,nodes,text,button,click,choose,calls};
}
(async()=>{
  let f=fixture();
  assert(f.button("動画をアップロード")); assert(f.button("アップ済み動画を編集"));
  assert(!f.button("YouTubeの動画を読み込む")); assert(!f.text().includes("ファイルから選ぶ"));
  await f.click("アップ済み動画を編集"); assert(f.button("YouTubeの動画を読み込む")); assert(!f.text().includes("ファイルから選ぶ"));
  await f.click("YouTubeの動画を読み込む"); assert(f.text().includes("Live recording"));
  assert(!f.calls.some(x=>x.action==="playlist")); assert(!f.calls.some(x=>x.action==="update"));
  await f.click("さらに動画を読み込む"); assert(f.text().includes("Second"));
  f.choose(0,"AAAAAAAAAAA"); f.choose(1,"MATCH1:second");
  assert(f.text().includes("MATCH1 2nd")); assert(f.text().includes("score and saves"));
  assert(!f.calls.some(x=>x.action==="update"));
  await f.click("タイトル・概要欄を更新してリンク");
  const update=f.calls.find(x=>x.action==="update"); assert.equal(update.args.title,"MATCH1 2nd"); assert.equal(update.args.videoUrl,"https://www.youtube.com/watch?v=AAAAAAAAAAA");
  const save=f.calls.find(x=>x.action==="saveYoutubeUploadLink"); assert.equal(save.body.part,"second");assert.equal(save.body.resultId,"MATCH1");
  assert(f.text().includes("試合にリンクしました")); assert(f.calls.some(x=>x.action==="refresh"));
  f=fixture({linkFails:true}); await f.click("アップ済み動画を編集");await f.click("YouTubeの動画を読み込む");f.choose(0,"AAAAAAAAAAA");f.choose(1,"MATCH1:full");await f.click("タイトル・概要欄を更新してリンク");
  assert(f.text().includes("動画情報は更新されましたが、試合へのリンクを保存できませんでした"));
  f=fixture({linkedVideo:"https://www.youtube.com/watch?v=AAAAAAAAAAA"});await f.click("アップ済み動画を編集");await f.click("YouTubeの動画を読み込む");f.choose(0,"AAAAAAAAAAA");f.choose(1,"MATCH2:second");await f.click("タイトル・概要欄を更新してリンク");
  assert(f.text().includes("既に"));assert(!f.calls.some(x=>x.action==="update"));
  const helperStart=html.indexOf("const updateYouTubeVideoTextOnly =");
  const helper=html.slice(helperStart,html.indexOf("function readFileAsDataUrl(",helperStart));
  const requests=[];
  const hc=vm.createContext({TextEncoder,encodeURIComponent,getYouTubeVideoIdFromUrl:()=>"AAAAAAAAAAA",youtubeApiJson:async(url,_token,options)=>{
    requests.push({url,options});return options?{}:{items:[{snippet:{categoryId:"17",tags:["tag"],defaultLanguage:"ja",defaultAudioLanguage:"ja"}}]};}});
  vm.runInContext(helper+"\nthis.update = updateYouTubeVideoTextOnly;",hc);
  await hc.update({accessToken:"token",videoUrl:"test",title:"title",description:"概要"});
  const body=JSON.parse(requests[1].options.body); assert.equal(body.snippet.defaultAudioLanguage,"ja");assert.deepEqual(body.snippet.tags,["tag"]);assert.equal(body.snippet.description,"概要");assert(!("status" in body));
  await assert.rejects(()=>hc.update({videoUrl:"test",title:"title",description:"あ".repeat(1700)}),/5000/);
  console.log("Existing YouTube videos: mode selection, pagination, preview, update, link failure and duplicate protection passed");
})().catch(e=>{console.error(e);process.exitCode=1;});
