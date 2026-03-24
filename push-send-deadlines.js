const webpush = require("web-push");

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return true;
  const auth = req.headers.authorization || "";
  const querySecret = req.query && req.query.secret ? String(req.query.secret) : "";
  return auth === `Bearer ${secret}` || querySecret === secret;
}

function buildPayload(schedules) {
  const lines = schedules.slice(0, 3).map(s => `\u30fb${s.title || "\u4e88\u5b9a"} (${s.deadline})`);
  return {
    title: "\u51fa\u6b20\u7de0\u5207\u304c\u660e\u65e5\u3067\u3059",
    body: lines.join("\n"),
    url: "/?source=push",
  };
}

module.exports = async function handler(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY || "";
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY || "";
  const gasUrl = process.env.GAS_URL || "";
  const syncSecret = process.env.PUSH_SYNC_SECRET || "";
  const subject = process.env.WEB_PUSH_SUBJECT || "mailto:t.afcjr@gmail.com";

  if (!publicKey || !privateKey || !gasUrl || !syncSecret) {
    return res.status(500).json({ error: "missing env vars" });
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const gasRes = await fetch(gasUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "getPushDeadlineTargets", secret: syncSecret }),
  });
  const gasJson = await gasRes.json();
  if (!gasJson.ok) {
    return res.status(500).json({ error: gasJson.error || "failed to fetch GAS targets" });
  }

  const schedules = gasJson.schedules || [];
  const targets = gasJson.targets || [];
  if (!schedules.length || !targets.length) {
    return res.status(200).json({ sent: 0, skipped: true });
  }

  const payload = JSON.stringify(buildPayload(schedules));
  let sent = 0;
  const expired = [];

  await Promise.all(targets.map(async target => {
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
    await Promise.all(expired.map(endpoint =>
      fetch(gasUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deletePushSubscription", endpoint }),
      }).catch(() => null)
    ));
  }

  return res.status(200).json({ sent, schedules: schedules.length, expired: expired.length });
};
