/* 管理者限定の指導録音。未保存の音声とAI結果はメモリー内だけで保持する。 */
(() => {
  "use strict";
  const {h} = window.preact;
  const {useState,useEffect,useRef} = window.preactHooks;
  const MAX_BYTES = 8 * 1024 * 1024;
  const MAX_SECONDS = 600;
  const labels = ["ハーフタイム","試合前","試合後","その他"];
  const box = {background:"#fff",border:"1px solid #D8E0E8",borderRadius:8,padding:14,marginBottom:12,fontSize:13};
  const button = {minHeight:44,padding:"10px 14px",border:"1px solid #1D4E89",borderRadius:6,background:"#fff",color:"#1D4E89",fontSize:13,fontWeight:800,cursor:"pointer"};
  const input = {width:"100%",boxSizing:"border-box",padding:10,border:"1px solid #CBD5E1",borderRadius:6,fontSize:14,lineHeight:1.7,fontFamily:"inherit",background:"#fff",color:"#102A43"};
  const time = seconds => Math.floor(seconds/60)+":"+String(Math.floor(seconds%60)).padStart(2,"0");
  const uid = () => window.crypto.randomUUID ? window.crypto.randomUUID() : Array.from(window.crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,"0")).join("");
  const blobBase64 = blob => new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("録音音声を読み込めませんでした"));
    reader.readAsDataURL(blob);
  });

  window.CoachVoiceNotes = function CoachVoiceNotes({match,user,api,leaveGuardRef,canWrite=true}) {
    const [token,setToken] = useState(()=>String(user?.coachAuthToken || ""));
    const [password,setPassword] = useState("");
    const [unlocking,setUnlocking] = useState(false);
    const [phase,setPhase] = useState("idle");
    const [label,setLabel] = useState("ハーフタイム");
    const [elapsed,setElapsed] = useState(0);
    const [draft,setDraft] = useState(null);
    const [notes,setNotes] = useState([]);
    const [loadingNotes,setLoadingNotes] = useState(false);
    const [noteBusy,setNoteBusy] = useState("");
    const [savedAudio,setSavedAudio] = useState(null);
    const [error,setError] = useState("");
    const [message,setMessage] = useState("");
    const [saveUncertain,setSaveUncertain] = useState(false);
    const runtime = useRef({alive:true,recorder:null,stream:null,timer:null,wake:null,urls:new Set(),startedAt:0,bytes:0,chunks:[],phase:"idle",draft:null,saveUncertain:false});
    const state = runtime.current;
    state.phase = phase;
    state.draft = draft;
    state.saveUncertain = saveUncertain;
    const changePhase = value => { state.phase=value; if(state.alive) setPhase(value); };
    const setCurrentDraft = value => { state.draft=value; if(state.alive) setDraft(value); };
    const urlFor = blob => { const url=URL.createObjectURL(blob); state.urls.add(url); return url; };
    const releaseUrl = url => { if(url){URL.revokeObjectURL(url);state.urls.delete(url);} };
    const stopTracks = () => {
      if(state.timer) clearInterval(state.timer);
      state.timer=null;
      state.stream?.getTracks().forEach(track=>{track.onended=null;track.stop();});
      state.stream=null;
      if(state.wake){state.wake.release().catch(()=>{});state.wake=null;}
    };
    const showError = err => {
      if(!state.alive) return;
      const text=String(err?.message || "処理に失敗しました。もう一度お試しください");
      if(text.includes("COACH_AUTH_REQUIRED")) setToken("");
      setError(/不明なアクション|Unknown action|未対応のaction/i.test(text)
        ? "指導録音のサーバー更新が必要です。管理者にお問い合わせください。" : text);
    };
    const call = (action,body={}) => api(action,{...body,resultId:String(match.id),coachAuthToken:token});
    const loadNotes = async () => {
      if(!token) return;
      setLoadingNotes(true);
      try {
        const result=await call("getCoachVoiceNotes");
        if(state.alive) setNotes(Array.isArray(result.notes)?result.notes:[]);
      } catch(err){showError(err);}
      finally{if(state.alive) setLoadingNotes(false);}
    };

    useEffect(()=>{
      state.alive=true;
      const beforeUnload = event => {
        if(state.draft || state.phase!=="idle") {event.preventDefault();event.returnValue="";}
      };
      const canLeave = () => {
        if(["starting","recording","stopping","analyzing","saving"].includes(state.phase)) {
          window.alert("指導録音の録音・処理中です。完了してから移動してください。");
          return false;
        }
        if(state.saveUncertain) {
          window.alert("指導記録の保存結果が未確認です。「保存を再確認」を押して確認してください。");
          return false;
        }
        return !state.draft || window.confirm("未保存の指導録音・文字起こし・要約を破棄して移動しますか？");
      };
      if(leaveGuardRef) leaveGuardRef.current=canLeave;
      window.addEventListener("beforeunload",beforeUnload);
      return ()=>{
        state.alive=false;
        if(state.recorder){state.recorder.onstop=null;state.recorder.ondataavailable=null;state.recorder.onerror=null;if(state.recorder.state!=="inactive")state.recorder.stop();}
        stopTracks();
        state.chunks=[];
        state.urls.forEach(url=>URL.revokeObjectURL(url));state.urls.clear();
        state.draft=null;
        window.removeEventListener("beforeunload",beforeUnload);
        if(leaveGuardRef) leaveGuardRef.current=()=>true;
      };
    },[]);
    useEffect(()=>{loadNotes();},[token]);

    const unlock = async event => {
      event.preventDefault();
      if(unlocking || !password) return;
      setUnlocking(true);setError("");
      try {
        const result=await api("login",{email:user.email,password});
        if(!state.alive)return;
        if(String(result.user?.id)!==String(user.id) || !["admin","super_admin"].includes(result.user?.role) || !result.user?.coachAuthToken) {
          throw new Error("指導録音のサーバー更新が必要です。管理者用の認証を確認してください。");
        }
        setPassword("");setToken(result.user.coachAuthToken);
      }catch(err){showError(err);setPassword("");}
      finally{if(state.alive)setUnlocking(false);}
    };
    const analyze = async (current=state.draft) => {
      if(!current || !token || !canWrite || state.phase==="saving")return;
      changePhase("analyzing");setError("");setMessage("");
      try {
        const audioBase64=await blobBase64(current.blob);
        if(!state.alive)return;
        const result=await call("analyzeCoachVoice",{audioBase64,mimeType:current.mimeType,durationSec:current.durationSec});
        if(!state.alive)return;
        setCurrentDraft({...current,transcript:String(result.transcript||""),summary:String(result.summary||"")});
        setMessage("文字起こしと要約を確認・修正し、保存するか選んでください。");
      }catch(err){showError(err);}
      finally{if(state.alive)changePhase("idle");}
    };
    const stopRecording = () => {
      if(state.recorder?.state!=="inactive" && state.recorder){
        changePhase("stopping");
        state.recorder.stop();
        stopTracks();
      }
    };
    const startRecording = async () => {
      if(!token || !canWrite || state.phase!=="idle" || state.draft)return;
      if(!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder==="undefined") {
        setError("このブラウザーでは録音できません。Safari または Chrome の最新版で開いてください。");return;
      }
      setError("");setMessage("");setElapsed(0);changePhase("starting");
      try {
        const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
        if(!state.alive){stream.getTracks().forEach(track=>track.stop());return;}
        state.stream=stream;
        const mimeType=["audio/webm;codecs=opus","audio/mp4","audio/ogg;codecs=opus"].find(type=>MediaRecorder.isTypeSupported(type));
        if(!mimeType)throw new Error("このブラウザーの録音形式には対応していません。Safari または Chrome で開いてください。");
        const recorder=new MediaRecorder(stream,{mimeType,audioBitsPerSecond:48000});
        state.recorder=recorder;state.chunks=[];state.bytes=0;state.startedAt=Date.now();
        recorder.ondataavailable = event => {
          if(event.data?.size){state.chunks.push(event.data);state.bytes+=event.data.size;}
          if(state.bytes>=MAX_BYTES-256*1024 && recorder.state==="recording")stopRecording();
        };
        recorder.onerror = ()=>{if(state.alive)setError("録音が中断されました。取得できた音声を確認してください。");stopRecording();};
        recorder.onstop = ()=>{
          stopTracks();
          if(!state.alive)return;
          const blob=new Blob(state.chunks,{type:recorder.mimeType || mimeType});state.chunks=[];state.recorder=null;
          const durationSec=Math.min(MAX_SECONDS,Math.max(0.1,(Date.now()-state.startedAt)/1000));
          if(!blob.size){changePhase("idle");setError("録音音声を取得できませんでした。もう一度録音してください。");return;}
          const current={id:uid(),blob,audioUrl:urlFor(blob),mimeType:blob.type.split(";")[0],durationSec,label,transcript:"",summary:""};
          setCurrentDraft(current);
          if(blob.size>MAX_BYTES){changePhase("idle");setError("音声が8MBを超えました。必要なら音声をダウンロードし、短めに録音し直してください。");return;}
          analyze(current);
        };
        stream.getAudioTracks().forEach(track=>{track.onended=stopRecording;});
        recorder.start(1000);changePhase("recording");
        state.timer=setInterval(()=>{
          const seconds=Math.floor((Date.now()-state.startedAt)/1000);
          if(state.alive)setElapsed(Math.min(MAX_SECONDS,seconds));
          if(seconds>=MAX_SECONDS)stopRecording();
        },250);
        if(navigator.wakeLock)navigator.wakeLock.request("screen").then(lock=>{
          if(state.alive && state.phase==="recording")state.wake=lock;else lock.release().catch(()=>{});
        }).catch(()=>{});
      }catch(err){
        stopTracks();changePhase("idle");
        showError(err?.name==="NotAllowedError"?new Error("マイクの使用が許可されていません。ブラウザーのマイク設定を確認してください。"):err);
      }
    };
    const discard = () => {
      if(!state.draft || state.phase!=="idle" || state.saveUncertain)return;
      if(!window.confirm("この未保存の録音・文字起こし・要約を破棄しますか？"))return;
      releaseUrl(state.draft.audioUrl);setCurrentDraft(null);setError("");setMessage("未保存の録音を破棄しました。");
    };
    const save = async () => {
      const current=state.draft;
      if(!current || !token || !canWrite || state.phase!=="idle" || !current.transcript.trim() || !current.summary.trim())return;
      changePhase("saving");setError("");setMessage("");
      let submitted=false;
      try {
        const audioBase64=await blobBase64(current.blob);
        if(!state.alive)return;
        submitted=true;
        const result=await call("saveCoachVoiceNote",{id:current.id,label:current.label,transcript:current.transcript,summary:current.summary,
          audioBase64,mimeType:current.mimeType,durationSec:current.durationSec});
        if(!result.note?.id)throw new Error("保存結果を確認できませんでした。同じボタンから再確認してください。");
        if(!state.alive)return;
        setNotes(previous=>[result.note,...previous.filter(note=>note.id!==result.note.id)]);
        releaseUrl(current.audioUrl);setCurrentDraft(null);setSaveUncertain(false);state.saveUncertain=false;
        setMessage("音声・文字起こし・要約を管理者限定で保存しました。");
      }catch(err){
        const text=String(err?.message||"");
        const uncertain=submitted&&(!/^\[saveCoachVoiceNote\]/.test(text)||/タイムアウト|レスポンス解析失敗/.test(text));
        if(state.alive){setSaveUncertain(uncertain);state.saveUncertain=uncertain;}
        showError(err);
      }finally{if(state.alive)changePhase("idle");}
    };
    const playSaved = async note => {
      if(noteBusy || !token)return;
      setNoteBusy(note.id);setError("");
      try {
        const result=await call("getCoachVoiceAudio",{id:note.id});
        if(!state.alive)return;
        const bytes=Uint8Array.from(atob(result.audioBase64),c=>c.charCodeAt(0));
        if(savedAudio)releaseUrl(savedAudio.url);
        setSavedAudio({id:note.id,url:urlFor(new Blob([bytes],{type:result.mimeType}))});
      }catch(err){showError(err);}
      finally{if(state.alive)setNoteBusy("");}
    };
    const remove = async note => {
      if(noteBusy || !token || !canWrite || !window.confirm("この指導記録を削除しますか？ 音声・文字起こし・要約は保存先のゴミ箱へ移動します。"))return;
      setNoteBusy(note.id);setError("");
      try {
        await call("deleteCoachVoiceNote",{id:note.id});
        if(!state.alive)return;
        setNotes(previous=>previous.filter(item=>item.id!==note.id));
        if(savedAudio?.id===note.id){releaseUrl(savedAudio.url);setSavedAudio(null);}
        setMessage("指導記録を削除しました。");
      }catch(err){showError(err);}
      finally{if(state.alive)setNoteBusy("");}
    };
    const busy=phase!=="idle";
    const editDraft=(field,value)=>setCurrentDraft({...state.draft,[field]:value});
    const action=(text,onClick,disabled=false,primary=false)=>h("button",{type:"button",onClick,disabled,style:{...button,...(primary?{background:"#1D4E89",color:"#fff"}:{}),opacity:disabled?0.55:1,cursor:disabled?"default":"pointer"}},text);
    return h("section",{style:box,"aria-label":"管理者限定の指導録音"},
      h("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:8}},
        h("strong",{style:{color:"#102A43",fontSize:15}},"🎙 指導の録音メモ"),
        h("span",{style:{fontSize:11,fontWeight:800,color:"#1D4E89",background:"#EDF3FA",padding:"4px 8px",borderRadius:4}},"管理者限定")),
      h("p",{style:{fontSize:12,color:"#64748B",lineHeight:1.7,margin:"0 0 12px"}},"ハーフタイムの指導などを録音し、文字起こしと要約を確認してから保存できます。一般メンバーには表示されません。"),
      error&&h("div",{role:"alert",style:{padding:10,marginBottom:10,borderRadius:6,background:"#FEF2F2",color:"#9B2929",lineHeight:1.7,overflowWrap:"anywhere"}},error),
      message&&h("div",{role:"status",style:{padding:10,marginBottom:10,borderRadius:6,background:"#F0F7F3",color:"#285F44",lineHeight:1.7}},message),
      !token&&h("form",{onSubmit:unlock,style:{padding:12,background:"#F8FAFC",borderRadius:6,marginBottom:12}},
        h("label",{},h("span",{style:{display:"block",fontWeight:800,marginBottom:6}},"管理者の本人確認"),
          h("span",{style:{display:"block",fontSize:12,color:"#64748B",marginBottom:8}},"指導記録を開くには、ログイン中のアカウントのパスワードを入力してください。"),
          h("input",{type:"password",value:password,onInput:event=>setPassword(event.target.value),autoComplete:"current-password",required:true,style:input})),
        h("button",{type:"submit",disabled:unlocking||!password,style:{...button,marginTop:8}},unlocking?"確認中…":"確認して開く")),
      token&&canWrite&&!draft&&h("div",{},
        h("label",{style:{display:"block",marginBottom:10}},h("span",{style:{display:"block",fontSize:12,fontWeight:800,marginBottom:6}},"録音する場面"),
          h("select",{value:label,onChange:event=>setLabel(event.target.value),disabled:busy,style:input},labels.map(value=>h("option",{key:value,value},value)))),
        phase==="recording"
          ?h("div",{},h("div",{role:"status",style:{color:"#A52A2A",fontSize:22,fontWeight:900,marginBottom:10}},"● 録音中 ",time(elapsed)),
            action("■ 停止して文字起こし・要約",stopRecording,false,true),
            h("p",{style:{fontSize:12,color:"#64748B",lineHeight:1.7}},"録音中はこの画面を開いたままにしてください。最長10分で自動停止します。"))
          :action(phase==="starting"?"マイクを準備中…":phase==="stopping"?"録音を停止中…":"🎙 録音を開始",startRecording,busy||loadingNotes,true),
        h("p",{style:{fontSize:11,color:"#64748B",lineHeight:1.7,marginBottom:0}},"停止後、音声をAIに送って文字起こし・要約します。「保存」を押すまでは、この画面を閉じると消えます。最長10分・8MB。")),
      draft&&h("div",{style:{border:"1px solid #B9CDE3",background:"#F8FAFC",borderRadius:6,padding:12,marginBottom:12}},
        h("div",{style:{display:"flex",justifyContent:"space-between",gap:8,fontWeight:800,marginBottom:10}},h("span",{},draft.label," / ",time(draft.durationSec)),h("span",{style:{color:"#946200"}},"未保存")),
        h("audio",{controls:true,preload:"metadata",src:draft.audioUrl,style:{width:"100%",marginBottom:8},"aria-label":"未保存の指導録音"}),
        phase==="analyzing"&&h("div",{role:"status",style:{color:"#1D4E89",fontWeight:800,padding:"10px 0"}},"音声を文字起こし・要約しています…"),
        h("label",{style:{display:"block",marginBottom:12}},h("span",{style:{display:"block",fontWeight:800,marginBottom:6}},"要約（編集できます）"),
          h("textarea",{value:draft.summary,onInput:event=>editDraft("summary",event.target.value),rows:6,maxLength:12000,disabled:busy||saveUncertain,style:input,placeholder:"文字起こしが終わると要約が表示されます"})),
        h("details",{open:!draft.summary},h("summary",{style:{fontWeight:800,cursor:"pointer",padding:"6px 0"}},"文字起こしを確認・編集"),
          h("textarea",{"aria-label":"指導録音の文字起こし",value:draft.transcript,onInput:event=>editDraft("transcript",event.target.value),rows:8,maxLength:40000,disabled:busy||saveUncertain,style:input})),
        saveUncertain&&h("p",{role:"status",style:{color:"#946200",lineHeight:1.7}},"保存結果が未確認です。「保存を再確認」で確認できます。同じ記録が二重に保存されることはありません。"),
        h("div",{style:{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}},
          action(phase==="saving"?"保存中…":saveUncertain?"保存を再確認":"音声・文字起こし・要約を保存",save,busy||!token||!canWrite||!draft.summary.trim()||!draft.transcript.trim(),true),
          action("保存せず破棄",discard,busy||saveUncertain),
          !draft.summary&&action("文字起こし・要約を再試行",()=>analyze(),busy||!token||!canWrite||draft.blob.size>MAX_BYTES)),
        h("a",{href:draft.audioUrl,download:"指導録音-"+draft.id+(draft.mimeType==="audio/webm"?".webm":draft.mimeType==="audio/ogg"?".ogg":".m4a"),style:{display:"inline-block",marginTop:12,fontSize:12,color:"#1D4E89"}},"録音音声を端末にダウンロード")),
      token&&h("div",{style:{borderTop:"1px solid #E2E8F0",marginTop:14,paddingTop:12}},
        h("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}},h("strong",{},"保存した指導記録"),
          action(loadingNotes?"読込中…":"更新",loadNotes,loadingNotes||busy)),
        !notes.length&&!loadingNotes&&h("p",{style:{color:"#64748B",fontSize:12}},"この試合の指導記録はまだありません。"),
        notes.map(note=>h("details",{key:note.id,style:{padding:"10px 0",borderBottom:"1px solid #E2E8F0"}},
          h("summary",{style:{cursor:"pointer",fontWeight:800,lineHeight:1.8}},note.label," / ",time(Number(note.durationSec)||0),"　",new Date(note.createdAt).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})),
          h("div",{style:{fontSize:11,color:"#64748B",margin:"6px 0"}},"記録者: ",note.createdByName||"管理者"),
          h("div",{style:{whiteSpace:"pre-wrap",lineHeight:1.8,marginBottom:10,overflowWrap:"anywhere"}},note.summary),
          h("details",{},h("summary",{style:{cursor:"pointer",fontSize:12,padding:"6px 0"}},"文字起こし全文"),h("div",{style:{whiteSpace:"pre-wrap",lineHeight:1.8,overflowWrap:"anywhere"}},note.transcript)),
          savedAudio?.id===note.id?h("audio",{controls:true,src:savedAudio.url,preload:"metadata",style:{width:"100%",marginTop:10},"aria-label":note.label+"の保存済み録音"})
            :action(noteBusy===note.id?"処理中…":"保存した音声を読み込む",()=>playSaved(note),!!noteBusy),
          canWrite&&h("div",{style:{marginTop:10}},action("この指導記録を削除",()=>remove(note),!!noteBusy||busy)))))
    );
  };
})();
