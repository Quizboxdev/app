/* QuizBox service worker.
 * What it does: keeps the app's static files (scripts, styles, fonts, brand images) so the app opens faster, shows a friendly page when there is no connection,
 * and shows push notifications.
 * What it never does: cache pages, sign-in data, API calls or anything from the database. Signed-in pages always come from the network, so no one ever sees
 * another person's data or a stale answer. There is no offline answering. Bump VERSION to drop old caches. */
const VERSION = "qb-sw-v1";
const STATIC_CACHE = `${VERSION}-static`;
const SHELL = ["/offline.html", "/brand/quizbox-icon-96.png", "/brand/quizbox-icon-192.png"];
const CACHEABLE = /^\/(_next\/static\/|brand\/|fonts\/)/;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("qb-sw-") && k !== STATIC_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;                     // Supabase, fonts hosts, analytics: never touched

  // Pages: always the network. When it fails, show the offline page. Nothing is stored.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html").then((r) => r || Response.error())));
    return;
  }
  // Static files only: hashed build files never change, brand files change rarely (refreshed in the background).
  if (CACHEABLE.test(url.pathname)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request).then((response) => { if (response.ok) cache.put(request, response.clone()); return response; }).catch(() => cached);
        return cached || network;
      }),
    );
  }
});

// Push: the server sends a short title and message that are already safe to show on a lock screen. A link is only followed when it stays inside the app.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = typeof data.title === "string" && data.title ? data.title.slice(0, 80) : "QuizBox";
  const body = typeof data.body === "string" ? data.body.slice(0, 160) : "";
  const link = typeof data.url === "string" && /^\/[A-Za-z0-9/_\-?=&.]*$/.test(data.url) ? data.url : "/";
  event.waitUntil(self.registration.showNotification(title, { body, icon: "/brand/quizbox-icon-192.png", badge: "/brand/quizbox-icon-96.png", data: { url: link }, tag: typeof data.tag === "string" ? data.tag : undefined }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) { if ("focus" in client) { client.navigate(target).catch(() => undefined); return client.focus(); } }
      return self.clients.openWindow(target);
    }),
  );
});
