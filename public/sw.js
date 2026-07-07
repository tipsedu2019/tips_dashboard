const DEFAULT_NOTIFICATION_URL = "/admin/makeup-requests";
const DEFAULT_NOTIFICATION_ICON = "/favicon-window.png";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const payload = event.data?.json?.() || {};
  const title = payload.title || "TIPS Dashboard";
  const options = {
    body: payload.body || "",
    icon: payload.icon || DEFAULT_NOTIFICATION_ICON,
    badge: payload.badge || DEFAULT_NOTIFICATION_ICON,
    tag: payload.tag || "tips-dashboard",
    renotify: Boolean(payload.tag),
    data: {
      url: payload.href || payload.url || DEFAULT_NOTIFICATION_URL,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || DEFAULT_NOTIFICATION_URL;

  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const normalizedTarget = new URL(targetUrl, self.location.origin).href;
    for (const client of windowClients) {
      if (client.url === normalizedTarget && "focus" in client) {
        return client.focus();
      }
    }
    return self.clients.openWindow(targetUrl);
  })());
});
