const webpush = require("web-push");

function getRequestSecret(req) {
  if (req.method === "POST" && req.body && typeof req.body === "object") {
    return String(req.body.secret || "");
  }
  const auth = req.headers.authorization || "";
  const querySecret = req.query && req.query.secret ? String(req.query.secret) : "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : querySecret;
}

module.exports = async function handler(req, res) {
  const syncSecret = process.env.PUSH_SYNC_SECRET || "";
  if (!syncSecret || getRequestSecret(req) !== syncSecret) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY || "";
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY || "";
  const gasUrl = process.env.GAS_URL || "";
  const subject = process.env.WEB_PUSH_SUBJECT || "mailto:t.afcjr@gmail.com";
  if (!publicKey || !privateKey || !gasUrl) {
    return res.status(500).json({ error: "missing env vars" });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const title = String(body.title || "Tsukaguchi AFC Jr");
  const message = String(body.body || "");
  const url = String(body.url || "/");
  const targetUserIds = Array.isArray(body.targetUserIds)
    ? body.targetUserIds.map(v => String(v || "").trim()).filter(Boolean)
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
    targets = targets.filter(t => idSet.has(String(t.userId || "").trim()));
  }
  if (excludeUserId) {
    targets = targets.filter(t => String(t.userId || "").trim() !== excludeUserId);
  }
  if (!targets.length) {
    return res.status(200).json({ sent: 0, skipped: true });
  }

  const payload = JSON.stringify({
    title,
    body: message,
    url,
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

  return res.status(200).json({ sent, expired: expired.length });
};
