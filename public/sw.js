// Service worker minimal : gère uniquement la réception des notifications push
// et l'ouverture de l'app quand on clique dessus.

self.addEventListener('push', (event) => {
  let data = { title: 'Hairsprit', body: 'Nouvelle notification', url: '/admin' };
  try { data = event.data.json(); } catch (e) { /* garde les valeurs par défaut */ }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Hairsprit', {
      body: data.body || '',
      icon: '/icon-mono.png',
      badge: '/icon-mono.png',
      data: { url: data.url || '/admin' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/admin';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
