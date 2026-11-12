/* 管理者専用の TimeTree 閲覧試作。外部予定と認証情報を端末の永続ストレージに保存しない。 */
(() => {
  "use strict";
  const {h} = window.preact;
  const {useState,useEffect,useRef} = window.preactHooks;
  const admin = user => ["admin","super_admin"].includes(String(user?.role || ""));
  const day = value => new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));
  const clock = value => new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value));
  const button = (text,props={}) => h("button",{type:"button",...props},text);

  function AdminTimeTreePanel({user,api}) {
    const [token,setToken] = useState(()=>String(user.coachAuthToken || ""));
    const [adminPassword,setAdminPassword] = useState("");
    const [email,setEmail] = useState("");
    const [password,setPassword] = useState("");
    const [connected,setConnected] = useState(false);
    const [calendars,setCalendars] = useState([]);
    const [selected,setSelected] = useState("");
    const [loadedId,setLoadedId] = useState("");
    const [events,setEvents] = useState([]);
    const [fetchedAt,setFetchedAt] = useState("");
    const [period,setPeriod] = useState("upcoming");
    const [search,setSearch] = useState("");
    const [limit,setLimit] = useState(60);
    const [busy,setBusy] = useState("");
    const [error,setError] = useState("");
    const [message,setMessage] = useState("");
    const runtime = useRef({alive:true,version:0,busy:false});
    const state = runtime.current;
    function clearView(){setEvents([]);setLoadedId("");setFetchedAt("");setLimit(60);}
    function clearConnection(){setConnected(false);setCalendars([]);setSelected("");clearView();}
    function showError(err){
      const text = String(err?.message || "TimeTreeの処理に失敗しました");
      if(text.includes("COACH_AUTH_REQUIRED")){clearConnection();setToken("");}
      if(text.includes("TIMETREE_LOGIN_REQUIRED")) clearConnection();
      setError(/不明なアクション|Unknown action|未対応のaction/i.test(text)
        ? "TimeTree連携のサーバー更新が必要です。Google Apps Scriptを最新版に更新・再デプロイしてください。"
        : text.replace(/^(COACH_AUTH_REQUIRED|TIMETREE_LOGIN_REQUIRED):\s*/,""));
    }
    async function run(label,work){
      if(state.busy) return;
      state.busy=true;
      const version=++state.version;
      const current=()=>state.alive && state.version===version;
      setBusy(label);setError("");setMessage("");
      try {await work(current);}
      catch(err){if(current())showError(err);}
      finally{if(current()){state.busy=false;setBusy("");}}
    }
    const call=(action,body={})=>api(action,{...body,coachAuthToken:token});
    useEffect(()=>{
      state.alive=true;
      return ()=>{state.alive=false;state.version++;state.busy=false;};
    },[]);
    useEffect(()=>{
      if(!token) return;
      run("接続を確認中",async current=>{
        const result=await api("getTimeTreeCalendars",{coachAuthToken:token});
        if(!current())return;
        setConnected(result.connected===true);
        setCalendars(Array.isArray(result.calendars)?result.calendars:[]);
      });
    },[token]);

    const unlock=event=>{
      event.preventDefault();
      if(!adminPassword||state.busy)return;
      const value=adminPassword;setAdminPassword("");
      return run("本人確認中",async current=>{
        const result=await api("login",{email:user.email,password:value});
        if(!current())return;
        if(String(result.user?.id)!==String(user.id)||!admin(result.user)||!result.user?.coachAuthToken){
          throw new Error("管理者の認証を確認できませんでした。アプリのサーバー更新が必要です。");
        }
        setToken(result.user.coachAuthToken);
      });
    };
    const connect=event=>{
      event.preventDefault();
      if(!email.trim()||!password||state.busy)return;
      const credentials={email:email.trim(),password};setPassword("");clearConnection();
      return run("TimeTreeに接続中",async current=>{
        const result=await call("connectTimeTree",credentials);
        if(!current())return;
        if(!result.connected)throw new Error("TimeTreeに接続できませんでした");
        setConnected(true);setCalendars(Array.isArray(result.calendars)?result.calendars:[]);setEmail("");
        setMessage("接続しました。表示したいチームのカレンダーを選んでください。");
      });
    };
    const loadEvents=()=>{
      if(!selected||state.busy)return;
      const calendarId=selected;
      // 更新に失敗したとき、前回の予定を最新のものと誤認させない。
      clearView();
      return run("予定を読み込み中",async current=>{
        const result=await call("getTimeTreeEvents",{calendarId});
        if(!current())return;
        setEvents(Array.isArray(result.events)?result.events:[]);
        setLoadedId(calendarId);setFetchedAt(String(result.fetchedAt||""));
      });
    };
    const disconnect=()=>run("接続を解除中",async current=>{
      await call("disconnectTimeTree");
      if(!current())return;
      clearConnection();setPassword("");setMessage("このアプリのTimeTree接続を解除しました。");
    });
    const query=search.trim().toLocaleLowerCase("ja-JP");
    const matches=event=>!query||[event.title,event.location,event.note].join(" ").toLocaleLowerCase("ja-JP").includes(query);
    const today=day(Date.now());
    const dateKey=value=>String(value||"").replace(/-/g,"/");
    const regular=events.filter(event=>!event.recurring&&matches(event)&&
      (period==="all"||(period==="past"?dateKey(event.endDate)<today:dateKey(event.endDate)>=today)))
      .sort((a,b)=>period==="past"?b.startAt-a.startAt:a.startAt-b.startAt);
    const recurring=events.filter(event=>event.recurring&&matches(event));
    const selectedName=calendars.find(c=>c.id===loadedId)?.name||"";
    const renderEvent=event=>{
      const date=event.allDay?dateKey(event.startDate):day(event.startAt);
      const end=event.allDay?dateKey(event.endDate):day(event.endAt);
      const timing=event.allDay?"終日":clock(event.startAt)+" – "+(date!==end?end+" ":"")+clock(event.endAt);
      return h("details",{key:event.id,className:"tt-event motion-surface"},
        h("summary",{},h("span",{className:"tt-event-date"},date,event.allDay&&date!==end?" – "+end:""),
          h("strong",{},event.title),h("span",{className:"tt-event-time"},timing)),
        h("div",{className:"tt-event-body"},
          event.location&&h("p",{},h("strong",{},"場所　"),event.location),
          event.note?h("p",{className:"tt-event-note"},event.note):h("p",{className:"tt-muted"},"詳細メモはありません"),
          event.noteTruncated&&h("p",{className:"tt-muted"},"長いメモの続きはTimeTreeで確認してください。")));
    };

    return h("section",{className:"tt-panel","aria-label":"TimeTree 管理者専用"},
      h("div",{className:"tt-heading"},h("div",{},h("span",{className:"tt-kicker"},"TIMETREE / PREVIEW"),h("h2",{},"TimeTreeの予定")),
        h("span",{className:"tt-admin-badge"},"管理者専用")),
      h("p",{className:"tt-description"},"TimeTreeの共有カレンダーを、この画面で確認できます。非公式の閲覧専用機能です。"),
      h("p",{className:"tt-muted"},"TimeTreeのパスワードは保存しません。接続は最長6時間で切れます。"),
      error&&h("div",{className:"tt-error",role:"alert"},error),
      message&&h("div",{className:"tt-message",role:"status"},message),
      busy&&h("div",{className:"tt-busy",role:"status","aria-live":"polite"},h("span",{className:"tt-spinner","aria-hidden":"true"}),busy+"…"),
      !token?h("form",{className:"tt-form motion-surface",onSubmit:unlock},
        h("h3",{},"管理者の本人確認"),h("p",{className:"tt-muted"},"このアプリにログイン中の管理者アカウント（"+String(user.email||"")+"）で確認します。"),
        h("label",{htmlFor:"tt-admin-password"},"このアプリのパスワード"),
        h("input",{id:"tt-admin-password",type:"password",autoComplete:"current-password",value:adminPassword,onInput:e=>setAdminPassword(e.currentTarget.value),required:true,disabled:!!busy}),
        button("本人確認する",{type:"submit",className:"tt-primary",disabled:!!busy||!adminPassword}))
      : !connected?h("form",{className:"tt-form motion-surface",onSubmit:connect},
        h("h3",{},"TimeTreeに接続"),
        h("label",{htmlFor:"tt-email"},"TimeTreeのメールアドレス"),
        h("input",{id:"tt-email",name:"timetree-email",type:"email",autoComplete:"off",value:email,onInput:e=>setEmail(e.currentTarget.value),required:true,disabled:!!busy,placeholder:"TimeTreeに登録したメールアドレス"}),
        h("label",{htmlFor:"tt-password"},"TimeTreeのパスワード"),
        h("input",{id:"tt-password",name:"timetree-password",type:"password",autoComplete:"off",value:password,onInput:e=>setPassword(e.currentTarget.value),required:true,disabled:!!busy}),
        h("p",{className:"tt-muted"},"入力内容はアプリのサーバーを経由してTimeTreeへ送信します。TimeTreeのメールアドレスとパスワードでログインできるアカウントに対応します。"),
        button("TimeTreeに接続する",{type:"submit",className:"tt-primary",disabled:!!busy||!email.trim()||!password}))
      : h("div",{className:"tt-controls motion-surface"},
        h("div",{className:"tt-connection-row"},h("span",{className:"tt-connected"},"接続済み"),button("接続を解除",{onClick:disconnect,disabled:!!busy})),
        h("label",{htmlFor:"tt-calendar"},"表示するカレンダー"),
        h("select",{id:"tt-calendar",value:selected,disabled:!!busy,onChange:e=>{setSelected(e.currentTarget.value);clearView();setSearch("");setError("");setMessage("");}},
          h("option",{value:""},"チームのカレンダーを選択"),calendars.map(c=>h("option",{key:c.id,value:c.id},c.name))),
        calendars.length===0&&h("p",{className:"tt-muted"},"閲覧できるカレンダーがありません。TimeTreeでチームのカレンダーに参加しているか確認してください。"),
        button(loadedId?"予定を更新する":"予定を表示する",{onClick:loadEvents,className:"tt-primary",disabled:!!busy||!selected})),
      connected&&loadedId&&h("div",{className:"tt-results"},
        h("div",{className:"tt-results-heading"},h("h3",{},selectedName),fetchedAt&&h("span",{},"取得 "+clock(fetchedAt))),
        h("div",{className:"tt-filters"},
          h("select",{"aria-label":"予定の表示期間",value:period,onChange:e=>{setPeriod(e.currentTarget.value);setLimit(60);}},
            h("option",{value:"upcoming"},"今日以降"),h("option",{value:"past"},"過去の予定"),h("option",{value:"all"},"すべて")),
          h("input",{type:"search","aria-label":"TimeTreeの予定を検索",placeholder:"予定・場所を検索",value:search,onInput:e=>{setSearch(e.currentTarget.value);setLimit(60);}})),
        h("p",{className:"tt-muted"},"時刻は日本時間です。TimeTreeの変更は「予定を更新する」で読み込みます。"),
        regular.length===0&&h("p",{className:"tt-empty"},"表示する予定はありません"),
        regular.slice(0,limit).map(renderEvent),
        regular.length>limit&&button("続きを表示（残り "+(regular.length-limit)+"件）",{onClick:()=>setLimit(n=>n+60),className:"tt-more"}),
        recurring.length>0&&h("details",{className:"tt-recurring"},
          h("summary",{},"繰り返し予定の原本（"+recurring.length+"件）"),
          h("p",{className:"tt-muted"},"試作版では繰り返しを日付ごとに展開せず、元の開始日と内容を表示します。実施日はTimeTreeで確認してください。"),
          recurring.map(renderEvent))),
      h("a",{className:"tt-source-link",href:"https://timetreeapp.com/calendars",target:"_blank",rel:"noopener noreferrer"},"TimeTreeを開く ↗"));
  }

  window.TimeTreePanel = function TimeTreePanel(props) {
    return admin(props.user) ? h(AdminTimeTreePanel,props) : null;
  };
})();
