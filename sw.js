const CACHE_PREFIX = "tsukaguchi-afc-";
const NOTIFICATION_ICON = "/icon-512.png";
const NOTIFICATION_BADGE = "/icon-192.png";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => String(key || "").startsWith(CACHE_PREFIX)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("push", (event) => {
  const data = (() => {
    try {
      return event.data ? event.data.json() : {};
    } catch (e) {
      return {};
    }
  })();

  const title = data.title || "Tsukaguchi AFC Jr";
  const options = {
    body: data.body || "",
    icon: data.icon || NOTIFICATION_ICON,
    badge: data.badge || NOTIFICATION_BADGE,
    tag: data.tag || "afc-notice",
    renotify: Boolean(data.renotify),
    data: {
      url: data.url || "/",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url && "focus" in client) {
          try {
            const opened = new URL(client.url);
            if (opened.origin === self.location.origin) {
              if ("navigate" in client) client.navigate(targetUrl);
              return client.focus();
            }
          } catch (e) {}
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
      return null;
    })
  );
});
