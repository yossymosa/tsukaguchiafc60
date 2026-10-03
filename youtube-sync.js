// ============================================================
// YouTube title sync
// - YouTubeのタイトルから既存の試合結果だけを特定してリンクする。
// - 動画ファイルをアプリで選択・読み込みしない。
// - YouTube上で入力したタイトル・概要欄・公開設定は変更しない。
// ============================================================

const YOUTUBE_API_KEY = ""; // Optional. If empty, Script Property YOUTUBE_API_KEY is used.
const PLAYLIST_URLS = [
  "https://www.youtube.com/playlist?list=PLLo2VVDM0WenwtPBIdaiRfcqji7Q5hlor",
  "https://www.youtube.com/playlist?list=PLLo2VVDM0WelHQk4YEdf-dvejZLkVbJ2N",
];
const YOUTUBE_SYNC_TIMEZONE = "Asia/Tokyo";
// YouTubeへ反映する共通の公開設定。動画URLを直接反映する場合も、
// ファイル名で一括同期する場合も同じ設定を適用する。
const YOUTUBE_TARGET_PRIVACY_STATUS = "unlisted";
const YOUTUBE_TARGET_MADE_FOR_KIDS = false;
const YOUTUBE_TARGET_PLAYLIST_TITLE = "26年度　塚口AFCjr　60期生　試合動画　（4年生）";
const YOUTUBE_TARGET_PLAYLIST_DESCRIPTION = "塚口AFCジュニア 60期生（4年生）の試合動画";
let youtubeTargetPlaylistIdCache_ = "";
let youtubeTargetPlaylistVideoIdsCache_ = null;

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
const COL_YT_3RD = "3rdURL";
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
  if (typeof YouTube === "undefined" || !YouTube.Videos || !YouTube.Playlists || !YouTube.PlaylistItems) {
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
      // statusはチーム共通の運用に統一する（限定公開・子ども向けではない）。
      const lookup = YouTube.Videos.list("snippet,status", {id: videoId, maxResults: 1});
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

      const currentStatus = current.status || {};
      const status = {
        privacyStatus: YOUTUBE_TARGET_PRIVACY_STATUS,
        selfDeclaredMadeForKids: YOUTUBE_TARGET_MADE_FOR_KIDS,
      };
      // YouTube上で既に設定している、公開統計・埋め込み・ライセンスは維持する。
      ["license", "embeddable", "publicStatsViewable"].forEach(key => {
        if (Object.prototype.hasOwnProperty.call(currentStatus, key)) status[key] = currentStatus[key];
      });

      YouTube.Videos.update({id: videoId, snippet: snippet, status: status}, "snippet,status");
      addVideoToTargetYoutubePlaylist_(videoId);
      updatedVideos.push({videoId: videoId, title: title, label: String(raw && raw.label || "")});
    } catch (err) {
      const message = String(err && err.message || err || "不明なエラー");
      throw new Error("YouTube更新に失敗しました（" + title + "）: " + message);
    }
  });

  return {updatedCount: updatedVideos.length, updatedVideos: updatedVideos};
}

// 指定名のプレイリストを使う。まだなければ一度だけ作成する。
function getTargetYoutubePlaylistId_() {
  if (youtubeTargetPlaylistIdCache_) return youtubeTargetPlaylistIdCache_;
  let pageToken = "";
  do {
    const args = {
      mine: true,
      maxResults: 50,
    };
    if (pageToken) args.pageToken = pageToken;
    const response = YouTube.Playlists.list("snippet", args);
    const found = (response && response.items || []).find(item =>
      String(item && item.snippet && item.snippet.title || "").trim() === YOUTUBE_TARGET_PLAYLIST_TITLE
    );
    if (found && found.id) {
      youtubeTargetPlaylistIdCache_ = String(found.id);
      return youtubeTargetPlaylistIdCache_;
    }
    pageToken = String(response && response.nextPageToken || "");
  } while (pageToken);

  const created = YouTube.Playlists.insert({
    snippet: {
      title: YOUTUBE_TARGET_PLAYLIST_TITLE,
      description: YOUTUBE_TARGET_PLAYLIST_DESCRIPTION,
    },
    status: {privacyStatus: YOUTUBE_TARGET_PRIVACY_STATUS},
  }, "snippet,status");
  if (!created || !created.id) throw new Error("試合動画プレイリストを作成できませんでした");
  youtubeTargetPlaylistIdCache_ = String(created.id);
  return youtubeTargetPlaylistIdCache_;
}

