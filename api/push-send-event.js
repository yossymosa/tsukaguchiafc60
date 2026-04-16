const webpush = require("web-push");

function pickHeader(req, name) {
  if (!req || !req.headers) return "";
  const key = String(name || "").toLowerCase();
  const raw = req.headers[key];
  if (Array.isArray(raw)) return String(raw[0] || "");
  return String(raw || "");
}

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

function getRequestSecret(req, body) {
  const fromBody = String((body && body.secret) || "").trim();
  if (fromBody) return fromBody;

  const fromHeader = String(
    pickHeader(req, "x-push-secret")
    || pickHeader(req, "x-sync-secret")
  ).trim();
  if (fromHeader) return fromHeader;

  const auth = String(pickHeader(req, "authorization") || "");
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();

  return req.query && req.query.secret ? String(req.query.secret).trim() : "";
}

module.exports = async function handler(req, res) {
  const body = await readJsonBody(req);

  const syncSecret = process.env.PUSH_SYNC_SECRET || "";
  if (!syncSecret || getRequestSecret(req, body) !== syncSecret) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY || "";
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY || "";
  const gasUrl = process.env.GAS_URL || "";
  const subject = process.env.WEB_PUSH_SUBJECT || "mailto:t.afcjr@gmail.com";
  if (!publicKey || !privateKey || !gasUrl) {
    return res.status(500).json({ error: "missing env vars" });
  }

  const title = String(body.title || "Tsukaguchi AFC Jr");
  const message = String(body.body || "");
  const url = String(body.url || "/");
  const targetUserIds = Array.isArray(body.targetUserIds)
    ? body.targetUserIds.map((v) => String(v || "").trim()).filter(Boolean)
    : [];
  const excludeUserId = String(body.excludeUserId || "").trim();

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const gasRes = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "getPushTargets", secret: syncSecret }),
  });
  const gasJson = await gasRes.json();
  if (!gasJson.ok) {
    return res.status(500).json({ error: gasJson.error || "failed to fetch GAS targets" });
  }

  let targets = gasJson.targets || [];
  if (targetUserIds.length) {
    const idSet = new Set(targetUserIds);
    targets = targets.filter((t) => idSet.has(String(t.userId || "").trim()));
  }
  if (excludeUserId) {
    targets = targets.filter((t) => String(t.userId || "").trim() !== excludeUserId);
  }
  if (!targets.length) {
    return res.status(200).json({ sent: 0, skipped: true, mode: gasJson.mode || "unknown" });
  }

  const payload = JSON.stringify({
    title,
    body: message,
    url,
    icon: "/icon-512.png",
    badge: "/icon-192.png",
  });

  let sent = 0;
  const expired = [];
  await Promise.all(targets.map(async (target) => {
    try {
      await webpush.sendNotification(target.subscription, payload);
      sent += 1;
    } catch (err) {
      const status = err && err.statusCode;
      if (status === 404 || status === 410) {
        expired.push(target.subscription.endpoint);
      }
    }
  }));

  if (expired.length) {
    await Promise.all(expired.map((endpoint) =>
      fetch(gasUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deletePushSubscription", endpoint }),
      }).catch(() => null)
    ));
  }

  return res.status(200).json({ sent, mode: gasJson.mode || "unknown", expired: expired.length });
};
