/* The installed app as a share target (the manifest's `share_target`, in vite.config.ts): a
   photo or PDF shared to it from another app is posted here. It's kept in a cache of its own for
   Capture receipt, which opens with it (src/web/lib/shared.ts). Loaded into the service worker
   ahead of Workbox's routes, so this answers the post first. */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.pathname !== "/ui/share-receipt") return;
  event.respondWith(
    (async () => {
      const form = await event.request.formData();
      const file = form.get("receipt");
      await caches.delete("shared-receipt");
      if (file instanceof File) {
        const cache = await caches.open("shared-receipt");
        await cache.put(
          "/ui/shared-receipt",
          new Response(file, {
            headers: {
              "Content-Type": file.type || "application/octet-stream",
              "X-Filename": encodeURIComponent(file.name),
            },
          })
        );
      }
      return Response.redirect(new URL("/ui/receipt?shared=1", self.location.origin).href, 303);
    })()
  );
});