function addVideoToTargetYoutubePlaylist_(videoId) {
  const playlistId = getTargetYoutubePlaylistId_();
  if (youtubeTargetPlaylistVideoIdsCache_ === null) {
    youtubeTargetPlaylistVideoIdsCache_ = {};
    let pageToken = "";
    do {
      const args = {
        playlistId: playlistId,
        maxResults: 50,
      };
      if (pageToken) args.pageToken = pageToken;
      const response = YouTube.PlaylistItems.list("snippet", args);
      (response && response.items || []).forEach(item => {
        const id = String(item && item.snippet && item.snippet.resourceId && item.snippet.resourceId.videoId || "");
        if (id) youtubeTargetPlaylistVideoIdsCache_[id] = true;
      });
      pageToken = String(response && response.nextPageToken || "");
    } while (pageToken);
  }
  if (youtubeTargetPlaylistVideoIdsCache_[videoId]) return;

  YouTube.PlaylistItems.insert({
    snippet: {
      playlistId: playlistId,
      resourceId: {kind: "youtube#video", videoId: videoId},
    },
  }, "snippet");
  youtubeTargetPlaylistVideoIdsCache_[videoId] = true;
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

function syncYouTubePlaylist(req) {
  const ss = SpreadsheetApp.openById(getSpreadsheetIdForYoutube_());
  const resultSh = ss.getSheetByName(SHEET_RESULTS);
  const scheduleSh = ss.getSheetByName(SHEET_SCHEDULES);
  if (!resultSh) throw new Error("Results sheet not found");
  const resultHeaders = resultSh.getRange(1, 1, 1, resultSh.getLastColumn()).getValues()[0].map(String);
  const col = {
    yt: ensureColumn_(resultSh, resultHeaders, COL_YT),
    yt1st: ensureColumn_(resultSh, resultHeaders, COL_YT_1ST),
    yt2nd: ensureColumn_(resultSh, resultHeaders, COL_YT_2ND),
    yt3rd: ensureColumn_(resultSh, resultHeaders, COL_YT_3RD),
    ytPk: ensureColumn_(resultSh, resultHeaders, COL_YT_PK),
    recordings: ensureColumn_(resultSh, resultHeaders, COL_YT_RECORDINGS),
  };
  const requestedResultIds = new Set(
    (Array.isArray(req && req.resultIds) ? req.resultIds : [])
      .map(id => String(id || "").trim())
      .filter(Boolean)
  );
  const scheduleTitles = loadScheduleTitles_(scheduleSh);
  const allResults = loadResults_(resultSh, resultHeaders, scheduleTitles);
  // 日程画面から呼ばれた場合は、その日程の試合だけを対象にする。
  const results = requestedResultIds.size
    ? allResults.filter(result => requestedResultIds.has(String(result.id || "")))
    : allResults;
  if (!results.length) return {linkedCount: 0, pendingCount: 0, titleMatchedCount: 0, unmatchedCount: 0, updatedResults: []};

  const recentVideos = fetchRecentOwnedYoutubeVideosForTitleLink_();
  const updatesByResult = {};
  let linkedCount = 0;
  let titleMatchedCount = 0;
  let unmatchedCount = 0;
  recentVideos.forEach(video => {
    const parsed = parseTitle_(video.title);
    if (!parsed) return;
    // 日程画面からの実行では、その日以外の最新動画は未照合数に含めない。
    const isSameTargetDate = results.some(row => normalizeDate_(row.date) === normalizeDate_(parsed.date));
    if (!isSameTargetDate) return;
    const result = findResult_(results, parsed);
    // 同じ日・相手でも大会や試合番号が足りず特定できないタイトルは、誤リンクしない。
    if (!result) { unmatchedCount++; return; }
    titleMatchedCount++;

    const part = parsed.half === "1st" ? "first" : parsed.half === "2nd" ? "second" : parsed.half === "3rd" ? "third" : parsed.half === HALF_PK ? "pk" : "full";
    const targetCol = part === "first" ? col.yt1st : part === "second" ? col.yt2nd : part === "third" ? col.yt3rd : part === "pk" ? col.ytPk : col.yt;
    const currentUrl = String(resultSh.getRange(result.row, targetCol).getValue() || "").trim();
    if (currentUrl) return;
    resultSh.getRange(result.row, targetCol).setValue(video.url);
    linkedCount++;
    updatesByResult[result.id] = {
      ...(updatesByResult[result.id] || {id: result.id}),
      [part === "first" ? "youtubeUrl1st" : part === "second" ? "youtubeUrl2nd" : part === "third" ? "youtubeUrl3rd" : part === "pk" ? "youtubeUrlPk" : "youtubeUrl"]: video.url,
    };
  });
  Logger.log("YouTube title sync: linked=" + linkedCount + ", matched=" + titleMatchedCount + ", unmatched=" + unmatchedCount);
  return {
    linkedCount: linkedCount,
    pendingCount: unmatchedCount,
    titleMatchedCount: titleMatchedCount,
    unmatchedCount: unmatchedCount,
    updatedResults: Object.keys(updatesByResult).map(id => updatesByResult[id])
  };
}

function fetchRecentOwnedYoutubeVideosForTitleLink_() {
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
  const detailResponse = YouTube.Videos.list("snippet", {id: ids.join(",")});
  return (detailResponse && detailResponse.items || []).map(item => ({
    id: String(item.id || ""),
    url: "https://www.youtube.com/watch?v=" + String(item.id || ""),
    title: String(item.snippet && item.snippet.title || ""),
    publishedAt: String(item.snippet && item.snippet.publishedAt || "")
  })).filter(item => item.id && item.title);
}

// ============================================================
// ファイル名突合が使えない場合の直接リンク。
// 動画URLを指定して、タイトル・概要欄とチーム共通のYouTube設定を反映する。
// ============================================================
function linkYoutubeVideoFromApp_(req) {
  const resultId = String(req && req.resultId || "").trim();
  const key = String(req && req.part || "full").trim().toLowerCase();
  const videoUrl = String(req && req.videoUrl || "").trim();
  if (!resultId) throw new Error("試合IDが見つかりません");
  if (!["full", "first", "second", "third", "pk"].includes(key)) throw new Error("動画の種類が正しくありません");
  if (!extractYoutubeVideoIdForMetadata_(videoUrl)) throw new Error("YouTube URLが正しくありません");

  const ss = SpreadsheetApp.openById(getSpreadsheetIdForYoutube_());
  const resultSh = ss.getSheetByName(SHEET_RESULTS);
  const scheduleSh = ss.getSheetByName(SHEET_SCHEDULES);
  if (!resultSh || resultSh.getLastRow() < 2) throw new Error("試合結果が見つかりません");
  const headers = resultSh.getRange(1, 1, 1, resultSh.getLastColumn()).getValues()[0].map(String);
  const idIndex = headers.indexOf(HEADER_ID);
  if (idIndex < 0) throw new Error("試合結果のID列が見つかりません");
  const rows = resultSh.getRange(2, 1, resultSh.getLastRow() - 1, resultSh.getLastColumn()).getValues();
  const rowIndex = rows.findIndex(row => String(row[idIndex] || "").trim() === resultId);
  if (rowIndex < 0) throw new Error("対象の試合が見つかりません");
  const row = rowIndex + 2;

  const scheduleDetails = loadYoutubeScheduleDetails_(scheduleSh);
  const goalsByResult = loadYoutubeGoalsByResult_(ss.getSheetByName("得点記録"));
  const context = buildYoutubeResultContext_(resultSh, headers, row, scheduleDetails, goalsByResult);
  const metadata = buildYoutubeMetadataForRecording_(context, key, videoUrl);
  updateYoutubeMetadataFromApp_({videos: [metadata]});

  const columnName = key === "first" ? COL_YT_1ST : key === "second" ? COL_YT_2ND : key === "third" ? COL_YT_3RD : key === "pk" ? COL_YT_PK : COL_YT;
  const column = ensureColumn_(resultSh, headers, columnName);
  resultSh.getRange(row, column).setValue(videoUrl);
  const urlKey = key === "first" ? "youtubeUrl1st" : key === "second" ? "youtubeUrl2nd" : key === "third" ? "youtubeUrl3rd" : key === "pk" ? "youtubeUrlPk" : "youtubeUrl";
  return {updatedResult: {id: resultId, [urlKey]: videoUrl}, metadata: {title: metadata.title, description: metadata.description}};
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
    ["full", "first", "second", "third", "pk"].forEach(key => {
      const entry = recordingFiles && recordingFiles[key] || {};
      const fileName = String(entry.fileName || "").trim();
      const fileKey = normalizeYoutubeRecordingFileName_(fileName);
      const fileSize = Math.max(0, Number(entry.fileSize || 0) || 0);
      const planKey = youtubeRecordingPlanKey_(fileKey, fileSize);
      if (!fileKey || plans[planKey]) return;
      plans[planKey] = {resultId: resultId, row: index + 2, key: key, fileName: fileName, fileSize: fileSize};
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

function youtubeRecordingPlanKey_(fileKey, fileSize) {
  const name = String(fileKey || "").trim();
  const size = Math.max(0, Number(fileSize || 0) || 0);
  return name + "|" + (size || "legacy");
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
    fileSize: Math.max(0, Number(item.fileDetails && item.fileDetails.fileSize || 0) || 0),
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
  const half = key === "first" ? "1st" : key === "second" ? "2nd" : key === "third" ? "3rd" : key === "pk" ? "PK戦" : "";
  return {
    label: key === "first" ? "1st" : key === "second" ? "2nd" : key === "third" ? "3rd" : key === "pk" ? "PK" : "試合動画",
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
  let value = String(name || "").replace(/\s+/g, " ").trim();
  // テンプレの「相手 公式戦 第1試合 1st」のように、末尾の情報が複数並んでも全て除く。
  const suffix = /(?:PK\s*戦|ＰＫ\s*戦|penalty\s*shootout|前半|後半|1st|2nd|3rd|第\s*\d+\s*試合|\d+\s*本目|TM|トレマ|公式戦|カップ戦|練習試合|トレーニングマッチ)\s*$/i;
  let previous = "";
  while (value && value !== previous) {
    previous = value;
    value = value.replace(suffix, "").trim();
  }
  return value;
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
