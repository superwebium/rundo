import {firebaseConfig} from './firebase-config.js';
const $=id=>document.getElementById(id);
const STRAVA_START='https://rundo-auth.superwebium.workers.dev/start';
// Consume and erase sensitive temporary sign-in data from the address bar before
// loading more application modules or third-party resources.
let incomingStravaToken=null;
if(location.hash.startsWith('#strava_token=')){
 try{incomingStravaToken=decodeURIComponent(location.hash.slice('#strava_token='.length))}
 finally{history.replaceState(null,'',location.pathname+location.search)}
}

const state={features:[],byId:new Map(),overrides:{},filter:'all',query:'',maxDistance:999,selected:null,gpx:{},user:null,db:null,auth:null,markers:null,sortAsc:true,previews:new Map(),highlight:null,progressReady:false,profile:null,athleteIdentity:null,stravaLayer:null,stravaAbort:null,stravaActivitiesLoaded:false};
const map=L.map('map',{zoomControl:false,preferCanvas:true}).setView([45.80,1.15],10);
// Selectable map providers: never cascade failed requests automatically.
// Attribution is always visible via Leaflet's built-in attribution control.
const basemaps={
 osmfr:{url:'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',options:{subdomains:'abc',maxZoom:20,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> — <a href="https://www.openstreetmap.fr/">OSM France</a>'}},
 hiking:{url:'https://tile.openmaps.fr/openhikingmap/{z}/{x}/{y}.png',options:{maxZoom:18,attribution:'<a href="https://wiki.openstreetmap.org/wiki/OpenHikingMap">&copy; OpenHikingMap</a> <a href="https://openmaps.fr/donate">❤️ Donation</a> <a href="https://www.openstreetmap.org/copyright">&copy; OpenStreetMap</a>'}},
 topo:{url:'https://tile.openmaps.fr/opentopomap/{z}/{x}/{y}.png',options:{maxZoom:17,attribution:'<a href="https://github.com/sletuffe/OpenTopoMap">&copy; OpenTopoMap-R</a> <a href="https://openmaps.fr/donate">❤️ Donation</a> <a href="https://www.openstreetmap.org/copyright">&copy; OpenStreetMap</a>'}},
 osm:{url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',options:{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}}
};
let activeBase=null;
function useBasemap(name){
 const entry=basemaps[name]||basemaps.osmfr;
 if(activeBase)map.removeLayer(activeBase);
 const layer=L.tileLayer(entry.url,{...entry.options,updateWhenIdle:true,keepBuffer:1});
 activeBase=layer.addTo(map).bringToBack();
 let failures=0;
 layer.on('tileerror',()=>{if(++failures===4&&activeBase===layer){
   console.warn('RUNdo: fond de carte indisponible',name);
   toast('Fond de carte inaccessible. Essayez une autre source avec le sélecteur.');
 }});
 const select=$('basemap');if(select)select.value=name;
 try{localStorage.setItem('rundo-basemap',name)}catch(e){}
}
let savedBasemap='osmfr';try{savedBasemap=localStorage.getItem('rundo-basemap')||'osmfr'}catch(e){}
useBasemap(basemaps[savedBasemap]?savedBasemap:'osmfr');
$('basemap').addEventListener('change',e=>useBasemap(e.target.value));
L.control.zoom({position:'bottomright'}).addTo(map);
// Only invalidate after the responsive layout has settled. Avoid a ResizeObserver
// feedback loop and unnecessary tile cancellation during initial loading.
let resizeTimer;
window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>map.invalidateSize({pan:false}),180)},{passive:true});
window.addEventListener('orientationchange',()=>setTimeout(()=>map.invalidateSize({pan:false}),250));
const tracks=L.geoJSON(null,{style:f=>({color:isDone(f)?'#4b965c':'#e8794d',weight:isDone(f)?5:3,opacity:.86}),onEachFeature:(f,layer)=>layer.on('click',()=>showRoute(f.properties.id))}).addTo(map);
let boundary;
// Optional Strava GPS activity overlay, OFF by default and visible only to its owner.
const STRAVA_ACTIVITIES='https://rundo-auth.superwebium.workers.dev/api/activities';
const activityLayer=L.layerGroup();
function decodePolyline(encoded){
 let index=0,lat=0,lng=0,points=[];
 while(index<encoded.length){
  let result=0,shift=0,b;
  do{if(index>=encoded.length)return points;b=encoded.charCodeAt(index++)-63;result|=(b&31)<<shift;shift+=5}while(b>=32);
  lat+=(result&1)?~(result>>1):(result>>1);
  result=0;shift=0;
  do{if(index>=encoded.length)return points;b=encoded.charCodeAt(index++)-63;result|=(b&31)<<shift;shift+=5}while(b>=32);
  lng+=(result&1)?~(result>>1):(result>>1);
  points.push([lat/1e5,lng/1e5]);
 }
 return points;
}
function clearStravaActivities(){
 state.stravaAbort?.abort();state.stravaAbort=null;
 activityLayer.clearLayers();activityLayer.remove();state.stravaActivitiesLoaded=false;
 $('strava-layer').classList.remove('active');$('strava-layer').setAttribute('aria-pressed','false');
 $('strava-layer').textContent='Activités Strava';
}
async function toggleStravaActivities(){
 const b=$('strava-layer');
 if(map.hasLayer(activityLayer)){clearStravaActivities();return}
 if(!state.user?.uid.startsWith('strava-')){toast('Connecte-toi avec Strava pour afficher tes activités.');return}
 activityLayer.addTo(map);
 b.classList.add('active');b.setAttribute('aria-pressed','true');
 if(state.stravaActivitiesLoaded)return;
 const controller=new AbortController();state.stravaAbort=controller;
 let count=0,withoutGPS=0,hasMore=true;
 try{
  const firebaseToken=await state.auth.currentUser.getIdToken();
  for(let page=1;hasMore&&page<=30;page++){
   if(controller.signal.aborted)return;
   b.textContent='Activités Strava · chargement…';
   const res=await fetch(STRAVA_ACTIVITIES+'?page='+page,{
    headers:{Authorization:'Bearer '+firebaseToken},signal:controller.signal,cache:'no-store'
   });
   const data=await res.json();
   if(!res.ok)throw new Error(data.error||('HTTP '+res.status));
   for(const a of data.activities||[]){
    if(!a.polyline){withoutGPS++;continue}
    const pts=decodePolyline(a.polyline);
    if(pts.length<2){withoutGPS++;continue}
    const color='#8458d8';
    const line=L.polyline(pts,{color,weight:3,opacity:.67,interactive:true});
    const name=String(a.name||'Activité Strava');
    const date=a.date?new Date(a.date).toLocaleDateString('fr-FR'):'Date inconnue';
    const km=(Number(a.distance||0)/1000).toFixed(1).replace('.',',');
    const popup=document.createElement('div');
    const heading=document.createElement('strong');heading.textContent=name;
    const desc=document.createElement('p');desc.textContent=date+' · '+km+' km · '+(a.sportType||'');
    const link=document.createElement('a');link.href='https://www.strava.com/activities/'+encodeURIComponent(a.id);
    link.target='_blank';link.rel='noopener noreferrer';link.textContent='Voir sur Strava';
    popup.append(heading,desc,link);line.bindPopup(popup);
    activityLayer.addLayer(line);count++;
   }
   hasMore=data.hasMore===true;
   b.textContent='Activités Strava · '+count;
   await new Promise(resolve=>requestAnimationFrame(resolve));
  }
  if(controller.signal.aborted)return;
  state.stravaActivitiesLoaded=true;
  toast(count+' activités GPS affichées depuis le 08/05/2025'+(withoutGPS?' ('+withoutGPS+' sans trace)':'')+(hasMore?' — limite de pagination atteinte':''));
 }catch(e){
  if(e.name==='AbortError')return;
  clearStravaActivities();
  toast('Activités Strava : '+e.message);
 }finally{if(state.stravaAbort===controller)state.stravaAbort=null}
}
$('strava-layer').addEventListener('click',toggleStravaActivities);
// Use an inexpensive overview geometry for hundreds of trails, retaining full GPS
// accuracy in state.features for the selected trail only.
const previewFeature=f=>{
 const g=f.geometry;
 const simplify=line=>{
   if(line.length<=70)return line;
   const stride=Math.ceil((line.length-1)/69),result=[];
   for(let i=0;i<line.length-1;i+=stride)result.push(line[i]);
   result.push(line[line.length-1]);
   return result;
 };
 const coordinates=g.type==='MultiLineString'?g.coordinates.map(simplify):simplify(g.coordinates);
 return {type:'Feature',geometry:{type:g.type,coordinates},properties:f.properties};
};
function highlightRoute(f){
 if(state.highlight){map.removeLayer(state.highlight);state.highlight=null}
 if(!f)return;
 state.highlight=L.geoJSON(f,{style:{color:'#f4e875',weight:5,opacity:1,interactive:false}}).addTo(map);
}
const isDone=f=>state.overrides[f.properties.id]===true;
const formatNum=n=>n==null?'—':new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1}).format(n);
function toast(s){$('toast').textContent=s;$('toast').classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>$('toast').classList.remove('show'),3200)}
function visible(f){const p=f.properties,st=state.gpx[p.id]?.status;return (!state.query||p.name.toLocaleLowerCase('fr').includes(state.query)) && (p.distance==null||p.distance<=state.maxDistance) && (state.filter==='all'||state.filter==='done'&&isDone(f)||state.filter==='todo'&&!isDone(f)||state.filter==='gpxbad'&&st==='unavailable');}
function refresh(redrawMap=false){const total=state.features.length,done=state.features.filter(isDone),km=done.reduce((s,f)=>s+(f.properties.distance||0),0);$('done-count').textContent=done.length;$('done-total').textContent=`/ ${total} parcours`;$('done-percent').textContent=`${total?(done.length/total*100).toFixed(1).replace('.',','):'0'} % des PR terminés`;$('progress-fill').style.width=`${done.length/total*100}%`;$('done-km').textContent=`${formatNum(km)} km`;$('remaining').textContent=total-done.length;
 const filtered=state.features.filter(visible).sort((a,b)=>state.sortAsc?(a.properties.distance??999)-(b.properties.distance??999):(b.properties.distance??0)-(a.properties.distance??0));$('results').textContent=`${filtered.length} parcours`;
 const list=$('routes');list.replaceChildren();for(const f of filtered.slice(0,350)){const p=f.properties,btn=document.createElement('button');btn.className='route'+(state.selected===p.id?' selected':'');const dot=document.createElement('span');dot.className='dot'+(isDone(f)?' done':'');const content=document.createElement('div');const name=document.createElement('div');name.className='name';name.textContent=p.name;const sub=document.createElement('div');sub.className='sub';sub.textContent=`${formatNum(p.distance)} km · D+ ${formatNum(p.ascent)} m${state.gpx[p.id]?.status==='unavailable'?' · ⚠ GPX':''}`;content.append(name,sub);const arrow=document.createElement('span');arrow.className='arrow';arrow.textContent='›';btn.append(dot,content,arrow);btn.addEventListener('click',()=>showRoute(p.id));list.append(btn)}
 if(redrawMap){tracks.clearLayers();tracks.addData({type:'FeatureCollection',features:filtered.map(f=>state.previews.get(f.properties.id))});}}
