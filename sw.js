// RELEASE is replaced by build-scanner; each cache is an immutable complete pack.
const RELEASE='3363997b5231fa1d', CACHE='screenwave-expo-'+RELEASE;
async function notify(message){for(const client of await self.clients.matchAll({includeUncontrolled:true,type:'window'}))client.postMessage(message);}
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
async function complete(cache){
  const response=await cache.match('/asset-manifest.json');if(!response)return false;
  const manifest=await response.json();if(manifest.release!==RELEASE)return false;
  for(const asset of manifest.assets){const stored=await cache.match(asset.url);if(!stored)return false;}
  return true;
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  try{
    const response=await fetch('/asset-manifest.json',{cache:'no-store'});
    if(!response.ok)throw Error('Missing asset manifest');
    const manifest=await response.clone().json();if(manifest.release!==RELEASE)throw Error('Release changed during install');
    let count=0;
    for(const asset of manifest.assets){
      const fetched=await fetch(asset.url,{cache:'no-store'});if(!fetched.ok)throw Error('Asset unavailable');
      const bytes=await fetched.clone().arrayBuffer();
      if(bytes.byteLength!==asset.bytes||await digest(bytes)!==asset.sha256)throw Error('Asset integrity failure');
      await cache.put(asset.url,fetched);await notify({type:'offline-progress',complete:++count,total:manifest.assets.length});
    }
    // Commit marker is written last. A partial install can never report ready.
    await cache.put('/asset-manifest.json',response);await self.skipWaiting();
  }catch(error){await caches.delete(CACHE);await notify({type:'offline-incomplete'});throw error;}
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);if(!await complete(cache))throw Error('Incomplete offline pack');
  // Only our namespace is eligible for eviction; unrelated caches are untouched.
  for(const key of await caches.keys())if(key.startsWith('screenwave-expo-')&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();await notify({type:'offline-ready',release:RELEASE});
})()));
self.addEventListener('message',event=>{
  if(event.data?.type==='offline-status')event.waitUntil((async()=>{
    const ok=await complete(await caches.open(CACHE));event.source?.postMessage({type:ok?'offline-ready':'offline-incomplete',release:RELEASE});
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==location.origin)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE),key=request.mode==='navigate'?'/index.html':url.pathname;
    const cached=await cache.match(key);
    if(!cached)return fetch(request);
    const range=request.headers.get('range');
    if(range){
      const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(!match)return new Response(null,{status:416});
      const bytes=await cached.arrayBuffer(),start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),bytes.byteLength-1):bytes.byteLength-1;
      if(start>end||start>=bytes.byteLength)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${bytes.byteLength}`}});
      return new Response(bytes.slice(start,end+1),{status:206,headers:{'Content-Type':cached.headers.get('Content-Type')||'application/octet-stream','Content-Range':`bytes ${start}-${end}/${bytes.byteLength}`,'Content-Length':String(end-start+1),'Accept-Ranges':'bytes'}});
    }
    return cached;
  })());
});
