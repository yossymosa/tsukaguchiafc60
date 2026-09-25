// ============================================================
// YouTube recording-file sync
// - App-generated AFC_ recording filenames are the only matching key.
// - Does NOT create schedules/results or inspect historical title text.
// - Updates the matched video's existing title/description template, then links it.
// ============================================================

const YOUTUBE_API_KEY = ""; // Optional. If empty, Script Property YOUTUBE_API_KEY is used.
const PLAYLIST_URLS = [
  "https://www.youtube.com/playlist?list=PLLo2VVDM0WenwtPBIdaiRfcqji7Q5hlor",
  "https://www.youtube.com/playlist?list=PLLo2VVDM0WelHQk4YEdf-dvejZLkVbJ2N",
];
const YOUTUBE_SYNC_TIMEZONE = "Asia/Tokyo";

const SHEET_RESULTS = "\u8a66\u5408\u7d50\u679c";
const SHEET_SCHEDULES = "\u30b9\u30b1\u30b8\u30e5\u30fc\u30eb";
const SHEET_MEMBERS = "\u30e1\u30f3\u30d0\u30fc";
const SHEET_VIDEO_LOG = "\u52d5\u753b\u30ed\u30b0";

const HEADER_ID = "ID";
const HEADER_DATE = "\u65e5\u4ed8";
const HEADER_OPPONENT = "\u76f8\u624b\u30c1\u30fc\u30e0";
const HEADER_GAME_NUMBER = "\u7b2c\u25cb\u8a66\u5408";
const HEADER_SCHEDULE_ID = "\u30b9\u30b1\u30b8\u30e5\u30fc\u30ebID";
const HEADER_SCHEDULE_TITLE = "\u8a66\u5408\u5206\u985e";

const COL_YT = "YouTubeURL";
const COL_YT_1ST = "\u524d\u534aURL";
const COL_YT_2ND = "\u5f8c\u534aURL";
const COL_YT_PK = "PK\u6226URL";
const COL_YT_RECORDINGS = "YouTube\u64ae\u5f71\u30d5\u30a1\u30a4\u30eb";
const COL_YT_DESC = "YouTube\u6982\u8981";
const COL_YT_GOALS = "YouTube\u62bd\u51fa\u30b4\u30fc\u30eb";

const HALF_FIRST_JA = "\u524d\u534a";
const HALF_SECOND_JA = "\u5f8c\u534a";
const HALF_PK = "pk";
const LABEL_GOAL = "\u5f97\u70b9";
const LABEL_CONCEDE = "\u5931\u70b9";

// ============================================================
// アプリで登録した動画URLへ、既存のYouTubeテンプレのタイトル・
// 概要欄を反映する。YouTube Data API の高度なサービスを有効にした
// Apps Script プロジェクトでのみ実行できる。
// ============================================================
function updateYoutubeMetadataFromApp_(req) {
  if (typeof YouTube === "undefined" || !YouTube.Videos) {
    throw new Error("YouTube API連携が未設定です。Apps Scriptの「サービス」で YouTube Data API を追加し、Google Cloud 側でも YouTube Data API v3 を有効にしてください");
  }

  const videos = Array.isArray(req && req.videos) ? req.videos : [];
  if (!videos.length) throw new Error("反映する動画URLがありません");

  const seen = {};
  const updatedVideos = [];
  videos.forEach((raw, index) => {
    const videoId = extractYoutubeVideoIdForMetadata_(raw && raw.url);
    if (!videoId) throw new Error((index + 1) + "件目のYouTube URLが正しくありません");
    if (seen[videoId]) return;
    seen[videoId] = true;

    const title = String(raw && raw.title || "").trim();
    const description = String(raw && raw.description || "");
    if (!title) throw new Error("YouTubeタイトルが空です");
    if (title.length > 100) throw new Error("YouTubeタイトルは100文字以内にしてください: " + title);
    if (Utilities.newBlob(description).getBytes().length > 5000) {
      throw new Error("YouTube概要欄は5000バイト以内にしてください: " + title);
    }

    try {
      // snippetを丸ごと更新するため、既存のカテゴリ・タグ・言語は保持する。
      const lookup = YouTube.Videos.list("snippet", {id: videoId, maxResults: 1});
      const current = lookup && lookup.items && lookup.items[0];
      if (!current || !current.snippet) {
        throw new Error("対象動画が見つかりません。チャンネル所有者のGoogleアカウントで認可されているか確認してください");
      }
      const currentSnippet = current.snippet || {};
      const snippet = {
        title: title,
        description: description,
        categoryId: String(currentSnippet.categoryId || "17"),
      };
      if (Array.isArray(currentSnippet.tags)) snippet.tags = currentSnippet.tags.slice();
      if (currentSnippet.defaultLanguage) snippet.defaultLanguage = String(currentSnippet.defaultLanguage);

      YouTube.Videos.update({id: videoId, snippet: snippet}, "snippet");
      updatedVideos.push({videoId: videoId, title: title, label: String(raw && raw.label || "")});
    } catch (err) {
      const message = String(err && err.message || err || "不明なエラー");
      throw new Error("YouTube更新に失敗しました（" + title + "）: " + message);
    }
  });

  return {updatedCount: updatedVideos.length, updatedVideos: updatedVideos};
}

