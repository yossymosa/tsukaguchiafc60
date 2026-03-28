// ============================================================
// AFC管理アプリ × Google Apps Script
// 実際のスプレッドシート構成に完全対応版
//
// 【スプレッドシートの列構成】
//
// メンバー: ID / 名前 / 学年 / ポジション / 背番号
//
// スケジュール: ID / 日付 / 試合分類 / 場所 / 種類 / MVP
//   ※「試合分類」がタイトル扱い（公式戦・トレマ名など）
//
// 試合結果: ID / 日付 / 相手チーム / 試合形式 / 第○試合 / メモ
//           + 【追加列】スケジュールID / 種類
//   ※スコアは得点記録から自動集計
//
// 得点記録: ID / 試合ID / 前半/後半 / 時間(分) / 時間(秒)
//           / メンバー名（ゴール） / メンバーID
//           / メンバー名（アシスト）
//           + 【追加列】アシストID / チーム区分 / 得点種別
//
// お知らせ: ID / 日付 / タイトル / 内容 / 投稿者 / カテゴリ
// ユーザー: ID / メール / 名前 / 権限 / パスワード
// ============================================================

const SPREADSHEET_ID = "1EV_qm4ie3DuzDVVklSnVvxJalN7M8zyzk9D7nGhOMbI";

// ── シート列マッピング（実際のシートの列名そのまま）────────────
const MAPS = {
  member: {
    "ID":"id", "名前":"name", "期生":"generation", "学年":"grade", "ポジション":"position", "背番号":"number"
  },
  schedule: {
    // 「試合分類」列 = タイトル兼用
    "ID":"id", "日付":"date", "試合分類":"title",
    "場所":"location", "種類":"type", "順位":"rank", "MVP":"mvp", "出欠締切":"deadline",
    "時間ラベル":"timeLabel",
    "集合時間":"gatherTime", "アップ時間":"upTime", "試合時間":"matchTime",
    "服装":"clothes", "持ち物":"belongings",
    "当番":"duty", "当番メモ":"dutyNote",
    "荷物担当":"luggagePerson", "救急担当":"firstAidPerson",
    "コーチ":"coach", "備考":"note", "PDFURL":"pdfUrl", "PDF名":"pdfName"
  },
  result: {
    // 既存列 + 追加列（スケジュールID・種類・YouTube・PK）
    "ID":"id", "日付":"date", "相手チーム":"opponent",
    "試合形式":"formatLabel", "第○試合":"gameNumber", "メモ":"memo",
    "スケジュールID":"scheduleId", "種類":"type",
    "YouTubeURL":"youtubeUrl", "前半URL":"youtubeUrl1st", "後半URL":"youtubeUrl2nd",
    "PK塚口":"pkOur", "PK相手":"pkTheir",
    "PKキッカー":"pkKickers", "PK相手シーケンス":"pkTheirSeq"
  },
  goal: {
    // 既存列 + 追加列（アシストID・チーム区分・得点種別）
    "ID":"id", "試合ID":"resultId",
    "前半/後半":"half", "時間(分)":"minute", "時間(秒)":"second",
    "メンバー名（ゴール）":"scorerName",
    "メンバーID":"scorerId",
    "メンバー名（アシスト）":"assistName",
    "アシストID":"assistId",
    "チーム区分":"team",   // "us" or "them"
    "得点種別":"goalType"  // 通常 / PK / オウンゴール
  },
  news: {
    "ID":"id", "日付":"date", "タイトル":"title",
    "内容":"content", "投稿者":"author", "カテゴリ":"category",
    "対象種別":"targetType", "対象ID":"targetId", "対象URL":"targetUrl"
  },
  user: {
    "ID":"id", "メール":"email", "名前":"name", "権限":"role", "パスワード":"password",
    "メンバーID":"memberId"
  },
  signupRequest: {
    "ID":"id", "メール":"email", "状態":"status", "トークン":"token", "申請日時":"requestedAt",
    "承認日時":"approvedAt", "承認期限":"approvedUntil", "登録URL":"appUrl", "メモ":"note"
  },
  invite: {
    "ID":"id", "メール":"email", "有効":"enabled", "メモ":"note"
  },
  attend: {
    "ID":"id", "スケジュールID":"scheduleId", "メンバーID":"memberId", "出欠":"status"
  },
  eventAttend: {
    "ID":"id", "スケジュールID":"scheduleId", "ユーザーID":"userId", "ユーザー名":"userName",
    "大人":"adultCount", "小学生":"childCount", "未就学児":"preschoolCount"
  },
  pushSubscription: {
    "ID":"id", "ユーザーID":"userId", "ユーザー名":"userName", "エンドポイント":"endpoint",
    "P256DH":"p256dh", "AUTH":"auth", "更新日時":"updatedAt"
  },
  carpool: {
    "ID":"id", "スケジュールID":"scheduleId", "ユーザーID":"userId", "ユーザー名":"userName",
    "可否":"available", "人数":"capacity", "備考":"note"
  },
  lifting: {
    "ID":"id", "メンバーID":"memberId", "メンバー名":"memberName", "記録":"count", "日付":"date"
  },
};

// ── セットアップ（初回のみ実行・既存シートには列追加のみ）────────
function setupSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // 既存シートは列を追加するだけ、なければ新規作成
  const sheetDefs = [
    {name:"メンバー",     map:MAPS.member},
    {name:"リフティング", map:MAPS.lifting},
    {name:"スケジュール", map:MAPS.schedule},
    {name:"試合結果",     map:MAPS.result},
    {name:"得点記録",     map:MAPS.goal},
    {name:"お知らせ",     map:MAPS.news},
    {name:"ユーザー",     map:MAPS.user},
    {name:"登録申請",     map:MAPS.signupRequest},
    {name:"招待",         map:MAPS.invite},
    {name:"出欠",         map:MAPS.attend},
    {name:"イベント出欠", map:MAPS.eventAttend},
    {name:"通知購読",     map:MAPS.pushSubscription},
    {name:"配車",         map:MAPS.carpool},
  ];

  sheetDefs.forEach(({name, map}) => {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.appendRow(Object.keys(map));
      Logger.log("新規作成: " + name);
    } else {
      // 既存シートに不足列を追加
      const headers = sh.getLastRow() > 0
        ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String)
        : [];
      const needed = Object.keys(map).filter(k => !headers.includes(k));
      if (needed.length > 0) {
        needed.forEach(col => {
          const nextCol = sh.getLastColumn() + 1;
          sh.getRange(1, nextCol).setValue(col);
          Logger.log(name + " に列追加: " + col);
        });
      } else {
        Logger.log(name + ": 列変更なし");
      }
    }
  });

  // ユーザーにデフォルトアカウントがなければ追加
  const us = ss.getSheetByName("ユーザー");
  if (us.getLastRow() <= 1) {
    us.appendRow(["U001","coach@example.com","コーチ","admin","coach123"]);
    us.appendRow(["U002","parent@example.com","保護者","member","parent123"]);
    Logger.log("デフォルトユーザー追加済み");
  }

  Logger.log("✅ セットアップ完了！次: デプロイ→新しいデプロイ→ウェブアプリ→アクセス「全員」");
}

