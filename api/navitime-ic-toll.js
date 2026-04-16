async function readJsonBody(req) {
  if (!req) return {};
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (_e) {
      return {};
    }
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch (_e) {
    return {};
  }
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pickFareYen(fare) {
  if (!fare || typeof fare !== "object") return null;
  const values = Object.entries(fare)
    .map(([key, value]) => ({ key, value: toNumber(value, NaN) }))
    .filter(v => Number.isFinite(v.value) && v.value >= 0);
  if (!values.length) return null;
  const carClass = values.filter(v => /_1$/.test(v.key));
  const pool = carClass.length ? carClass : values;
  return Math.round(Math.min(...pool.map(v => v.value)));
}

function buildHeaders() {
  const headers = { Accept: "application/json" };
  const rapidKey = String(process.env.NAVITIME_RAPIDAPI_KEY || "").trim();
  const rapidHost = String(process.env.NAVITIME_RAPIDAPI_HOST || "").trim();
  if (rapidKey) headers["X-RapidAPI-Key"] = rapidKey;
  if (rapidHost) headers["X-RapidAPI-Host"] = rapidHost;
  return headers;
}

function buildUrl(base, params) {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v == null) return;
    const s = String(v).trim();
    if (!s) return;
    qs.set(k, s);
  });
  return `${base}?${qs.toString()}`;
}

async function fetchNavitimeJson(url, headers) {
  const res = await fetch(url, { method: "GET", headers });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_e) {
    json = {};
  }
  if (!res.ok) {
    const message =
      (json && json.error && (json.error.message || json.error.code)) ||
      `NAVITIME API error (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return json;
}

function pickIcItem(items, type) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  const typed = list.find(item => !!item && item[type] === true);
  return typed || list[0] || null;
}

module.exports = async function handler(req, res) {
  if (String(req.method || "").toUpperCase() !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  const icEndpoint = String(process.env.NAVITIME_IC_ENDPOINT || "").trim();
  const routeEndpoint = String(process.env.NAVITIME_ROUTE_CAR_ENDPOINT || "").trim();
  if (!icEndpoint || !routeEndpoint) {
    return res.status(500).json({
      ok: false,
      error: "NAVITIME_IC_ENDPOINT / NAVITIME_ROUTE_CAR_ENDPOINT is not set",
    });
  }

  const body = await readJsonBody(req);
  const fromWord = String(body.fromWord || "").trim();
  const toWord = String(body.toWord || "").trim();
  const condition = String(body.condition || "toll_time").trim() || "toll_time";
  if (!fromWord || !toWord) {
    return res.status(400).json({ ok: false, error: "fromWord and toWord are required" });
  }

  const headers = buildHeaders();

  try {
    const fromIcUrl = buildUrl(icEndpoint, {
      word: fromWord,
      type: "entrance",
      limit: "10",
    });
    const fromIcJson = await fetchNavitimeJson(fromIcUrl, headers);
    const fromIc = pickIcItem(fromIcJson.items, "entrance");
    if (!fromIc || !fromIc.id) {
      return res.status(404).json({ ok: false, error: `入口ICが見つかりません: ${fromWord}` });
    }

    const toIcUrl = buildUrl(icEndpoint, {
      word: toWord,
      type: "exit",
      limit: "10",
    });
    const toIcJson = await fetchNavitimeJson(toIcUrl, headers);
    const toIc = pickIcItem(toIcJson.items, "exit");
    if (!toIc || !toIc.id) {
      return res.status(404).json({ ok: false, error: `出口ICが見つかりません: ${toWord}` });
    }

    const start = JSON.stringify({
      ic: String(fromIc.id),
      "ic-passing-type": "entrance",
      name: String(fromIc.name || fromWord),
    });
    const goal = JSON.stringify({
      ic: String(toIc.id),
      "ic-passing-type": "exit",
      name: String(toIc.name || toWord),
    });

    const routeUrl = buildUrl(routeEndpoint, {
      start,
      goal,
      condition,
      order: "time",
      format: "json",
      lang: "ja",
    });
    const routeJson = await fetchNavitimeJson(routeUrl, headers);

    const routes = Array.isArray(routeJson.items)
      ? routeJson.items
      : Array.isArray(routeJson.routes)
        ? routeJson.routes
        : [];
    const route = routes[0] || null;
    const summaryMove = route && route.summary ? route.summary.move || {} : {};
    const distanceMeters = toNumber(summaryMove.distance, 0);
    const distanceKm = Math.round((distanceMeters / 1000) * 10) / 10;
    const timeMin = toNumber(summaryMove.time, 0);
    const tollYen = pickFareYen(summaryMove.fare);
    const tollRoadDistanceM = toNumber(summaryMove.toll_road_distance, 0);

    return res.status(200).json({
      ok: true,
      fromIc: {
        id: String(fromIc.id || ""),
        name: String(fromIc.name || fromWord),
      },
      toIc: {
        id: String(toIc.id || ""),
        name: String(toIc.name || toWord),
      },
      tollYen: tollYen == null ? null : Math.max(0, Math.round(tollYen)),
      distanceKm,
      timeMin,
      tollRoadDistanceKm: Math.round((tollRoadDistanceM / 1000) * 10) / 10,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String((e && e.message) || e || "unknown error"),
    });
  }
};