function extractYoutubeVideoIdForMetadata_(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const patterns = [
    /(?:youtube\.com|youtube-nocookie\.com)\/watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]{11})(?:[&#?]|$)/i,
    /(?:youtube\.com|youtube-nocookie\.com)\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:[?#/]|$)/i,
    /youtu\.be\/([A-Za-z0-9_-]{11})(?:[?#/]|$)/i,
  ];
  let id = "";
  for (let i = 0; i < patterns.length; i++) {
    const match = raw.match(patterns[i]);
    if (match && match[1]) {
      id = match[1];
      break;
    }
  }
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
}

function syncYouTubePlaylist() {
  const ss = SpreadsheetApp.openById(getSpreadsheetIdForYoutube_());
  const resultSh = ss.getSheetByName(SHEET_RESULTS);
  const scheduleSh = ss.getSheetByName(SHEET_SCHEDULES);
  if (!resultSh) throw new Error("Results sheet not found");
  const resultHeaders = resultSh.getRange(1, 1, 1, resultSh.getLastColumn()).getValues()[0].map(String);
  const col = {
    yt: ensureColumn_(resultSh, resultHeaders, COL_YT),
    yt1st: ensureColumn_(resultSh, resultHeaders, COL_YT_1ST),
    yt2nd: ensureColumn_(resultSh, resultHeaders, COL_YT_2ND),
    ytPk: ensureColumn_(resultSh, resultHeaders, COL_YT_PK),
    recordings: ensureColumn_(resultSh, resultHeaders, COL_YT_RECORDINGS),
  };
  const planned = loadYoutubeRecordingPlans_(resultSh, resultHeaders);
  const plannedKeys = Object.keys(planned);
  if (!plannedKeys.length) return {linkedCount: 0, pendingCount: 0, updatedResults: []};

  const scheduleDetails = loadYoutubeScheduleDetails_(scheduleSh);
  const goalsByResult = loadYoutubeGoalsByResult_(ss.getSheetByName("得点記録"));
  const recentVideos = fetchRecentOwnedYoutubeVideosWithFiles_();
  const linkedKeys = {};
  const updatesByResult = {};
  let linkedCount = 0;

  recentVideos.forEach(video => {
    const fileKey = normalizeYoutubeRecordingFileName_(video.fileName);
    const plan = planned[fileKey];
    if (!plan || linkedKeys[fileKey]) return;

    const targetCol = plan.key === "first" ? col.yt1st : plan.key === "second" ? col.yt2nd : plan.key === "pk" ? col.ytPk : col.yt;
    const currentUrl = String(resultSh.getRange(plan.row, targetCol).getValue() || "").trim();
    if (currentUrl) {
      linkedKeys[fileKey] = true;
      return;
    }

    const context = buildYoutubeResultContext_(resultSh, resultHeaders, plan.row, scheduleDetails, goalsByResult);
    const metadata = buildYoutubeMetadataForRecording_(context, plan.key, video.url);
    // YouTube側のタイトル・概要欄が更新できた動画だけをアプリへリンクする。
    updateYoutubeMetadataFromApp_({videos: [metadata]});
    resultSh.getRange(plan.row, targetCol).setValue(video.url);
    linkedKeys[fileKey] = true;
    linkedCount++;
    updatesByResult[plan.resultId] = {
      ...(updatesByResult[plan.resultId] || {id: plan.resultId}),
      [plan.key === "first" ? "youtubeUrl1st" : plan.key === "second" ? "youtubeUrl2nd" : plan.key === "pk" ? "youtubeUrlPk" : "youtubeUrl"]: video.url,
    };
  });

  const pendingCount = plannedKeys.filter(key => !linkedKeys[key]).length;
  Logger.log("YouTube recording sync: linked=" + linkedCount + ", pending=" + pendingCount);
  return {linkedCount: linkedCount, pendingCount: pendingCount, updatedResults: Object.keys(updatesByResult).map(id => updatesByResult[id])};
}

function loadYoutubeRecordingPlans_(resultSh, headers) {
  const idIndex = headers.indexOf(HEADER_ID);
  const recordingIndex = headers.indexOf(COL_YT_RECORDINGS);
  if (idIndex < 0 || recordingIndex < 0 || resultSh.getLastRow() < 2) return {};
  const rows = resultSh.getRange(2, 1, resultSh.getLastRow() - 1, resultSh.getLastColumn()).getValues();
  const plans = {};
  rows.forEach((row, index) => {
    const resultId = String(row[idIndex] || "").trim();
    if (!resultId) return;
    let recordingFiles = {};
    try { recordingFiles = JSON.parse(String(row[recordingIndex] || "{}")); } catch (e) { recordingFiles = {}; }
    ["full", "first", "second", "pk"].forEach(key => {
      const fileName = String(recordingFiles && recordingFiles[key] && recordingFiles[key].fileName || "").trim();
      const fileKey = normalizeYoutubeRecordingFileName_(fileName);
      if (!fileKey || !/^AFC_/.test(fileKey) || plans[fileKey]) return;
      plans[fileKey] = {resultId: resultId, row: index + 2, key: key, fileName: fileName};
    });
  });
  return plans;
}

function normalizeYoutubeRecordingFileName_(value) {
  return String(value || "")
    .trim()
    .split(/[\\/]/)
    .pop()
    .replace(/\.[^.]+$/, "")
    .toUpperCase();
}

function fetchRecentOwnedYoutubeVideosWithFiles_() {
  if (typeof YouTube === "undefined" || !YouTube.Channels || !YouTube.PlaylistItems || !YouTube.Videos) {
    throw new Error("YouTube API連携が未設定です。Apps Scriptの「サービス」で YouTube Data API を追加してください");
  }
  const channelResponse = YouTube.Channels.list("contentDetails", {mine: true, maxResults: 1});
  const channel = channelResponse && channelResponse.items && channelResponse.items[0];
  const uploadsPlaylistId = channel && channel.contentDetails && channel.contentDetails.relatedPlaylists && channel.contentDetails.relatedPlaylists.uploads;
  if (!uploadsPlaylistId) throw new Error("チームYouTubeチャンネルのアップロード一覧を取得できません。チャンネル所有者アカウントで認可してください");
  const playlistResponse = YouTube.PlaylistItems.list("snippet", {playlistId: uploadsPlaylistId, maxResults: 50});
  const ids = (playlistResponse && playlistResponse.items || [])
    .map(item => item && item.snippet && item.snippet.resourceId && item.snippet.resourceId.videoId)
    .filter(Boolean);
  if (!ids.length) return [];
  const detailResponse = YouTube.Videos.list("snippet,fileDetails,processingDetails", {id: ids.join(",")});
  return (detailResponse && detailResponse.items || []).map(item => ({
    id: String(item.id || ""),
    url: "https://www.youtube.com/watch?v=" + String(item.id || ""),
    fileName: String(item.fileDetails && item.fileDetails.fileName || ""),
    title: String(item.snippet && item.snippet.title || ""),
  })).filter(item => item.id && item.fileName);
}

function loadYoutubeScheduleDetails_(scheduleSh) {
  if (!scheduleSh || scheduleSh.getLastRow() < 2) return {};
  const headers = scheduleSh.getRange(1, 1, 1, scheduleSh.getLastColumn()).getValues()[0].map(String);
  const idIndex = headers.indexOf(HEADER_ID);
  const titleIndex = headers.indexOf(HEADER_SCHEDULE_TITLE);
  const locationIndex = headers.indexOf("場所");
  const typeIndex = headers.indexOf("種類");
  const rows = scheduleSh.getRange(2, 1, scheduleSh.getLastRow() - 1, scheduleSh.getLastColumn()).getValues();
  return rows.reduce((map, row) => {
    const id = String(idIndex >= 0 ? row[idIndex] : "").trim();
    if (id) map[id] = {
      title: String(titleIndex >= 0 ? row[titleIndex] : "").trim(),
      location: String(locationIndex >= 0 ? row[locationIndex] : "").trim(),
      type: String(typeIndex >= 0 ? row[typeIndex] : "").trim(),
    };
    return map;
  }, {});
}

function loadYoutubeGoalsByResult_(goalSh) {
  if (!goalSh || goalSh.getLastRow() < 2) return {};
  const headers = goalSh.getRange(1, 1, 1, goalSh.getLastColumn()).getValues()[0].map(String);
  const indexOf = name => headers.indexOf(name);
  const idx = {
    resultId: indexOf("試合ID"), half: indexOf("前半/後半"), minute: indexOf("時間(分)"), second: indexOf("時間(秒)"),
    scorerName: indexOf("メンバー名（ゴール）"), assistName: indexOf("メンバー名（アシスト）"),
    team: indexOf("チーム区分"), goalType: indexOf("得点種別"),
  };
  const rows = goalSh.getRange(2, 1, goalSh.getLastRow() - 1, goalSh.getLastColumn()).getValues();
  return rows.reduce((map, row) => {
    const resultId = String(idx.resultId >= 0 ? row[idx.resultId] : "").trim();
    if (!resultId) return map;
    if (!map[resultId]) map[resultId] = [];
    map[resultId].push({
      half: String(idx.half >= 0 ? row[idx.half] : ""), minute: Number(idx.minute >= 0 ? row[idx.minute] : 0) || 0,
      second: Number(idx.second >= 0 ? row[idx.second] : 0) || 0,
      scorerName: String(idx.scorerName >= 0 ? row[idx.scorerName] : "").trim(),
      assistName: String(idx.assistName >= 0 ? row[idx.assistName] : "").trim(),
      team: String(idx.team >= 0 ? row[idx.team] : "").trim(),
      goalType: String(idx.goalType >= 0 ? row[idx.goalType] : "").trim(),
    });
    return map;
  }, {});
}

function buildYoutubeResultContext_(resultSh, headers, row, scheduleDetails, goalsByResult) {
  const value = name => {
    const index = headers.indexOf(name);
    return index >= 0 ? resultSh.getRange(row, index + 1).getValue() : "";
  };
  const resultId = String(value("ID") || "").trim();
  const scheduleId = String(value(HEADER_SCHEDULE_ID) || "").trim();
  const schedule = scheduleDetails[scheduleId] || {};
  return {
    id: resultId,
    date: value(HEADER_DATE),
    opponent: String(value(HEADER_OPPONENT) || "").trim(),
    gameNumber: String(value(HEADER_GAME_NUMBER) || "").trim(),
    type: String(value("種類") || schedule.type || "").trim(),
    scheduleTitle: String(schedule.title || "").trim(),
    location: String(schedule.location || "").trim(),
    goals: goalsByResult[resultId] || [],
    pkOur: value("PK塚口"), pkTheir: value("PK相手"),
    pkKickers: value("PKキッカー"), pkTheirSeq: value("PK相手シーケンス"),
  };
}

function buildYoutubeMetadataForRecording_(context, key, videoUrl) {
  const half = key === "first" ? "1st" : key === "second" ? "2nd" : key === "pk" ? "PK戦" : "";
  return {
    label: key === "first" ? "1st" : key === "second" ? "2nd" : key === "pk" ? "PK" : "通し",
    url: videoUrl,
    title: makeYoutubeTitleFromContext_(context, half),
    description: key === "pk" ? makeYoutubePkDescriptionFromContext_(context) : makeYoutubeDescriptionFromContext_(context, half),
  };
}

function formatYoutubeDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, YOUTUBE_SYNC_TIMEZONE, "yyyy/M/d");
  const m = String(value || "").match(/(20\d{2})[^0-9]?(\d{1,2})[^0-9]?(\d{1,2})/);
  return m ? m[1] + "/" + Number(m[2]) + "/" + Number(m[3]) : "";
}

function youtubeTypeLabel_(type) {
  const raw = String(type || "").trim();
  return ({
    "practice":"練習", "official":"公式戦", "training":"トレマ", "cup":"カップ戦", "event":"イベント",
    "練習":"練習", "公式戦":"公式戦", "トレマ":"トレマ", "練習試合":"トレマ", "トレーニングマッチ":"トレマ", "カップ戦":"カップ戦"
  })[raw] || raw;
}

function makeYoutubeTitleFromContext_(context, half) {
  const tournament = String(context.scheduleTitle || "").trim();
  return [
    formatYoutubeDate_(context.date), tournament ? "【" + tournament + "】" : "", "VS", context.opponent || "",
    youtubeTypeLabel_(context.type), context.gameNumber ? "第" + context.gameNumber + "試合" : "", half || "",
    context.location ? "@" + context.location : ""
  ].filter(Boolean).join(" ");
}

function normalizeYoutubeHalf_(value) {
  const raw = String(value || "").trim();
  if (/^(1st|前半|first|1)$/i.test(raw)) return "1st";
  if (/^(2nd|後半|second|2)$/i.test(raw)) return "2nd";
  if (/^(3rd|third|3|3本目|三本目)$/i.test(raw)) return "3rd";
  return "";
}

function youtubeHalfOrder_(value) {
  const half = normalizeYoutubeHalf_(value);
  return half === "1st" ? 0 : half === "2nd" ? 1 : half === "3rd" ? 2 : 99;
}

function youtubeTimeLabel_(minute, second) {
  return (Number(minute) || 0) + ":" + String(Number(second) || 0).padStart(2, "0");
}

function makeYoutubeDescriptionFromContext_(context, half) {
  const halfKey = normalizeYoutubeHalf_(half);
  const goals = context.goals || [];
  const count = (team, targetHalf) => goals.filter(goal => {
    if (team === "us" ? String(goal.team || "") === "them" : String(goal.team || "") !== "them") return false;
    return !targetHalf || normalizeYoutubeHalf_(goal.half) === targetHalf;
  }).length;
  const allOur = count("us", ""), allTheir = count("them", "");
  const h1Our = count("us", "1st"), h1Their = count("them", "1st");
  const h2Our = count("us", "2nd"), h2Their = count("them", "2nd");
  const h3Our = count("us", "3rd"), h3Their = count("them", "3rd");
  const has3rd = h3Our + h3Their > 0;
  const scoreLine = "塚口AFC " + allOur + " - " + allTheir + " " + context.opponent
    + "\n1st " + h1Our + "-" + h1Their + "  2nd " + h2Our + "-" + h2Their
    + (has3rd ? "  3rd " + h3Our + "-" + h3Their : "");
  const events = goals.filter(goal => !halfKey || normalizeYoutubeHalf_(goal.half) === halfKey)
    .map(goal => {
      const own = String(goal.team || "") !== "them";
      const type = goal.goalType && goal.goalType !== "通常" ? "(" + goal.goalType + ")" : "";
      const text = own
        ? youtubeTimeLabel_(goal.minute, goal.second) + " [得点]" + (goal.scorerName || "不明") + type + (goal.assistName ? " アシスト " + goal.assistName : "")
        : youtubeTimeLabel_(goal.minute, goal.second) + " 失点" + type;
      return {half: youtubeHalfOrder_(goal.half), minute: Number(goal.minute) || 0, second: Number(goal.second) || 0, text: text};
    }).sort((a, b) => a.half - b.half || a.minute - b.minute || a.second - b.second);
  return scoreLine + "\n\n" + ["0:00 スタート"].concat(events.map(event => event.text)).join("\n");
}

function parseYoutubeJsonArray_(value) {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed : []; } catch (e) { return []; }
}

