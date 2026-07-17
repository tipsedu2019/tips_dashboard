const DEFAULT_NOTIFICATION_URL = "/admin/makeup-requests";
const DEFAULT_NOTIFICATION_ICON = "/favicon-window.png";

function notificationText(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 512)
    : fallback;
}

function safeAdminPath(value) {
  if (typeof value !== "string" || !value.trim()) {
    return DEFAULT_NOTIFICATION_URL;
  }

  try {
    const parsed = new URL(value, self.location.origin);
    const allowedPath = parsed.pathname === "/admin" || parsed.pathname.startsWith("/admin/");
    if (parsed.origin !== self.location.origin || !allowedPath) {
      return DEFAULT_NOTIFICATION_URL;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_NOTIFICATION_URL;
  }
}

function readPushPayload(event) {
  if (!event.data || typeof event.data.json !== "function") return {};
  try {
    const payload = event.data.json();
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  } catch {
    return {};
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const payload = readPushPayload(event);
  const title = notificationText(payload.title, "TIPS Dashboard");
  const targetUrl = safeAdminPath(payload.href || payload.url);
  const options = {
    body: notificationText(payload.body),
    icon: DEFAULT_NOTIFICATION_ICON,
    badge: DEFAULT_NOTIFICATION_ICON,
    tag: notificationText(payload.tag, "tips-dashboard"),
    renotify: Boolean(notificationText(payload.tag)),
    data: {
      url: targetUrl,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = safeAdminPath(event.notification.data?.url);

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
