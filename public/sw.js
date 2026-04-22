// PinVault Service Worker - Network Firewall

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

let isOfflineMode = false;

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SET_OFFLINE') {
    isOfflineMode = event.data.value;
    console.log('[Firewall] Offline Mode:', isOfflineMode);
  }
});

self.addEventListener('fetch', (event) => {
  // In Online mode, pass everything through transparently
  if (!isOfflineMode) return;
  
  // In Offline mode, intercept requests
  const url = new URL(event.request.url);
  const hostname = url.hostname;

  // Define what constitutes a "local" safe network request
  const isLocal = hostname === 'localhost' || 
                  hostname === '127.0.0.1' || 
                  hostname.startsWith('192.168.') || 
                  hostname.startsWith('10.') || 
                  (url.hostname === self.location.hostname);
                  
  if (!isLocal) {
    // If the request is trying to hit the external internet while offline, kill it abruptly.
    event.respondWith(
      new Response('Offline Mode Active: Connection Dropped by PinVault Advanced Firewall', {
        status: 503,
        statusText: 'Service Unavailable'
      })
    );
  }
});