function makeYoutubePkDescriptionFromContext_(context) {
  const kickers = parseYoutubeJsonArray_(context.pkKickers);
  const theirSeq = parseYoutubeJsonArray_(context.pkTheirSeq);
  const our = kickers.length ? kickers.filter(kicker => kicker && kicker.success).length : (Number(context.pkOur) || 0);
  const their = theirSeq.length ? theirSeq.filter(Boolean).length : (Number(context.pkTheir) || 0);
  const opponent = String(context.opponent || "相手").trim();
  return [
    "塚口AFC " + our + " - " + their + " " + opponent,
    "",
    "0:00 PK戦スタート",
    kickers.length ? "塚口AFC " + kickers.map(kicker => kicker && kicker.success ? "○" : "×").join("") : "",
    theirSeq.length ? opponent + " " + theirSeq.map(success => success ? "○" : "×").join("") : ""
  ].filter(Boolean).join("\n");
}

function installYouTubeSyncTrigger() {
  const fn = "syncYouTubePlaylist";
  const exists = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === fn);
  if (exists) {
    Logger.log("Trigger already exists");
    return;
  }
  ScriptApp.newTrigger(fn).timeBased().everyHours(1).create();
  Logger.log("YouTube sync trigger created");
}

function removeYouTubeSyncTrigger() {
  const fn = "syncYouTubePlaylist";
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === fn)
    .forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log("YouTube sync trigger removed");
}

