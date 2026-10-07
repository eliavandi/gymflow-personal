const CACHE='gymflow-v3-excel-editor-recent';
const SHELL=['/','/index.html','/styles.css','/app.js','/offline-db.js','/sync.js','/manifest.webmanifest','/icon-192.png','/icon-512.png'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(u.origin!==location.origin||u.pathname.startsWith('/api/'))return;

  // Navigazione e file dell'app: rete prima, cache come fallback.
  if(e.request.mode==='navigate'||['/app.js','/styles.css','/sync.js','/offline-db.js','/manifest.webmanifest'].includes(u.pathname)){
    e.respondWith(fetch(e.request).then(r=>{
      const clone=r.clone();caches.open(CACHE).then(c=>c.put(e.request.mode==='navigate'?'/index.html':e.request,clone));return r;
    }).catch(()=>caches.match(e.request.mode==='navigate'?'/index.html':e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{
    const clone=r.clone();caches.open(CACHE).then(c=>c.put(e.request,clone));return r;
  })));
});
