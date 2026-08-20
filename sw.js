const VERSION = 'radform-v7.0.0';
const SHELL_CACHE = `${VERSION}-shell`;
const IMAGE_CACHE = `${VERSION}-images`;
const CORE = [
  './','./index.html','./styles.css','./app.js','./supabase-client.js','./commons.js','./openi.js','./multicare.js','./mir-open.js',
  './manifest.webmanifest','./assets/logo.svg','./assets/icons/icon-192.png','./assets/icons/icon-512.png','./assets/icons/apple-touch-icon.png','./og.png',
  './data/cases.json','./data/atlas-topics.json','./data/mir-questions.json','./data/openi-snapshot.json','./data/multicare-snapshot.json','./data/mir-open-snapshot.json','./data/vqa-rad-snapshot.json','./data/roco-snapshot.json'
];
self.addEventListener('install',(event)=>{event.waitUntil(caches.open(SHELL_CACHE).then((cache)=>cache.addAll(CORE)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',(event)=>{event.waitUntil(caches.keys().then((keys)=>Promise.all(keys.filter((key)=>![SHELL_CACHE,IMAGE_CACHE].includes(key)).map((key)=>caches.delete(key)))).then(()=>self.clients.claim()));});
async function networkFirst(request){const cache=await caches.open(SHELL_CACHE);try{const response=await fetch(request);if(response&&response.ok)cache.put(request,response.clone());return response;}catch{return (await cache.match(request))||(await cache.match('./index.html'));}}
async function cacheFirstImage(request){const cache=await caches.open(IMAGE_CACHE);const hit=await cache.match(request);if(hit)return hit;try{const response=await fetch(request,{mode:request.mode==='navigate'?'same-origin':request.mode});if(response&&(response.ok||response.type==='opaque'))cache.put(request,response.clone());return response;}catch{return Response.error();}}
self.addEventListener('fetch',(event)=>{const request=event.request;if(request.method!=='GET')return;const url=new URL(request.url);if(request.mode==='navigate'){event.respondWith(networkFirst(request));return;}if(request.destination==='image'){event.respondWith(cacheFirstImage(request));return;}if(url.origin===self.location.origin){if(url.pathname.includes('/data/')){event.respondWith(networkFirst(request));return;}event.respondWith(caches.match(request).then((hit)=>hit||fetch(request)));}});