function getSpreadsheetIdForYoutube_() {
  if (typeof SPREADSHEET_ID !== "undefined" && SPREADSHEET_ID) return SPREADSHEET_ID;
  const prop = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (prop) return prop;
  throw new Error("SPREADSHEET_ID is not set");
}

function getYoutubeApiKey_() {
  const inline = String(YOUTUBE_API_KEY || "").trim();
  if (inline) return inline;
  const prop = String(PropertiesService.getScriptProperties().getProperty("YOUTUBE_API_KEY") || "").trim();
  if (prop) return prop;
  throw new Error("YOUTUBE_API_KEY is not set");
}

function ensureColumn_(sh, headers, colName) {
  let idx = headers.indexOf(colName);
  if (idx === -1) {
    sh.getRange(1, sh.getLastColumn() + 1).setValue(colName);
    headers.push(colName);
    idx = headers.length - 1;
  }
  return idx + 1;
}

function loadMemberNames_(memberSh) {
  if (!memberSh || memberSh.getLastRow() < 2) return [];
  const rows = memberSh.getRange(2, 1, memberSh.getLastRow() - 1, memberSh.getLastColumn()).getValues();
  return rows.map(r => normalizeName_(r[1] || "")).filter(Boolean);
}

function fetchPlaylistVideos_(apiKey, playlistId, memberNames) {
  const videos = [];
  let pageToken = "";
  let guard = 0;

  do {
    guard++;
    let url = "https://www.googleapis.com/youtube/v3/playlistItems"
      + "?part=snippet"
      + "&playlistId=" + encodeURIComponent(playlistId)
      + "&maxResults=50"
      + "&key=" + encodeURIComponent(apiKey);
    if (pageToken) url += "&pageToken=" + encodeURIComponent(pageToken);

    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const json = JSON.parse(res.getContentText() || "{}");
    if (json.error) {
      throw new Error("YouTube API error: " + (json.error.message || "unknown"));
    }

    (json.items || []).forEach(item => {
      const snippet = item.snippet || {};
      const videoId = snippet.resourceId && snippet.resourceId.videoId;
      if (!videoId) return;
      const title = String(snippet.title || "");
      const description = String(snippet.description || "");
      const parsedTitle = parseTitle_(title);
      const parsedGoals = parseGoalsFromDescription_(description, memberNames);
      videos.push({
        title,
        description,
        url: "https://www.youtube.com/watch?v=" + videoId,
        publishedAt: snippet.publishedAt ? snippet.publishedAt.slice(0, 10) : "",
        parsedTitle,
        parsedGoals,
      });
    });

    pageToken = json.nextPageToken || "";
  } while (pageToken && guard < 30);

  return videos;
}

