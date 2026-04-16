// ============================================================
// YouTube playlist sync (link-only mode)
// - Does NOT create schedules/results from videos.
// - Only links YouTube URLs to existing rows in "試合結果".
// ============================================================

const YOUTUBE_API_KEY = ""; // Optional. If empty, Script Property YOUTUBE_API_KEY is used.
const PLAYLIST_URLS = [
  "https://www.youtube.com/playlist?list=PLLo2VVDM0WelHQk4YEdf-dvejZLkVbJ2N",
];
const YOUTUBE_SYNC_TIMEZONE = "Asia/Tokyo";

const SHEET_RESULTS = "\u8a66\u5408\u7d50\u679c";
const SHEET_MEMBERS = "\u30e1\u30f3\u30d0\u30fc";
const SHEET_VIDEO_LOG = "\u52d5\u753b\u30ed\u30b0";

const HEADER_ID = "ID";
const HEADER_DATE = "\u65e5\u4ed8";
const HEADER_OPPONENT = "\u76f8\u624b\u30c1\u30fc\u30e0";
const HEADER_GAME_NUMBER = "\u7b2c\u25cb\u8a66\u5408";
const HEADER_SCHEDULE_ID = "\u30b9\u30b1\u30b8\u30e5\u30fc\u30ebID";

const COL_YT = "YouTubeURL";
const COL_YT_1ST = "\u524d\u534aURL";
const COL_YT_2ND = "\u5f8c\u534aURL";
const COL_YT_DESC = "YouTube\u6982\u8981";
const COL_YT_GOALS = "YouTube\u62bd\u51fa\u30b4\u30fc\u30eb";

const HALF_FIRST_JA = "\u524d\u534a";
const HALF_SECOND_JA = "\u5f8c\u534a";
const LABEL_GOAL = "\u5f97\u70b9";
const LABEL_CONCEDE = "\u5931\u70b9";

function syncYouTubePlaylist() {
  const ss = SpreadsheetApp.openById(getSpreadsheetIdForYoutube_());
  const resultSh = ss.getSheetByName(SHEET_RESULTS);
  const memberSh = ss.getSheetByName(SHEET_MEMBERS);
  if (!resultSh) throw new Error("Results sheet not found");

  const apiKey = getYoutubeApiKey_();
  const memberNames = loadMemberNames_(memberSh);

  const resultHeaders = resultSh.getRange(1, 1, 1, resultSh.getLastColumn()).getValues()[0].map(String);
  const col = {
    yt: ensureColumn_(resultSh, resultHeaders, COL_YT),
    yt1st: ensureColumn_(resultSh, resultHeaders, COL_YT_1ST),
    yt2nd: ensureColumn_(resultSh, resultHeaders, COL_YT_2ND),
    ytDesc: ensureColumn_(resultSh, resultHeaders, COL_YT_DESC),
    ytGoals: ensureColumn_(resultSh, resultHeaders, COL_YT_GOALS),
  };

  const results = loadResults_(resultSh, resultHeaders);

  let allVideos = [];
  PLAYLIST_URLS.forEach(url => {
    const playlistId = extractPlaylistId_(url);
    if (!playlistId) {
      Logger.log("Invalid playlist URL: " + url);
      return;
    }
    const fetched = fetchPlaylistVideos_(apiKey, playlistId, memberNames);
    Logger.log("playlist " + playlistId + " : " + fetched.length + " videos");
    allVideos = allVideos.concat(fetched);
  });

  allVideos = applyFallbackGameNumbers_(allVideos);
  writeVideoLog_(ss, allVideos);

  let matched = 0;
  let unmatched = 0;
  const newlyLinked = [];

  allVideos.forEach(video => {
    const parsed = video.parsedTitle || parseTitle_(video.title);
    if (!parsed) {
      unmatched++;
      return;
    }

    const result = findResult_(results, parsed);
    if (!result) {
      unmatched++;
      return;
    }

    const row = result.row;
    let targetCol = col.yt;
    if (parsed.half === HALF_FIRST_JA || parsed.half === "1st") targetCol = col.yt1st;
    if (parsed.half === HALF_SECOND_JA || parsed.half === "2nd") targetCol = col.yt2nd;

    const current = String(resultSh.getRange(row, targetCol).getValue() || "").trim();
    const goalLines = (video.parsedGoals || [])
      .map(g => `${g.team === "them" ? LABEL_CONCEDE : LABEL_GOAL} ${g.minute} ${g.scorer}${g.assist ? " (A:" + g.assist + ")" : ""}`)
      .join("\n");

    if (current !== video.url) {
      resultSh.getRange(row, targetCol).setValue(video.url);
      if (!current) newlyLinked.push({ title: video.title, url: video.url });
    }

    resultSh.getRange(row, col.ytDesc).setValue(video.description || "");
    resultSh.getRange(row, col.ytGoals).setValue(goalLines);
    matched++;
  });

  Logger.log("----------------------------------------");
  Logger.log("Videos total: " + allVideos.length);
  Logger.log("Linked: " + matched);
  Logger.log("Unmatched: " + unmatched);
  Logger.log("Schedule import: disabled");
  Logger.log("Result import: disabled");

  if (newlyLinked.length > 0 && typeof sendPushBroadcast === "function") {
    try {
      const preview = newlyLinked.slice(0, 2).map(v => v.title).join(" / ");
      sendPushBroadcast({
        title: "YouTube links updated",
        body: newlyLinked.length > 2 ? `${preview} +${newlyLinked.length - 2} more` : preview,
        url: "/?source=push",
      });
    } catch (e) {
      Logger.log("Push failed: " + e);
    }
  }
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
  return {
    date,
    opponent,
    gameNumber: gameNumber ? String(gameNumber) : "",
    half,
    raw: t,
  };
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
    .replace(/(?:前半|後半|1st|2nd|3rd|第\d+試合|\d+本目|TM|トレマ)\s*$/i, "")
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

function loadResults_(resultSh, headers) {
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
  })).filter(r => r.id);
}

function findResult_(results, parsed) {
  const rows = Array.isArray(results) ? results : [];
  const date = normalizeDate_(parsed.date);
  const gameNumber = String(parsed.gameNumber || "").trim();
  const opponent = cleanOpponent_(parsed.opponent || "");

  if (date && gameNumber) {
    const byGame = rows.find(r =>
      normalizeDate_(r.date) === date &&
      String(r.gameNumber || "").trim() === gameNumber
    );
    if (byGame) return byGame;
  }

  if (date && opponent) {
    const byOpp = rows.find(r =>
      normalizeDate_(r.date) === date &&
      normalizeText_(cleanOpponent_(r.opponent || "")) === normalizeText_(opponent)
    );
    if (byOpp) return byOpp;
  }

  if (date) {
    const byDate = rows.filter(r => normalizeDate_(r.date) === date);
    if (byDate.length === 1) return byDate[0];
  }

  return null;
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
