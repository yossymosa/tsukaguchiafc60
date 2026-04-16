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

function parseDurationToText(duration) {
  const m = String(duration || "").match(/^(\d+)s$/);
  if (!m) return "";
  const total = Number(m[1] || 0);
  if (!Number.isFinite(total) || total <= 0) return "";
  const h = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${mm}m`;
  return `${mm}m`;
}

function parseYenFromPrices(prices) {
  if (!Array.isArray(prices) || prices.length === 0) return null;
  const jpy = prices.find(
    p => String((p && p.currencyCode) || "").toUpperCase() === "JPY"
  );
  const base = jpy || prices[0];
  if (!base) return null;
  const units = Number(base.units || 0);
  const nanos = Number(base.nanos || 0);
  if (!Number.isFinite(units) || !Number.isFinite(nanos)) return null;
  return Math.round(units + nanos / 1e9);
}

module.exports = async function handler(req, res) {
  if (String(req.method || "").toUpperCase() !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  const apiKey = String(process.env.GOOGLE_MAPS_API_KEY || "").trim();
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: "GOOGLE_MAPS_API_KEY is not set" });
  }

  const body = await readJsonBody(req);
  const origin = String(body.origin || "塚口小学校").trim() || "塚口小学校";
  const destination = String(body.destination || "").trim();
  if (!destination) {
    return res.status(400).json({ ok: false, error: "destination is required" });
  }

  try {
    const routesRes = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.travelAdvisory.tollInfo.estimatedPrice",
      },
      body: JSON.stringify({
        origin: { address: origin },
        destination: { address: destination },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        computeAlternativeRoutes: false,
        languageCode: "ja",
        units: "METRIC",
        extraComputations: ["TOLLS"],
      }),
    });

    const text = await routesRes.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch (_e) {
      json = {};
    }

    if (!routesRes.ok) {
      const errMsg =
        (json && json.error && json.error.message) ||
        `Routes API error (${routesRes.status})`;
      return res.status(routesRes.status).json({ ok: false, error: errMsg });
    }

    const route = Array.isArray(json.routes) ? json.routes[0] : null;
    if (!route) {
      return res.status(200).json({ ok: false, error: "route not found" });
    }

    const distanceMeters = Number(route.distanceMeters || 0);
    const distanceKm = Math.round((distanceMeters / 1000) * 10) / 10;
    const durationText = parseDurationToText(route.duration || "");
    const prices = route?.travelAdvisory?.tollInfo?.estimatedPrice || [];
    const tollYen = parseYenFromPrices(prices);

    return res.status(200).json({
      ok: true,
      origin,
      destination,
      distanceKm,
      tollYen,
      durationText,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String((e && e.message) || e || "unknown error"),
    });
  }
};