function parseTitle_(title) {
  const t = String(title || "");
  const date = extractDateFromText_(t);
  if (!date) return null;
  const opponent = cleanOpponent_(extractOpponent_(t));
  const gameNumber = extractGameNumber_(t);
  const half = extractHalf_(t);
  const tournament = extractTournamentTitle_(t);
  return {
    date,
    opponent,
    gameNumber: gameNumber ? String(gameNumber) : "",
    half,
    tournament,
    raw: t,
  };
}

function extractTournamentTitle_(text) {
  const m = String(text || "").match(/[【\[]([^】\]]+)[】\]]/);
  return m ? String(m[1] || "").trim() : "";
}

function extractDateFromText_(text) {
  const t = String(text || "");
  let m = t.match(/(\d{4})[\/\-年\.](\d{1,2})[\/\-月\.](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  m = t.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return "";
}

function extractOpponent_(text) {
  const t = String(text || "");
  const m = t.match(/(?:\bvs\b|VS|Vs|ｖｓ|ＶＳ)\s*([^\|\[\]【】()（）@＠]+)/i);
  return m ? String(m[1] || "").trim() : "";
}

function cleanOpponent_(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .replace(/(?:PK\s*戦|ＰＫ\s*戦|penalty\s*shootout)\s*$/i, "")
    .replace(/(?:前半|後半|1st|2nd|3rd|第\d+試合|\d+本目|TM|トレマ)\s*$/i, "")
    .replace(/(?:公式戦|カップ戦|練習試合|トレマ|TM)\s*$/i, "")
    .trim();
}

function extractGameNumber_(text) {
  const t = String(text || "");
  let m = t.match(/第\s*(\d+)\s*試合/i);
  if (m) return Number(m[1] || 0);
  m = t.match(/(\d+)\s*本目/i);
  if (m) return Number(m[1] || 0);
  return 0;
}

function extractHalf_(text) {
  const t = String(text || "");
  if (/PK\s*戦|ＰＫ\s*戦|penalty\s*shootout/i.test(t)) return HALF_PK;
  if (/前半|1st/i.test(t)) return "1st";
  if (/後半|2nd/i.test(t)) return "2nd";
  if (/3rd/i.test(t)) return "3rd";
  return "";
}

function applyFallbackGameNumbers_(videos) {
  const grouped = {};
  (videos || []).forEach(v => {
    const p = v.parsedTitle || parseTitle_(v.title) || {};
    if (!p.date) return;
    if (!grouped[p.date]) grouped[p.date] = [];
    grouped[p.date].push(v);
  });

  Object.keys(grouped).forEach(date => {
    const rows = grouped[date].sort((a, b) =>
      String(a.publishedAt || "").localeCompare(String(b.publishedAt || ""))
      || String(a.title || "").localeCompare(String(b.title || ""))
    );
    let nextNo = 1;
    rows.forEach(v => {
      const p = v.parsedTitle || parseTitle_(v.title) || {};
      if (!p.gameNumber) {
        // PK動画だけでは何試合目かを安全に推測できない。タイトルに第○試合を
        // 付けるか、日付＋相手が一意に一致する場合だけfindResult_で紐付ける。
        if (p.half === HALF_PK) return;
        p.gameNumber = String(nextNo++);
        v.parsedTitle = p;
      } else {
        const n = Number(p.gameNumber || 0);
        if (n >= nextNo) nextNo = n + 1;
      }
    });
  });

  return videos;
}

function parseGoalsFromDescription_(description, memberNames) {
  const lines = String(description || "").split(/\r?\n/).map(s => String(s || "").trim()).filter(Boolean);
  const goals = [];

  lines.forEach(line => {
    if (/0:00/.test(line)) return;
    if (/\u30b9\u30bf\u30fc\u30c8|\u30ab\u30ec\u30ea\u30f3|\u304a\u3057\u3044|\u30ca\u30a4\u30b9\u30bb\u30fc\u30d6|\u5927\u30d4\u30f3\u30c1/i.test(line)) return;
    const m = line.match(/(\d{1,2}:\d{2})\s*(.+)$/);
    if (!m) return;
    const minute = m[1];
    const text = String(m[2] || "").trim();
    if (!text) return;

    const team = /\u5931\u70b9/i.test(text) ? "them" : "us";
    const cleaned = text.replace(/^\u5931\u70b9[:：]?\s*/i, "").trim();
    if (!cleaned) return;

    let assist = "";
    let scorer = cleaned;
    if (/[→\-＞>]/.test(cleaned)) {
      const parts = cleaned.split(/[→\-＞>]+/).map(s => String(s || "").trim()).filter(Boolean);
      if (parts.length >= 2) {
        assist = normalizeName_(parts[0]);
        scorer = normalizeName_(parts[parts.length - 1]);
      }
    } else {
      scorer = normalizeName_(cleaned.split(/\s+/)[0] || cleaned);
    }

    if (!scorer) return;
    const scorerInTeam = !memberNames || memberNames.length === 0 || memberNames.indexOf(scorer) >= 0;
    if (team === "us" && !scorerInTeam) return;

    goals.push({ team, minute, scorer, assist, raw: line });
  });

  return goals;
}

function writeVideoLog_(ss, videos) {
  let sh = ss.getSheetByName(SHEET_VIDEO_LOG);
  if (!sh) sh = ss.insertSheet(SHEET_VIDEO_LOG);
  sh.clearContents();
  sh.appendRow([
    "Title", "URL", "PublishedAt", "Date", "Opponent", "GameNo", "Half", "Description", "ExtractedGoals",
  ]);

  (videos || []).forEach(v => {
    const p = v.parsedTitle || parseTitle_(v.title) || {};
    sh.appendRow([
      v.title || "",
      v.url || "",
      v.publishedAt || "",
      p.date || "",
      p.opponent || "",
      p.gameNumber || "",
      p.half || "",
      v.description || "",
      (v.parsedGoals || []).map(g => `${g.team === "them" ? LABEL_CONCEDE : LABEL_GOAL} ${g.minute} ${g.scorer}${g.assist ? " (A:" + g.assist + ")" : ""}`).join("\n"),
    ]);
  });

  if (sh.getLastColumn() > 0) sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight("bold");
  sh.setFrozenRows(1);
}

function loadScheduleTitles_(scheduleSh) {
  if (!scheduleSh || scheduleSh.getLastRow() < 2) return {};
  const headers = scheduleSh.getRange(1, 1, 1, scheduleSh.getLastColumn()).getValues()[0].map(String);
  const idIdx = headers.indexOf(HEADER_ID);
  const titleIdx = headers.indexOf(HEADER_SCHEDULE_TITLE);
  if (idIdx < 0 || titleIdx < 0) return {};
  const rows = scheduleSh.getRange(2, 1, scheduleSh.getLastRow() - 1, scheduleSh.getLastColumn()).getValues();
  return rows.reduce((map, row) => {
    const id = String(row[idIdx] || "").trim();
    if (id) map[id] = String(row[titleIdx] || "").trim();
    return map;
  }, {});
}

function loadResults_(resultSh, headers, scheduleTitles={}) {
  if (!resultSh || resultSh.getLastRow() < 2) return [];
  const rows = resultSh.getRange(2, 1, resultSh.getLastRow() - 1, resultSh.getLastColumn()).getValues();
  const idIdx = headers.indexOf(HEADER_ID);
  const dateIdx = headers.indexOf(HEADER_DATE);
  const oppIdx = headers.indexOf(HEADER_OPPONENT);
  const gameIdx = headers.indexOf(HEADER_GAME_NUMBER);
  const sidIdx = headers.indexOf(HEADER_SCHEDULE_ID);

  return rows.map((r, i) => ({
    row: i + 2,
    id: String(idIdx >= 0 ? r[idIdx] : ""),
    date: normalizeDate_(dateIdx >= 0 ? r[dateIdx] : ""),
    opponent: String(oppIdx >= 0 ? r[oppIdx] : ""),
    gameNumber: String(gameIdx >= 0 ? r[gameIdx] : ""),
    scheduleId: String(sidIdx >= 0 ? r[sidIdx] : ""),
    scheduleTitle: String(scheduleTitles[String(sidIdx >= 0 ? r[sidIdx] : "") || ""] || ""),
  })).filter(r => r.id);
}

function findResult_(results, parsed) {
  const rows = Array.isArray(results) ? results : [];
  const date = normalizeDate_(parsed.date);
  const gameNumber = String(parsed.gameNumber || "").trim();
  const opponent = cleanOpponent_(parsed.opponent || "");
  const tournament = String(parsed.tournament || "").trim();
  if (!date) return null;

  let candidates = rows.filter(r => normalizeDate_(r.date) === date);
  if (opponent) {
    candidates = candidates.filter(r =>
      normalizeText_(cleanOpponent_(r.opponent || "")) === normalizeText_(opponent)
    );
  }
  if (gameNumber) {
    candidates = candidates.filter(r => String(r.gameNumber || "").trim() === gameNumber);
  }
  if (tournament) {
    candidates = candidates.filter(r =>
      normalizeText_(r.scheduleTitle || "") === normalizeText_(tournament)
    );
  }

  // 同日・別大会で候補が複数残る場合は、誤った試合へ紐付けない。
  return candidates.length === 1 ? candidates[0] : null;
}

function extractPlaylistId_(url) {
  const m = String(url || "").match(/[?&]list=([^&]+)/);
  return m ? m[1] : "";
}

function normalizeDate_(v) {
  if (!v) return "";
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, YOUTUBE_SYNC_TIMEZONE, "yyyy-MM-dd");
  }
  const s = String(v || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, YOUTUBE_SYNC_TIMEZONE, "yyyy-MM-dd");
  return s;
}

function normalizeText_(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .toLowerCase()
    .trim();
}

function normalizeName_(s) {
  return String(s || "")
    .replace(/\s+/g, "")
    .replace(/[()（）【】\[\]]/g, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .trim();
}
