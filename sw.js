const CACHE='gymflow-auto-update-v4';
const SHELL=['/','/index.html','/offline-db.js','/sync.js','/icon-192.png','/icon-512.png'];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(cache=>cache.addAll(SHELL))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;

  // HTML e codice dell'app: rete prima. La cache serve solo quando sei offline.
  if(
    event.request.mode==='navigate' ||
    ['.js','.css','.webmanifest'].some(ext=>url.pathname.endsWith(ext))
  ){
    event.respondWith(
      fetch(event.request,{cache:'no-store'})
        .then(response=>{
          const copy=response.clone();
          caches.open(CACHE).then(cache=>cache.put(event.request.mode==='navigate'?'/index.html':event.request,copy));
          return response;
        })
        .catch(async()=>{
          if(event.request.mode==='navigate')return caches.match('/index.html');
          return caches.match(event.request);
        })
    );
    return;
  }

  // Icone e asset statici: cache first.
  event.respondWith(
    caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{
      const copy=response.clone();
      caches.open(CACHE).then(cache=>cache.put(event.request,copy));
      return response;
    }))
  );
});
