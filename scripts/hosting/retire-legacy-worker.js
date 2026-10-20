/* Keep this URL available permanently: installed Vue CLI apps update service-worker.js
 * without first loading the new app. Do not import code or remove application data here. */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Only this registration's controlled windows, never unrelated tabs or push workers.
    const windows = await self.clients.matchAll({ type: "window" });
    await self.registration.unregister();
    // There is deliberately no fetch handler: the replacement document comes from the network.
    // A closed tab must not prevent other installed-app windows from recovering.
    await Promise.all(windows.map((client) => client.navigate(client.url).catch(() => {})));
  })());
});