// ── ユーティリティ ────────────────────────────────────────────
function genId() {
  return Utilities.getUuid().replace(/-/g,"").slice(0,8).toUpperCase();
}

function getSheet(name) {
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(name);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function makeCacheKey(prefix, email) {
  return prefix + ":" + normalizeEmail(email);
}

function isEnabledValue(v) {
  const value = String(v === undefined || v === null ? "" : v).trim().toLowerCase();
  return value === "" || value === "1" || value === "true" || value === "yes" || value === "ok" || value === "有効";
}

function nowIso() {
  return new Date().toISOString();
}

function addHoursIso(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function getJstDate(offsetDays) {
  const base = new Date();
  const jst = new Date(base.getTime() + 9 * 60 * 60 * 1000 + (offsetDays || 0) * 24 * 60 * 60 * 1000);
  return Utilities.formatDate(jst, "Asia/Tokyo", "yyyy-MM-dd");
}

function requirePushSyncSecret(secret) {
  const expected = PropertiesService.getScriptProperties().getProperty("PUSH_SYNC_SECRET");
  if (!expected) throw new Error("PUSH_SYNC_SECRET が設定されていません");
  if (String(secret || "").trim() !== String(expected).trim()) {
    throw new Error("通知同期シークレットが不正です");
  }
}

function getPushApiBaseUrl() {
  return String(
    PropertiesService.getScriptProperties().getProperty("APP_BASE_URL")
      || "https://tsukaguchiafc60.vercel.app"
  ).replace(/\/+$/, "");
}

function getPushTargetsByRole() {
  const adminIds = new Set(
    sheetToObjects("ユーザー", MAPS.user)
      .filter(u => String(u.role || "").trim() === "admin")
      .map(u => String(u.id || ""))
  );
  return sheetToObjects("通知購読", MAPS.pushSubscription)
    .filter(s => s.endpoint && s.p256dh && s.auth && adminIds.has(String(s.userId || "")))
    .map(s => ({
      userId: s.userId || "",
      userName: s.userName || "",
      subscription: {
        endpoint: s.endpoint,
        keys: {
          p256dh: s.p256dh,
          auth: s.auth,
        },
      },
    }));
}

function sendPushBroadcast(payload) {
  const secret = PropertiesService.getScriptProperties().getProperty("PUSH_SYNC_SECRET");
  if (!secret) return { ok: false, skipped: true, reason: "missing PUSH_SYNC_SECRET" };
  const baseUrl = getPushApiBaseUrl();
  const res = UrlFetchApp.fetch(baseUrl + "/api/push-send-event", {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify({
      secret,
      title: payload.title || "",
      body: payload.body || "",
      url: payload.url || "/",
    }),
  });
  const text = res.getContentText() || "{}";
  try {
    return JSON.parse(text);
  } catch (e) {
    return { ok: false, status: res.getResponseCode(), raw: text };
  }
}

function getAdminEmails() {
  const users = sheetToObjects("ユーザー", MAPS.user);
  return [...new Set(
    users
      .filter(u => String(u.role || "").trim() === "admin")
      .map(u => normalizeEmail(u.email))
      .filter(Boolean)
  )];
}

function appendSystemNews(item) {
  const now = nowIso();
  appendObject("お知らせ", MAPS.news, {
    id: genId(),
    date: item.date || now,
    title: item.title || "",
    content: item.content || "",
    author: item.author || "system",
    category: item.category || "連絡",
    targetType: item.targetType || "",
    targetId: item.targetId || "",
    targetUrl: item.targetUrl || "",
  });
}

function parsePdfEntries(urlRaw, nameRaw) {
  const normalize = value => String(value || "").trim();
  const urlsText = normalize(urlRaw);
  const namesText = normalize(nameRaw);
  if (!urlsText) return [];
  try {
    const parsedUrls = JSON.parse(urlsText);
    if (Array.isArray(parsedUrls)) {
      if (parsedUrls.length && typeof parsedUrls[0] === "object") {
        return parsedUrls
          .map(item => ({ url: normalize(item.url), name: normalize(item.name) }))
          .filter(item => item.url);
      }
      let parsedNames = [];
      try { parsedNames = JSON.parse(namesText || "[]"); } catch (e) {}
      return parsedUrls
        .map((url, idx) => ({ url: normalize(url), name: normalize(parsedNames[idx]) }))
        .filter(item => item.url);
    }
  } catch (e) {}
  return [{ url: urlsText, name: namesText }];
}

function findSignupRequestByEmail(email) {
  return sheetToObjects("登録申請", MAPS.signupRequest)
    .find(row => normalizeEmail(row.email) === normalizeEmail(email));
}

function findSignupRequestByToken(token) {
  return sheetToObjects("登録申請", MAPS.signupRequest)
    .find(row => String(row.token || "").trim() === String(token || "").trim());
}

function saveSignupRequest(data) {
  const sh = getSheet("登録申請");
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const idCol = headers.indexOf("ID") + 1;
  const lastRow = sh.getLastRow();
  const rows = lastRow >= 2 ? sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues() : [];
  const existingIndex = rows.findIndex(row => String(row[idCol - 1]).trim() === String(data.id || "").trim());
  const obj = {
    id: data.id || genId(),
    email: normalizeEmail(data.email),
    status: data.status || "pending",
    token: data.token || "",
    requestedAt: data.requestedAt || "",
    approvedAt: data.approvedAt || "",
    approvedUntil: data.approvedUntil || "",
    appUrl: data.appUrl || "",
    note: data.note || "",
  };
  const out = headers.map(h => {
    const key = MAPS.signupRequest[h];
    return key ? (obj[key] !== undefined ? obj[key] : "") : "";
  });
  if (existingIndex >= 0) {
    sh.getRange(existingIndex + 2, 1, 1, out.length).setValues([out]);
    return obj;
  }
  sh.appendRow(out);
  return obj;
}

function isApprovedRequest(row) {
  if (!row || String(row.status || "") !== "approved") return false;
  const until = String(row.approvedUntil || "").trim();
  if (!until) return false;
  return new Date(until).getTime() >= Date.now();
}

function ensureApprovedSignupEmail(email) {
  const req = findSignupRequestByEmail(email);
  if (!req) throw new Error("先に登録申請をしてください");
  if (String(req.status || "") === "pending") {
    throw new Error("まだ管理者承認が完了していません");
  }
  if (!isApprovedRequest(req)) {
    throw new Error("登録承認の有効期限が切れています。もう一度申請してください");
  }
  return req;
}

function buildApprovalUrl(token) {
  return ScriptApp.getService().getUrl() + "?action=approveSignupRequest&token=" + encodeURIComponent(token);
}

function buildApprovalPage(title, body, link) {
  const button = link
    ? '<p style="margin-top:20px;"><a href="' + link + '" style="display:inline-block;padding:12px 18px;background:#FF6B35;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;">登録画面を開く</a></p>'
    : "";
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title></head><body style="margin:0;background:#f5f7fb;font-family:sans-serif;color:#1f2937;">' +
    '<div style="max-width:520px;margin:48px auto;padding:32px;background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,0.08);">' +
    '<h1 style="margin:0 0 16px;font-size:24px;">' + title + '</h1><p style="line-height:1.8;white-space:pre-line;">' + body + '</p>' +
    button +
    '</div></body></html>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// シート全行をオブジェクト配列で返す（ヘッダーとMAPで変換）
function sheetToObjects(sheetName, map) {
  const sh = getSheet(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  return rows
    .filter(r => r.some(v => v !== ""))
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => {
        const key = map[h];
        if (key) {
          let v = r[i];
          // エラー値（#N/A, #REF! 等）は空文字に
          if (v instanceof Error || (typeof v === 'string' && v.startsWith('#'))) {
            v = "";
          } else if (v instanceof Date) {
            v = Utilities.formatDate(v, "Asia/Tokyo", "yyyy-MM-dd");
          } else {
            v = String(v === null || v === undefined ? "" : v).trim();
          }
          obj[key] = v;
        }
      });
      return obj;
    });
}

// オブジェクトをシートに1行追加
function appendObject(sheetName, map, obj) {
  const sh = getSheet(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const row = headers.map(h => {
    const key = map[h];
    return key && obj[key] !== undefined ? obj[key] : "";
  });
  sh.appendRow(row);
}

// 特定列の値でIDを探して行を削除
function deleteRowById(sheetName, id) {
  const sh = getSheet(sheetName);
  if (!sh || sh.getLastRow() < 2) return false;
  const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]).trim() === String(id).trim()) {
      sh.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

// ── 得点記録からスコアを集計 ─────────────────────────────────
// チーム区分列がない既存データ対応:
//   - "チーム区分"列に "us"/"them" があればそれを使う
//   - なければ「メンバーID（scorerId）があれば us、なければ them」で判定
function resolveTeam(g) {
  let baseTeam = "";

  // チーム区分列が正しく入っている場合はそれを使う
  if (g.team === "us" || g.team === "them") {
    baseTeam = g.team;
  }

  if (!baseTeam) {
    // 失点行の判定:
    // - メンバー名（ゴール）が「失点」
    // - または メンバーIDが "#N/A" / 空
    const name = String(g.scorerName || "").trim();
    const id   = String(g.scorerId   || "").trim();
    const goalType = String(g.goalType || "").trim();

    if (name === "失点") baseTeam = "them";
    else if (goalType === "オウンゴール" || name === "オウンゴール") baseTeam = "us";
    else if (id === "#N/A" || id === "" || id === "N/A") baseTeam = "them";
    else baseTeam = "us";
  }

  return baseTeam;
}

function calcScores(goals) {
  const map = {};
  goals.forEach(g => {
    if (!g.resultId) return;
    const team = resolveTeam(g);
    if (!map[g.resultId]) map[g.resultId] = {ourScore: 0, theirScore: 0};
    if (team === "us") map[g.resultId].ourScore++;
    else map[g.resultId].theirScore++;
  });
  return map;
}

// ── メインエントリー ──────────────────────────────────────────
function doPost(e) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8"
  };
  try {
    const req = JSON.parse(e.postData.contents);
    const result = dispatch(req);
    return ContentService.createTextOutput(JSON.stringify({ok:true, ...result}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false, error:err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  const action = String((e && e.parameter && e.parameter.action) || "").trim();
  if (action === "approveSignupRequest") {
    try {
      const token = String((e && e.parameter && e.parameter.token) || "").trim();
      if (!token) throw new Error("承認トークンがありません");
      const req = findSignupRequestByToken(token);
      if (!req) throw new Error("承認対象が見つかりません");
      const appUrl = String(req.appUrl || "").trim();
      const approvedUrl = appUrl ? appUrl + (appUrl.includes("?") ? "&" : "?") + "approved=1" : "";
      if (isApprovedRequest(req)) {
        return buildApprovalPage("すでに承認済みです", "この登録申請はすでに承認されています。", approvedUrl || appUrl);
      }
      const updated = saveSignupRequest({
        ...req,
        status: "approved",
        approvedAt: nowIso(),
        approvedUntil: addHoursIso(72),
      });
      if (updated.email) {
        MailApp.sendEmail({
          to: updated.email,
          subject: "塚口AFC Jr 登録承認のお知らせ",
          body:
            "登録申請が承認されました。\n\n" +
            "72時間以内に下記から登録を完了してください。\n" +
            (approvedUrl || appUrl || "") + "\n\n" +
            "メールアドレス: " + updated.email + "\n" +
            "有効期限: " + updated.approvedUntil
        });
      }
      return buildApprovalPage("承認しました", "保護者の登録申請を承認しました。\n登録案内メールを送信済みです。", approvedUrl || appUrl);
    } catch (err) {
      return buildApprovalPage("承認できませんでした", err.message || "不明なエラーです");
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ok:true, message:"AFC管理アプリ API稼働中"}))
    .setMimeType(ContentService.MimeType.JSON);
}

// 運用メモ:
// HTML は GitHub / Vercel 側で配信する
// GAS は API 専用としてデプロイし、発行された /exec URL を index.html の GAS_URL に貼り替える

function dispatch(req) {
  switch(req.action) {

    // ── ログイン ──────────────────────────────────────────────
    case "login": {
      const users = sheetToObjects("ユーザー", MAPS.user);
      const u = users.find(u =>
        normalizeEmail(u.email) === normalizeEmail(req.email) &&
        u.password === String(req.password).trim()
      );
      if (!u) throw new Error("メールアドレスまたはパスワードが違います");
      return { user: {id:u.id, name:u.name, email:u.email, role:u.role, memberId:u.memberId||""} };
    }

    case "getSignupMembers": {
      const members = sheetToObjects("メンバー", MAPS.member);
      return {
        members: members.map(m => ({
          id: m.id,
          name: m.name,
          grade: m.grade || "",
          generation: m.generation || "",
          position: m.position || "",
          number: m.number || "",
        }))
      };
    }

    case "requestSignupApproval": {
      const email = normalizeEmail(req.email);
      const appUrl = String(req.appUrl || "").trim();
      if (!email) throw new Error("メールアドレスを入力してください");
      const users = sheetToObjects("ユーザー", MAPS.user);
      if (users.some(u => normalizeEmail(u.email) === email)) {
        throw new Error("このメールアドレスはすでに登録されています");
      }
      const token = genId() + genId();
      const existing = findSignupRequestByEmail(email);
      const saved = saveSignupRequest({
        ...(existing || {}),
        email,
        status: "pending",
        token,
        requestedAt: nowIso(),
        approvedAt: "",
        approvedUntil: "",
        appUrl: appUrl || (existing && existing.appUrl) || "",
      });
      const adminEmails = getAdminEmails();
      if (!adminEmails.length) {
        throw new Error("管理者メールアドレスが設定されていません");
      }
      const approvalUrl = buildApprovalUrl(saved.token);
      MailApp.sendEmail({
        to: adminEmails.join(","),
        subject: "塚口AFC Jr 新規登録承認依頼",
        body:
          "保護者から新規登録申請が届いています。\n\n" +
          "申請メールアドレス: " + email + "\n" +
          "承認リンク:\n" + approvalUrl + "\n\n" +
          "リンクを開くと登録が承認され、保護者へ登録案内メールが送信されます。"
      });
      return { requested: true };
    }

    case "getSignupApprovalStatus": {
      const email = normalizeEmail(req.email);
      if (!email) return { status: "none" };
      const found = findSignupRequestByEmail(email);
      if (!found) return { status: "none" };
      if (isApprovedRequest(found)) {
        return { status: "approved", approvedUntil: found.approvedUntil || "" };
      }
      return { status: String(found.status || "pending") };
    }

    case "sendSignupCode": {
      const email = normalizeEmail(req.email);
      if (!email) throw new Error("メールアドレスを入力してください");
      const users = sheetToObjects("ユーザー", MAPS.user);
      if (users.some(u => normalizeEmail(u.email) === email)) {
        throw new Error("このメールアドレスはすでに登録されています");
      }
      ensureApprovedSignupEmail(email);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      CacheService.getScriptCache().put(makeCacheKey("signup_code", email), code, 60 * 10);
      MailApp.sendEmail({
        to: email,
        subject: "塚口AFC Jr ユーザー登録認証コード",
        body:
          "ユーザー登録の認証コードをお送りします。\n\n" +
          "認証コード: " + code + "\n" +
          "有効期限: 10分\n\n" +
          "このメールに心当たりがない場合は破棄してください。"
      });
      return { sent: true };
    }

    case "registerUser": {
      const email = normalizeEmail(req.email);
      const password = String(req.password || "").trim();
      const name = String(req.name || "").trim();
      const memberId = String(req.memberId || "").trim();
      if (!email || !password || !name || !memberId) {
        throw new Error("登録項目をすべて入力してください");
      }
      const users = sheetToObjects("ユーザー", MAPS.user);
      if (users.some(u => normalizeEmail(u.email) === email)) {
        throw new Error("このメールアドレスはすでに登録されています");
      }
      ensureApprovedSignupEmail(email);
      const members = sheetToObjects("メンバー", MAPS.member);
      const member = members.find(m => String(m.id) === memberId);
      if (!member) throw new Error("子どもの名前を選択してください");
      const obj = {
        id: genId(),
        email,
        name,
        role: "member",
        password,
        memberId,
      };
      appendObject("ユーザー", MAPS.user, obj);
      return { user: {id:obj.id, name:obj.name, email:obj.email, role:obj.role, memberId:obj.memberId} };
    }

    case "updateUserProfile": {
      const userId = String(req.userId || "").trim();
      const name = String(req.name || "").trim();
      const memberId = String(req.memberId || "").trim();
      if (!userId) throw new Error("ユーザーIDがありません");
      if (!name) throw new Error("名前を入力してください");
      if (!memberId) throw new Error("子どもを選択してください");

      const members = sheetToObjects("メンバー", MAPS.member);
      const member = members.find(m => String(m.id || "") === memberId);
      if (!member) throw new Error("選択した子どもが見つかりません");

      const sh = getSheet("ユーザー");
      if (!sh || sh.getLastRow() < 2) throw new Error("ユーザーシートが見つかりません");
      const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
      const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
      const idCol = headers.indexOf("ID");
      const nameCol = headers.indexOf("名前");
      const memberIdCol = headers.indexOf("メンバーID");
      for (let i = 0; i < rows.length; i++) {
        if (String(rows[i][idCol] || "").trim() === userId) {
          sh.getRange(i + 2, nameCol + 1).setValue(name);
          sh.getRange(i + 2, memberIdCol + 1).setValue(memberId);
          const email = String(rows[i][headers.indexOf("メール")] || "");
          const role = String(rows[i][headers.indexOf("権限")] || "");
          return { user: { id: userId, name, email, role, memberId } };
        }
      }
      throw new Error("ユーザーが見つかりません");
    }

    case "savePushSubscription": {
      const sub = req.subscription || {};
      const endpoint = String(sub.endpoint || "").trim();
      if (!req.userId || !endpoint) throw new Error("通知購読情報が不足しています");
      const sh = getSheet("通知購読");
      if (!sh) throw new Error("通知購読シートがありません");
      const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
      const rows = sh.getLastRow() >= 2 ? sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues() : [];
      const endpointCol = headers.indexOf("エンドポイント");
      const rowIndex = rows.findIndex(r => String(r[endpointCol] || "") === endpoint);
      const payload = {
        id: rowIndex >= 0 ? String(rows[rowIndex][headers.indexOf("ID")] || genId()) : genId(),
        userId: String(req.userId || ""),
        userName: String(req.userName || ""),
        endpoint,
        p256dh: String(sub.keys?.p256dh || ""),
        auth: String(sub.keys?.auth || ""),
        updatedAt: nowIso(),
      };
      const row = headers.map(h => {
        if (h === "ID") return payload.id;
        if (h === "ユーザーID") return payload.userId;
        if (h === "ユーザー名") return payload.userName;
        if (h === "エンドポイント") return payload.endpoint;
        if (h === "P256DH") return payload.p256dh;
        if (h === "AUTH") return payload.auth;
        if (h === "更新日時") return payload.updatedAt;
        return "";
      });
      if (rowIndex >= 0) {
        sh.getRange(rowIndex + 2, 1, 1, row.length).setValues([row]);
      } else {
        sh.appendRow(row);
      }
      return { saved: true };
    }

    case "deletePushSubscription": {
      const endpoint = String(req.endpoint || "").trim();
      if (!endpoint) return { removed: false };
      const sh = getSheet("通知購読");
      if (!sh || sh.getLastRow() < 2) return { removed: false };
      const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
      const endpointCol = headers.indexOf("エンドポイント") + 1;
      const values = sh.getRange(2, endpointCol, sh.getLastRow()-1, 1).getValues();
      for (let i = 0; i < values.length; i++) {
        if (String(values[i][0] || "") === endpoint) {
          sh.deleteRow(i + 2);
          return { removed: true };
        }
      }
      return { removed: false };
    }

    case "getPushDeadlineTargets": {
      requirePushSyncSecret(req.secret);
      const tomorrow = getJstDate(1);
      const schedules = sheetToObjects("スケジュール", MAPS.schedule)
        .filter(s => String(s.deadline || "") === tomorrow)
        .map(s => ({
          id: s.id,
          title: s.title || "予定",
          deadline: s.deadline || "",
          location: s.location || "",
          type: s.type || "",
        }));
      return {
        targets: getPushTargetsByRole(),
        schedules,
      };
    }

    case "getPushTargets": {
      requirePushSyncSecret(req.secret);
      return {
        targets: getPushTargetsByRole(),
      };
    }

    case "previewFc2Schedule": {
      const preview = previewFc2Schedule(req.url, req.year, req.month);
      return {
        items: preview.items,
        sourceTitle: preview.sourceTitle || "",
        fetchedUrl: preview.fetchedUrl || "",
      };
    }

    // ── 全データ取得 ──────────────────────────────────────────
    case "getAll": {
      const members   = sheetToObjects("メンバー",     MAPS.member);
      const schedules = sheetToObjects("スケジュール", MAPS.schedule);
      const results   = sheetToObjects("試合結果",     MAPS.result);
      const goals     = sheetToObjects("得点記録",     MAPS.goal);
      const news      = sheetToObjects("お知らせ",     MAPS.news);

      // スコア集計
      const scoreMap = calcScores(goals);

      // 試合結果にスコアとゴール情報を付加
      const enrichedResults = results.map(r => {
        const scores = scoreMap[r.id] || {ourScore:0, theirScore:0};
        const myGoals = goals.filter(g => g.resultId === r.id && resolveTeam(g) === "us");
        const theirGoals = goals.filter(g => g.resultId === r.id && resolveTeam(g) === "them");

                  // スケジュールと紐付け（scheduleId優先、なければ同日候補から種類優先で決定）
          const normalizeScheduleType = value => {
            const s = String(value || "").toLowerCase();
            if (/official|公式|リーグ|大会|選手権/.test(s)) return "official";
            if (/cup|カップ/.test(s)) return "cup";
            if (/training|tm|トレマ|練習試合|トレーニングマッチ/.test(s)) return "training";
            if (/practice|練習/.test(s)) return "practice";
            if (/event|イベント|開会式/.test(s)) return "event";
            return "";
          };
          const schedulePriority = value => {
            const t = normalizeScheduleType(value);
            if (t === "official") return 5;
            if (t === "cup") return 4;
            if (t === "training") return 3;
            if (t === "practice") return 2;
            if (t === "event") return 1;
            return 0;
          };
          const sameDayAll = schedules.filter(s => s.date === r.date);
          const titledSameDay = sameDayAll.filter(s => {
            const title = String(s.title || "").trim();
            return title && title !== "(タイトルなし)";
          });
          const sameDay = titledSameDay.length ? titledSameDay : sameDayAll;
          const resultType = normalizeScheduleType(r.type || r.formatLabel || r.memo || "");
          const typedSameDay = resultType ? sameDay.filter(s => normalizeScheduleType(s.type || s.title) === resultType) : [];
          const pickSchedule = arr => {
            if (!arr.length) return null;
            return [...arr].sort((a,b) =>
              schedulePriority(b.type || b.title) - schedulePriority(a.type || a.title)
              || (String(b.title || "").trim() ? 1 : 0) - (String(a.title || "").trim() ? 1 : 0)
            )[0] || null;
          };
          const sch = schedules.find(s => String(s.id || "") === String(r.scheduleId || "")) || pickSchedule(typedSameDay) || pickSchedule(sameDay);
          const resolvedType = normalizeScheduleType((sch ? (sch.type || sch.title) : "") || r.type || r.formatLabel || r.memo || "");

          return {
            ...r,
            ourScore:   scores.ourScore,
            theirScore: scores.theirScore,
            goals:      myGoals,
            theirGoals: theirGoals,
            scheduleId: r.scheduleId || (sch ? sch.id : ""),
            type:       resolvedType || (sch ? sch.type : "") || r.type || "",
        };
      });

      // 日付降順
      enrichedResults.sort((a,b) => b.date.localeCompare(a.date));
      schedules.sort((a,b) => b.date.localeCompare(a.date));

      const liftings = sheetToObjects("リフティング", MAPS.lifting);
      const allUsers = sheetToObjects("ユーザー", MAPS.user);
      // パスワードを除いて返す
      const users = allUsers.map(u=>({id:u.id,name:u.name,email:u.email,role:u.role,memberId:u.memberId||""}));
      return { members, schedules, results: enrichedResults, news, liftings, users };
    }

    // ── 日程追加 ──────────────────────────────────────────────
    case "addSchedule": {
      const s = req.schedule;
      const obj = {
        id:        genId(),
        date:      s.date      || "",
        title:     s.title     || "",
        location:  s.location  || "",
        type:      s.type      || "practice",
        rank:      s.rank      || "",
        category:  s.category  || "",
        mvp:       s.mvp       || "",
        timeLabel: s.timeLabel || "",
      };
      appendObject("スケジュール", MAPS.schedule, obj);
      try {
        appendSystemNews({
          title: "新しい予定が追加されました",
          content: `${obj.date || ""} ${obj.title || "予定"}${obj.location ? " / " + obj.location : ""}`.trim(),
          targetType: "schedule",
          targetId: obj.id,
        });
      } catch (e) {}
      try {
        sendPushBroadcast({
          title: "新しい予定が追加されました",
          body: `${obj.date || ""} ${obj.title || "予定"}${obj.location ? " / " + obj.location : ""}`.trim(),
          url: "/?source=push&tab=cal",
        });
      } catch (e) {}
      return { id: obj.id };
    }

    // ── 日程更新 ──────────────────────────────────────────────
    case "updateSchedule": {
      const sh = getSheet("スケジュール");
      if (!sh) return {};
      const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
      const idCol = headers.indexOf("ID") + 1;
      const lastRow = sh.getLastRow();
      const ids = sh.getRange(1, idCol, lastRow, 1).getValues();
      for (let i = 1; i < lastRow; i++) {
        if (String(ids[i][0]) === String(req.schedule.id)) {
          headers.forEach((h, j) => {
            const s = req.schedule;
            const map = {"日付":"date","試合分類":"title","場所":"location","種類":"type","順位":"rank","MVP":"mvp","出欠締切":"deadline","時間ラベル":"timeLabel",
              "集合時間":"gatherTime","アップ時間":"upTime","試合時間":"matchTime",
              "服装":"clothes","持ち物":"belongings",
              "当番":"duty","当番メモ":"dutyNote","荷物担当":"luggagePerson","救急担当":"firstAidPerson",
              "コーチ":"coach","備考":"note","PDFURL":"pdfUrl","PDF名":"pdfName"};
            if (map[h] !== undefined && s[map[h]] !== undefined) {
              sh.getRange(i+1, j+1).setValue(s[map[h]]);
            }
          });
          return {};
        }
      }
      return {};
    }

    case "uploadSchedulePdf": {
      const scheduleId = String(req.scheduleId || "").trim();
      const fileName = String(req.fileName || "schedule.pdf").trim();
      const mimeType = String(req.mimeType || "application/pdf").trim();
      const base64 = String(req.base64 || "").trim();
      if (!scheduleId || !base64) throw new Error("PDFアップロード情報が不足しています");
      if (mimeType !== "application/pdf") throw new Error("PDFファイルのみアップロードできます");

      const sh = getSheet("スケジュール");
      if (!sh || sh.getLastRow() < 2) throw new Error("スケジュールシートがありません");
      const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
      const idCol = headers.indexOf("ID") + 1;
      const pdfUrlCol = headers.indexOf("PDFURL") + 1;
      const pdfNameCol = headers.indexOf("PDF名") + 1;
      if (!pdfUrlCol || !pdfNameCol) throw new Error("PDF列がありません。setupSheets() を実行してください");

      let targetRow = 0;
      const ids = sh.getRange(2, idCol, sh.getLastRow() - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (String(ids[i][0] || "").trim() === scheduleId) {
          targetRow = i + 2;
          break;
        }
      }
      if (!targetRow) throw new Error("対象の日程が見つかりません");

      const folderId = String(PropertiesService.getScriptProperties().getProperty("SCHEDULE_PDF_FOLDER_ID") || "").trim();
      let folder = DriveApp.getRootFolder();
      if (folderId) {
        try {
          folder = DriveApp.getFolderById(folderId);
        } catch (e) {
          folder = DriveApp.getRootFolder();
        }
      }
      const safeName = fileName.replace(/[\\/:*?\"<>|]+/g, "_");
      const dateVal = String(sh.getRange(targetRow, headers.indexOf("日付") + 1).getValue() || "");
      const titleVal = String(sh.getRange(targetRow, headers.indexOf("試合分類") + 1).getValue() || "schedule");
      const storedName = [dateVal, titleVal, safeName].filter(Boolean).join("_");
      const bytes = Utilities.base64Decode(base64);
      const blob = Utilities.newBlob(bytes, mimeType, storedName);
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      const url = "https://drive.google.com/file/d/" + file.getId() + "/view?usp=sharing";

      const currentPdfUrl = sh.getRange(targetRow, pdfUrlCol).getValue();
      const currentPdfName = sh.getRange(targetRow, pdfNameCol).getValue();
      const nextPdfs = parsePdfEntries(currentPdfUrl, currentPdfName).concat([{ url: url, name: file.getName() }]);
      const storedUrls = nextPdfs.length === 1 ? nextPdfs[0].url : JSON.stringify(nextPdfs.map(item => item.url));
      const storedNames = nextPdfs.length === 1 ? nextPdfs[0].name : JSON.stringify(nextPdfs.map(item => item.name));

      sh.getRange(targetRow, pdfUrlCol).setValue(storedUrls);
      sh.getRange(targetRow, pdfNameCol).setValue(storedNames);
      return { pdfUrl: storedUrls, pdfName: storedNames, pdfs: nextPdfs, fileId: file.getId() };
    }

    // ── 日程削除 ──────────────────────────────────────────────
    case "deleteSchedule": {
      deleteRowById("スケジュール", req.id);
      return {};
    }

    // ── リフティング記録追加/更新 ───────────────────────────
    case "saveLifting": {
      const sh = getSheet("リフティング");
      if (!sh) return {};
      const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
      const midCol = headers.indexOf("メンバーID") + 1;
      const lastRow = sh.getLastRow();
      // 同一メンバーの既存記録を更新（最高記録として1行のみ持つ設計）
      if (lastRow >= 2) {
        const mids = sh.getRange(1, midCol, lastRow, 1).getValues();
        for (let i = 1; i < lastRow; i++) {
          if (String(mids[i][0]) === String(req.memberId)) {
            headers.forEach((h, j) => {
              if (h==="記録") sh.getRange(i+1,j+1).setValue(req.count);
              if (h==="日付") sh.getRange(i+1,j+1).setValue(req.date||"");
              if (h==="メンバー名") sh.getRange(i+1,j+1).setValue(req.memberName||"");
            });
            return {};
          }
        }
      }
      // 新規追加
      const newRow = headers.map(h => {
        if (h==="ID") return genId();
        if (h==="メンバーID") return req.memberId||"";
        if (h==="メンバー名") return req.memberName||"";
        if (h==="記録") return req.count||0;
        if (h==="日付") return req.date||"";
        return "";
      });
      sh.appendRow(newRow);
      return {};
    }

    // ── 試合結果追加 ──────────────────────────────────────────
    case "addResult": {
      const r = req.result;
      const obj = {
        id:           genId(),
        date:         r.date         || "",
        opponent:     r.opponent     || "",
        formatLabel:  r.formatLabel  || "",
        gameNumber:   r.gameNumber   || 1,
        memo:         r.memo         || "",
        scheduleId:   r.scheduleId   || "",
        type:         r.type         || "",
        youtubeUrl:   r.youtubeUrl   || "",
        youtubeUrl1st:r.youtubeUrl1st|| "",
        youtubeUrl2nd:r.youtubeUrl2nd|| "",
      };
      appendObject("試合結果", MAPS.result, obj);
      return { id: obj.id };
    }

    // ── 試合結果削除 ──────────────────────────────────────────
    case "deleteResult": {
      deleteRowById("試合結果", req.id);
      // 関連する得点記録も削除
      const sh = getSheet("得点記録");
      if (sh && sh.getLastRow() > 1) {
        const vals = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
        for (let i = vals.length - 1; i >= 1; i--) {
          if (String(vals[i][1]).trim() === String(req.id).trim()) {
            sh.deleteRow(i + 1);
          }
        }
      }
      return {};
    }

    // ── 得点記録一括保存 ─────────────────────────────────────
    case "saveGoals": {
      const sh = getSheet("得点記録");
      const members = sheetToObjects("メンバー", MAPS.member);

      // YouTube URL・PKスコアを試合結果シートに保存
      const needsResultUpdate = req.youtubeUrl !== undefined || req.youtubeUrl1st !== undefined
        || req.youtubeUrl2nd !== undefined || req.pkOur !== undefined || req.pkTheir !== undefined;
      if (needsResultUpdate) {
        const rsh = getSheet("試合結果");
        if (rsh && rsh.getLastRow() > 1) {
          const rHeaders = rsh.getRange(1,1,1,rsh.getLastColumn()).getValues()[0].map(String);
          const rIds = rsh.getRange(1,1,rsh.getLastRow(),1).getValues();
          for (let i = 1; i < rIds.length; i++) {
            if (String(rIds[i][0]).trim() === String(req.resultId).trim()) {
              const row = i + 1;
              const set = (name, val) => {
                const ci = rHeaders.indexOf(name);
                if (ci >= 0 && val !== undefined) rsh.getRange(row, ci+1).setValue(val);
              };
              set("YouTubeURL", req.youtubeUrl   || "");
              set("前半URL",    req.youtubeUrl1st || "");
              set("後半URL",    req.youtubeUrl2nd || "");
              if (req.pkOur   !== undefined) set("PK塚口",  req.pkOur  != null ? req.pkOur  : "");
              if (req.pkTheir !== undefined) set("PK相手",  req.pkTheir != null ? req.pkTheir : "");
              if (req.pkKickers  !== undefined) set("PKキッカー",      req.pkKickers  ? JSON.stringify(req.pkKickers)  : "");
              if (req.pkTheirSeq !== undefined) set("PK相手シーケンス", req.pkTheirSeq ? JSON.stringify(req.pkTheirSeq) : "");
              break;
            }
          }
        }
      }

      // 該当試合IDの行を全削除
      if (sh.getLastRow() > 1) {
        const vals = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
        for (let i = vals.length - 1; i >= 1; i--) {
          if (String(vals[i][1]).trim() === String(req.resultId).trim()) {
            sh.deleteRow(i + 1);
          }
        }
      }

      // わがチームのゴール
      (req.goals || []).forEach(g => {
        const scorer = members.find(m => m.id === g.scorerId);
        const assist = members.find(m => m.id === g.assistId);
        appendObject("得点記録", MAPS.goal, {
          id:          genId(),
          resultId:    req.resultId,
          half:        g.half     || "前半",
          minute:      g.minute   || 0,
          second:      g.second   || 0,
          scorerName:  scorer ? scorer.name : "",
          scorerId:    g.scorerId  || "",
          assistName:  assist ? assist.name : "",
          assistId:    g.assistId  || "",
          team:        "us",
          goalType:    g.goalType  || "通常",
        });
      });

      // 相手チームのゴール
      (req.theirGoals || []).forEach(g => {
        appendObject("得点記録", MAPS.goal, {
          id:          genId(),
          resultId:    req.resultId,
          half:        g.half   || "前半",
          minute:      g.minute || 0,
          second:      g.second || 0,
          scorerName:  "",
          scorerId:    "",
          assistName:  "",
          assistId:    "",
          team:        "them",
          goalType:    g.goalType || "通常",
        });
      });

      return {};
    }

    // ── メンバー追加 ──────────────────────────────────────────
    case "addMember": {
      const m = req.member;
      const obj = {
        id:       genId(),
        name:     m.name     || "",
        generation:m.generation || "",
        grade:    m.grade    || "",
        position: m.position || "",
        number:   m.number   || "",
      };
      appendObject("メンバー", MAPS.member, obj);
      return { id: obj.id };
    }

    // ── メンバー削除 ──────────────────────────────────────────
    case "deleteMember": {
      deleteRowById("メンバー", req.id);
      return {};
    }

    // ── お知らせ追加 ──────────────────────────────────────────
    case "addNews": {
      const n = req.news;
      const now = nowIso();
      const obj = {
        id:       genId(),
        date:     n.date     || now,
        title:    n.title    || "",
        content:  n.content  || "",
        author:   n.author   || "",
        category: n.category || "連絡",
      };
      appendObject("お知らせ", MAPS.news, obj);
      return { id: obj.id };
    }

    // ── お知らせ削除 ──────────────────────────────────────────
    case "deleteNews": {
      deleteRowById("お知らせ", req.id);
      return {};
    }

    // ── MVP更新 ───────────────────────────────────────────────
    case "updateMvp": {
      const sh = getSheet("スケジュール");
      if (!sh || sh.getLastRow() < 2) return {};
      const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
      const mvpCol = headers.indexOf("MVP") + 1;
      if (mvpCol === 0) return {};
      const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
      for (let i = 1; i < ids.length; i++) {
        if (String(ids[i][0]).trim() === String(req.scheduleId).trim()) {
          sh.getRange(i + 1, mvpCol).setValue(req.mvp || "");
          return {};
        }
      }
      return {};
    }

    // ── 出欠取得 ─────────────────────────────────────────────
    case "getAttend": {
      const rows = sheetToObjects("出欠", MAPS.attend);
      const result = rows.filter(r => String(r.scheduleId) === String(req.scheduleId));
      return { attend: result };
    }

    // ── 出欠保存（upsert） ───────────────────────────────────
    case "saveAttend": {
      const sh = getSheet("出欠");
      if (!sh) return {};
      const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
      const sidCol    = headers.indexOf("スケジュールID") + 1;
      const midCol    = headers.indexOf("メンバーID") + 1;
      const statCol   = headers.indexOf("出欠") + 1;
      const idCol     = headers.indexOf("ID") + 1;
      const lastRow   = sh.getLastRow();
      // 既存行を検索してupsert
      if (lastRow >= 2) {
        const sids = sh.getRange(1,sidCol,lastRow,1).getValues();
        const mids = sh.getRange(1,midCol,lastRow,1).getValues();
        for (let i = 1; i < lastRow; i++) {
          if (String(sids[i][0]) === String(req.scheduleId) &&
              String(mids[i][0]) === String(req.memberId)) {
            sh.getRange(i+1, statCol).setValue(req.status);
            return {};
          }
        }
      }
      // 新規行追加
      const newId = "A" + Date.now();
      const newRow = headers.map(h => {
        if (h==="ID")           return newId;
        if (h==="スケジュールID") return req.scheduleId;
        if (h==="メンバーID")    return req.memberId;
        if (h==="出欠")          return req.status;
        return "";
      });
      sh.appendRow(newRow);
      return {};
    }

    case "getEventAttend": {
      const rows = sheetToObjects("イベント出欠", MAPS.eventAttend);
      const result = rows.filter(r => String(r.scheduleId) === String(req.scheduleId));
      return { attend: result };
    }

    case "saveEventAttend": {
      const sh = getSheet("イベント出欠");
      if (!sh) return {};
      const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
      const sidCol = headers.indexOf("スケジュールID") + 1;
      const uidCol = headers.indexOf("ユーザーID") + 1;
      const lastRow = sh.getLastRow();
      const payload = {
        userName: req.userName || "",
        adultCount: Number(req.adultCount || 0),
        childCount: Number(req.childCount || 0),
        preschoolCount: Number(req.preschoolCount || 0),
      };
      if (lastRow >= 2) {
        const sids = sh.getRange(1,sidCol,lastRow,1).getValues();
        const uids = sh.getRange(1,uidCol,lastRow,1).getValues();
        for (let i = 1; i < lastRow; i++) {
          if (String(sids[i][0]) === String(req.scheduleId) &&
              String(uids[i][0]) === String(req.userId)) {
            headers.forEach((h,j)=>{
              if (h==="ユーザー名") sh.getRange(i+1,j+1).setValue(payload.userName);
              if (h==="大人") sh.getRange(i+1,j+1).setValue(payload.adultCount);
              if (h==="小学生") sh.getRange(i+1,j+1).setValue(payload.childCount);
              if (h==="未就学児") sh.getRange(i+1,j+1).setValue(payload.preschoolCount);
            });
            return {};
          }
        }
      }
      const newId = "EA" + Date.now();
      const newRow = headers.map(h => {
        if (h==="ID") return newId;
        if (h==="スケジュールID") return req.scheduleId;
        if (h==="ユーザーID") return req.userId;
        if (h==="ユーザー名") return payload.userName;
        if (h==="大人") return payload.adultCount;
        if (h==="小学生") return payload.childCount;
        if (h==="未就学児") return payload.preschoolCount;
        return "";
      });
      sh.appendRow(newRow);
      return {};
    }

    // ── 試合結果削除 ─────────────────────────────────────────
    case "deleteResult": {
      deleteRowById("試合結果", req.id);
      return {};
    }

    // ── 試合結果更新 ─────────────────────────────────────────
    case "updateResult": {
      const sh = getSheet("試合結果");
      if (!sh || sh.getLastRow() < 2) return {};
      const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
      const ids = sh.getRange(1,1,sh.getLastRow(),1).getValues();
      for (let i = 1; i < ids.length; i++) {
        if (String(ids[i][0]).trim() === String(req.result.id).trim()) {
          const row = i + 1;
          const colMap = {"相手チーム":"opponent","試合形式":"formatLabel","第○試合":"gameNumber"};
          for (const [colName, key] of Object.entries(colMap)) {
            const ci = headers.indexOf(colName);
            if (ci >= 0 && req.result[key] !== undefined) {
              sh.getRange(row, ci+1).setValue(req.result[key]);
            }
          }
          return {};
        }
      }
      return {};
    }


    // ── AI テキスト生成（Geminiプロキシ） ──────────────────────
    case "aiGenerate": {
      const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
      if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY が設定されていません");
      const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" + GEMINI_API_KEY;
      const payload = {
        contents: [{ parts: [{ text: req.prompt }] }],
        generationConfig: { maxOutputTokens: 600 }
      };
      const resp = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      const data = JSON.parse(resp.getContentText());
      if (data.error) throw new Error(data.error.message || "Gemini API error");
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return { text };
    }

    // ── 配車取得 ─────────────────────────────────────────────
    case "getCarpool": {
      const rows = sheetToObjects("配車", MAPS.carpool);
      return { carpools: rows.filter(r => String(r.scheduleId) === String(req.scheduleId)) };
    }

    // ── 配車保存（upsert） ───────────────────────────────────
    case "saveCarpool": {
      const sh = getSheet("配車");
      if (!sh) return {};
      const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
      const sidCol = headers.indexOf("スケジュールID") + 1;
      const uidCol = headers.indexOf("ユーザーID") + 1;
      const lastRow = sh.getLastRow();
      if (lastRow >= 2) {
        const sids = sh.getRange(1,sidCol,lastRow,1).getValues();
        const uids = sh.getRange(1,uidCol,lastRow,1).getValues();
        for (let i = 1; i < lastRow; i++) {
          if (String(sids[i][0]) === String(req.scheduleId) &&
              String(uids[i][0]) === String(req.userId)) {
            const row = i + 1;
            const set = (col, val) => { const ci = headers.indexOf(col); if(ci>=0) sh.getRange(row,ci+1).setValue(val); };
            set("ユーザー名", req.userName||"");
            set("可否",       req.available||"");
            set("人数",       req.capacity||"");
            set("備考",       req.note||"");
            return {};
          }
        }
      }
      const newRow = headers.map(h => {
        if(h==="ID")           return genId();
        if(h==="スケジュールID") return req.scheduleId;
        if(h==="ユーザーID")    return req.userId;
        if(h==="ユーザー名")    return req.userName||"";
        if(h==="可否")          return req.available||"";
        if(h==="人数")          return req.capacity||"";
        if(h==="備考")          return req.note||"";
        return "";
      });
      sh.appendRow(newRow);
      return {};
    }

    default:
      throw new Error("不明なアクション: " + req.action);
  }
}

function previewFc2Schedule(url, year, month) {
  const targetUrl = String(url || "http://afcjr.web.fc2.com/").trim();
  const response = UrlFetchApp.fetch(targetUrl, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; GoogleAppsScript)"
    }
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("FC2サイトの取得に失敗しました (" + code + ")");
  }

  const html = decodeFc2Html(response);
  const rows = extractFc2Rows(html, Number(year), Number(month));
  return {
    items: rows.filter(r => includesThirdGrade(r.grade, r.title, r.note)),
    sourceTitle: extractHtmlTitle(html),
    fetchedUrl: targetUrl,
  };
}

function decodeFc2Html(response) {
  const bytes = response.getBlob().getBytes();
  const charsets = ["Shift_JIS", "UTF-8", "EUC-JP"];
  for (var i = 0; i < charsets.length; i++) {
    try {
      const text = Utilities.newBlob(bytes).getDataAsString(charsets[i]);
      if (text && /<table|<tr|<td/i.test(text)) return text;
    } catch (e) {}
  }
  return response.getContentText();
}

function extractHtmlTitle(html) {
  const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? cleanHtmlText(m[1]) : "";
}

function extractFc2Rows(html, year, month) {
  const rows = [];
  let currentMonth = Number(month) || (new Date().getMonth() + 1);
  const currentYear = Number(year) || new Date().getFullYear();
  const trList = String(html || "").match(/<tr\b[\s\S]*?<\/tr>/gi) || [];

  trList.forEach(tr => {
    const cells = tr.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) || [];
    if (cells.length < 5) return;
    const vals = cells.map(cleanHtmlText);

    const monthVal = toInt(vals[0]);
    const dayVal = toInt(vals[1]);
    const weekday = vals[2] || "";
    const content = vals[3] || "";
    const location = vals[4] || "";
    const grade = vals[5] || "";
    const note = vals[6] || "";
    if (!content) return;

    if (monthVal) currentMonth = monthVal;
    if (!dayVal || !currentMonth) return;

    rows.push({
      date: buildYmd(currentYear, currentMonth, dayVal),
      weekday,
      title: firstLine(content),
      content,
      location,
      grade,
      note,
      type: inferFc2Type(content),
    });
  });

  return rows;
}