function showRoute(id){const f=state.byId.get(id);if(!f)return;state.selected=id;const p=f.properties;$('detail-name').textContent=p.name;$('detail-distance').textContent=`${formatNum(p.distance)} km`;$('detail-ascent').textContent=`${formatNum(p.ascent)} m`;const gp=state.gpx[id];$('detail-status').textContent=gp?.status==='available'?'✓ Fichier GPX vérifié disponible':gp?.status==='unavailable'?'⚠ Fichier GPX indisponible lors du dernier contrôle':gp?.status==='unknown'?'? Vérification GPX non concluante':'GPX non encore vérifié';$('toggle-done').textContent=isDone(f)?'✓ Terminé · annuler':'✓ Marquer comme terminé';const link=$('gpx');link.hidden=!p.gpx;if(p.gpx)link.href=p.gpx;$('sync-hint').textContent=state.user?'Connecté · changements synchronisés avec Firestore.':'Mode consultation · connecte-toi pour enregistrer tes progrès en ligne.';$('sheet').hidden=false;highlightRoute(f);if(state.highlight)map.fitBounds(state.highlight.getBounds(),{padding:[35,35],maxZoom:14});refresh();}
$('close').onclick=()=>{$('sheet').hidden=true;state.selected=null;highlightRoute(null);refresh()};
$('toggle-done').onclick=async()=>{const id=state.selected,f=state.byId.get(id);if(!f)return;if(!state.user||!state.db){toast('Connecte-toi pour sauvegarder tes parcours dans le cloud.');return}if(!state.progressReady){toast('Chargement de ta progression en cours…');return}const previous=state.overrides[id];const next=!isDone(f);state.overrides[id]=next;refresh(true);showRoute(id);try{await state.firebase.setDoc(state.firebase.doc(state.db,'users',state.user.uid,'progress',id),{done:next,updatedAt:state.firebase.serverTimestamp()});toast('Progression enregistrée ✓')}catch(e){if(previous===undefined)delete state.overrides[id];else state.overrides[id]=previous;refresh(true);showRoute(id);toast('Échec de sauvegarde : '+e.message)}};
$('query').oninput=e=>{state.query=e.target.value.toLocaleLowerCase('fr').trim();refresh(true)};$('distance').onchange=e=>{state.maxDistance=+e.target.value;refresh(true)};$('filters').addEventListener('click',e=>{const b=e.target.closest('button[data-filter]');if(!b)return;state.filter=b.dataset.filter;for(const el of $('filters').children)el.classList.toggle('active',el===b);refresh(true)});$('sort').onclick=()=>{state.sortAsc=!state.sortAsc;$('sort').textContent=state.sortAsc?'Distance ↑':'Distance ↓';refresh()};$('fit').onclick=()=>{if(boundary)map.fitBounds(boundary.getBounds());else map.setView([45.8,1.15],10)};
$('locate').onclick=()=>{if(!navigator.geolocation){toast('Géolocalisation indisponible');return}navigator.geolocation.getCurrentPosition(p=>{const latlng=[p.coords.latitude,p.coords.longitude];L.circleMarker(latlng,{radius:8,color:'#fff',weight:3,fillColor:'#2878d8',fillOpacity:1}).addTo(map).bindPopup('Ma position').openPopup();map.setView(latlng,13)},e=>toast('Position non accessible : '+e.message),{enableHighAccuracy:true,timeout:12000})};
$('water').onchange=async e=>{if(e.target.checked){if(!state.markers){const d=await fetch('./data/water.geojson').then(r=>r.json());state.markers=L.geoJSON(d,{pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:4,color:'#fff',weight:1,fillColor:'#1687d1',fillOpacity:.95}),onEachFeature:(f,l)=>l.bindPopup('Eau potable · '+(f.properties.commune||''))})}state.markers.addTo(map)}else state.markers?.remove()};
// Each account owns its own Firestore profile and progress documents.
// No personal data is derived from the public uMap initialDone flag.
async function importLegacyProgress(){
 if(!state.user||!state.db||!state.progressReady)return;
 if(!isLegacyOwner())return;
 const candidates=state.features.filter(f=>f.properties.initialDone&&!isDone(f));
 if(!candidates.length){toast('Les parcours historiques sont déjà importés.');return}
 if(!confirm('Importer '+candidates.length+' PR terminés depuis l’ancien uMap vers ton profil RUNdo ?'))return;
 const btn=$('import-legacy');btn.disabled=true;
 try{
  const batch=state.firebase.writeBatch(state.db);
  for(const f of candidates){
   const ref=state.firebase.doc(state.db,'users',state.user.uid,'progress',f.properties.id);
   batch.set(ref,{done:true,updatedAt:state.firebase.serverTimestamp()});
  }
  await batch.commit();
  toast(candidates.length+' PR importés dans ton profil.');
  btn.hidden=true;
 }catch(e){toast('Import impossible : '+e.message)}finally{btn.disabled=false}
}
$('import-legacy').addEventListener('click',importLegacyProgress);
function isLegacyOwner(){
 return !!(state.user?.uid && firebaseConfig?.legacyOwnerUid && state.user.uid===firebaseConfig.legacyOwnerUid);
}
function profileInfo(user){
 if(!user)return {name:'',photo:''};
 return {name:state.athleteIdentity?.name||user.displayName||user.email||(user.uid.startsWith('strava-')?'Coureur Strava':'Mon profil'),
 photo:state.athleteIdentity?.photo||user.photoURL||''};
}
function showProfile(){
 if(!state.user)return;
 const p=profileInfo(state.user);
 const popup=$('profile-dialog');
 $('profile-name').textContent=p.name;
 $('profile-type').textContent=state.user.uid.startsWith('strava-')?'Compte Strava':'Compte Google';
 $('profile-photo').hidden=!p.photo;
 if(p.photo)$('profile-photo').src=p.photo;
 $('profile-stats').textContent=state.features.filter(isDone).length+' PR terminés sur '+state.features.length;
 popup.hidden=false;
}
$('profile').addEventListener('click',showProfile);
$('profile-close').addEventListener('click',()=>{$('profile-dialog').hidden=true});
function updateIdentity(user){
 $('login').hidden=!!user;$('strava-login').hidden=!!user;$('logout').hidden=!user;
 const info=profileInfo(user);
 $('identity').textContent=user?info.name:'Mode découverte · connecte-toi pour participer';
 $('profile').hidden=!user;
 $('profile').disabled=!user;
 $('import-legacy').hidden=!isLegacyOwner();
}
async function initFirebase(){
 if(!firebaseConfig?.apiKey){
  $('login').textContent='Cloud à configurer';
  $('login').onclick=()=>toast('Configurer Firebase (voir README) pour activer les comptes individuels');
  updateIdentity(null);return;
 }
 try{
  const [app,auth,db]=await Promise.all([
   import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),
   import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js'),
   import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js')
  ]);
  const firebaseApp=app.initializeApp(firebaseConfig);
  state.auth=auth.getAuth(firebaseApp);state.db=db.getFirestore(firebaseApp);state.firebase=db;
  try{await db.enableIndexedDbPersistence(state.db)}catch(e){console.info('Cache Firestore non disponible',e.code)}
  $('login').onclick=()=>auth.signInWithPopup(state.auth,new auth.GoogleAuthProvider()).catch(e=>toast('Connexion impossible : '+e.message));
  // Beta sign-in: keep Google available until existing profiles can be linked/migrated.
// A separate Strava UID is created; never silently replace an active Google session.
const STRAVA_ENABLED=true;
$('strava-login').disabled=!STRAVA_ENABLED;
$('strava-login').textContent='Connexion Strava (test)';
$('strava-login').onclick=()=>{
 if(!STRAVA_ENABLED)return;
 if(state.user&&!state.user.uid.startsWith('strava-')){
  const ok=confirm('La connexion Strava crée actuellement un profil distinct de ton compte Google. Ta progression Google sera conservée mais ne sera pas affichée dans le profil Strava. Continuer le test ?');
  if(!ok)return;
 }
 window.location.assign(STRAVA_START);
};
  if(incomingStravaToken){
   const token=incomingStravaToken;incomingStravaToken=null;
   try{await auth.signInWithCustomToken(state.auth,token);toast('Connexion Strava réussie')}
   catch(e){toast('Connexion Strava impossible : '+e.message)}
  }

  $('logout').onclick=()=>auth.signOut(state.auth);
  let unsubscribe=null,authVersion=0;
  auth.onAuthStateChanged(state.auth,async user=>{
   const version=++authVersion;
   if(unsubscribe){unsubscribe();unsubscribe=null}
   if(!user || (state.user&&state.user.uid!==user?.uid))clearStravaActivities();
   state.user=user;state.overrides={};state.progressReady=false;state.athleteIdentity=null;
   updateIdentity(user);refresh(true);
   if(!user){$('profile-dialog').hidden=true;return}
   if(user.uid.startsWith('strava-')){
    try{
     const tokenDetails=await user.getIdTokenResult();
     if(version!==authVersion)return;
     const claims=tokenDetails.claims;
     state.athleteIdentity={name:typeof claims.stravaName==='string'?claims.stravaName:'Coureur Strava',
       photo:typeof claims.stravaPhoto==='string'?claims.stravaPhoto:''};
     updateIdentity(user);
    }catch(e){console.warn('Profil Strava indisponible',e)}
   }
   try{
    await db.setDoc(db.doc(state.db,'users',user.uid),{
     displayName:profileInfo(user).name.slice(0,100),
     photoURL:profileInfo(user).photo.slice(0,1000),
     updatedAt:db.serverTimestamp()
    },{merge:true});
   }catch(e){console.warn('Profil inaccessible',e);toast('Profil non sauvegardé : vérifie les règles Firestore')}
   if(version!==authVersion)return;
   unsubscribe=db.onSnapshot(db.collection(state.db,'users',user.uid,'progress'),snap=>{
    if(version!==authVersion)return;
    const next={};
    snap.forEach(d=>{if(typeof d.data().done==='boolean')next[d.id]=d.data().done});
    state.overrides=next;state.progressReady=true;
    refresh(true);
    if(state.selected)showRoute(state.selected);
   },e=>{state.progressReady=false;toast('Lecture progression impossible : '+e.message)});
  });
 }catch(e){toast('Configuration Firebase invalide : '+e.message)}
}

async function init(){try{const [r,b,g]=await Promise.all([fetch('./data/routes.geojson').then(r=>r.json()),fetch('./data/boundary.geojson').then(r=>r.json()),fetch('./data/gpx-status.json').then(r=>r.json()).catch(()=>({items:{}}))]);state.features=r.features;state.byId=new Map(r.features.map(f=>[f.properties.id,f]));state.previews=new Map(r.features.map(f=>[f.properties.id,previewFeature(f)]));state.gpx=g.items||{};boundary=L.geoJSON(b,{style:{color:'#43584a',weight:2,fill:false,dashArray:'6 6'}}).addTo(map);map.fitBounds(boundary.getBounds(),{animate:false});refresh(true);setTimeout(()=>map.invalidateSize({pan:false}),250);await initFirebase();}catch(e){toast('Chargement des parcours impossible : '+e.message);console.error(e)}}
init();if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);