function includesThirdGrade(grade, title, note) {
  const text = [grade, title, note].filter(Boolean).join(" ");
  if (!text) return false;
  if (/U[\s-]?9/i.test(text)) return true;
  if (/3\s*年|３\s*年|3年生|３年生/.test(text)) return true;

  const rangeRe = /([0-9０-９]+)\s*[-〜~]\s*([0-9０-９]+)\s*年/g;
  let m;
  while ((m = rangeRe.exec(text))) {
    const a = zenToHanInt(m[1]);
    const b = zenToHanInt(m[2]);
    if (!isNaN(a) && !isNaN(b)) {
      const max = Math.max(a, b);
      const min = Math.min(a, b);
      if (min <= 3 && 3 <= max) return true;
    }
  }

  const listRe = /([0-9０-９,\s、]+)年/g;
  while ((m = listRe.exec(text))) {
    const nums = String(m[1]).split(/[,、\s]+/).map(zenToHanInt).filter(n => !isNaN(n));
    if (nums.includes(3)) return true;
  }
  return false;
}

function inferFc2Type(content) {
  const text = String(content || "");
  if (/イベント|開会式|交流/.test(text)) return "event";
  if (/トレーニングマッチ|トレマ|練習試合/i.test(text)) return "training";
  if (/カップ|CUP|Cup/.test(text)) return "cup";
  if (/練習/.test(text)) return "practice";
  if (/リーグ|選手権|公式|大会/.test(text)) return "official";
  return "official";
}

function buildYmd(year, month, day) {
  return [
    String(year || new Date().getFullYear()),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-");
}

function firstLine(text) {
  return String(text || "").split(/\n+/).map(s => s.trim()).find(Boolean) || "";
}

function toInt(value) {
  const n = zenToHanInt(value);
  return isNaN(n) ? 0 : n;
}

function zenToHanInt(value) {
  const s = String(value || "").replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 65248));
  const m = s.match(/\d+/);
  return m ? Number(m[0]) : NaN;
}

function cleanHtmlText(html) {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, function(_, n) { return String.fromCharCode(Number(n)); });
}

