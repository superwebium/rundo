import {firebaseConfig} from './firebase-config.js';
const $=id=>document.getElementById(id);
const state={features:[],byId:new Map(),overrides:{},filter:'all',query:'',maxDistance:999,selected:null,gpx:{},user:null,db:null,auth:null,markers:null,sortAsc:true,previews:new Map(),highlight:null};
const map=L.map('map',{zoomControl:false,preferCanvas:true}).setView([45.80,1.15],10);
// CARTO basemap: single provider, no automatic fallback that can trigger
// another storm of failing tile requests. Designed for a small personal web app.
const baseLayer=L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',{
 subdomains:'abcd',maxZoom:19,keepBuffer:1,updateWhenIdle:true,
 attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
}).addTo(map);
let failedTiles=0;
baseLayer.on('tileload',()=>{failedTiles=0});
baseLayer.on('tileerror',()=>{
 if(++failedTiles===4){console.warn('RUNdo: basemap tiles refused/blocked; inspect Network tab for HTTP status');toast('Fond de carte inaccessible : vérifier les requêtes réseau (F12).')}
});
L.control.zoom({position:'bottomright'}).addTo(map);
// Only invalidate after the responsive layout has settled. Avoid a ResizeObserver
// feedback loop and unnecessary tile cancellation during initial loading.
let resizeTimer;
window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>map.invalidateSize({pan:false}),180)},{passive:true});
window.addEventListener('orientationchange',()=>setTimeout(()=>map.invalidateSize({pan:false}),250));
const tracks=L.geoJSON(null,{style:f=>({color:isDone(f)?'#4b965c':'#e8794d',weight:isDone(f)?5:3,opacity:.86}),onEachFeature:(f,layer)=>layer.on('click',()=>showRoute(f.properties.id))}).addTo(map);
let boundary;
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
const isDone=f=>state.overrides[f.properties.id]??f.properties.initialDone;
const formatNum=n=>n==null?'—':new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1}).format(n);
function toast(s){$('toast').textContent=s;$('toast').classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>$('toast').classList.remove('show'),3200)}
function visible(f){const p=f.properties,st=state.gpx[p.id]?.status;return (!state.query||p.name.toLocaleLowerCase('fr').includes(state.query)) && (p.distance==null||p.distance<=state.maxDistance) && (state.filter==='all'||state.filter==='done'&&isDone(f)||state.filter==='todo'&&!isDone(f)||state.filter==='gpxbad'&&st==='unavailable');}
function refresh(redrawMap=false){const total=state.features.length,done=state.features.filter(isDone),km=done.reduce((s,f)=>s+(f.properties.distance||0),0);$('done-count').textContent=done.length;$('done-total').textContent=`/ ${total} parcours`;$('done-percent').textContent=`${(done.length/total*100).toFixed(1).replace('.',',')} % du territoire exploré`;$('progress-fill').style.width=`${done.length/total*100}%`;$('done-km').textContent=`${formatNum(km)} km`;$('remaining').textContent=total-done.length;
 const filtered=state.features.filter(visible).sort((a,b)=>state.sortAsc?(a.properties.distance??999)-(b.properties.distance??999):(b.properties.distance??0)-(a.properties.distance??0));$('results').textContent=`${filtered.length} parcours`;
 const list=$('routes');list.replaceChildren();for(const f of filtered.slice(0,350)){const p=f.properties,btn=document.createElement('button');btn.className='route'+(state.selected===p.id?' selected':'');const dot=document.createElement('span');dot.className='dot'+(isDone(f)?' done':'');const content=document.createElement('div');const name=document.createElement('div');name.className='name';name.textContent=p.name;const sub=document.createElement('div');sub.className='sub';sub.textContent=`${formatNum(p.distance)} km · D+ ${formatNum(p.ascent)} m${state.gpx[p.id]?.status==='unavailable'?' · ⚠ GPX':''}`;content.append(name,sub);const arrow=document.createElement('span');arrow.className='arrow';arrow.textContent='›';btn.append(dot,content,arrow);btn.addEventListener('click',()=>showRoute(p.id));list.append(btn)}
 if(redrawMap){tracks.clearLayers();tracks.addData({type:'FeatureCollection',features:filtered.map(f=>state.previews.get(f.properties.id))});}}
function showRoute(id){const f=state.byId.get(id);if(!f)return;state.selected=id;const p=f.properties;$('detail-name').textContent=p.name;$('detail-distance').textContent=`${formatNum(p.distance)} km`;$('detail-ascent').textContent=`${formatNum(p.ascent)} m`;const gp=state.gpx[id];$('detail-status').textContent=gp?.status==='available'?'✓ Fichier GPX vérifié disponible':gp?.status==='unavailable'?'⚠ Fichier GPX indisponible lors du dernier contrôle':gp?.status==='unknown'?'? Vérification GPX non concluante':'GPX non encore vérifié';$('toggle-done').textContent=isDone(f)?'✓ Terminé · annuler':'✓ Marquer comme terminé';const link=$('gpx');link.hidden=!p.gpx;if(p.gpx)link.href=p.gpx;$('sync-hint').textContent=state.user?'Connecté · changements synchronisés avec Firestore.':'Mode consultation · connecte-toi pour enregistrer tes progrès en ligne.';$('sheet').hidden=false;highlightRoute(f);if(state.highlight)map.fitBounds(state.highlight.getBounds(),{padding:[35,35],maxZoom:14});refresh();}
$('close').onclick=()=>{$('sheet').hidden=true;state.selected=null;highlightRoute(null);refresh()};
$('toggle-done').onclick=async()=>{const id=state.selected,f=state.byId.get(id);if(!f)return;if(!state.user||!state.db){toast('Connecte-toi pour sauvegarder tes parcours dans le cloud.');return}const previous=state.overrides[id];const next=!isDone(f);state.overrides[id]=next;refresh(true);showRoute(id);try{await state.firebase.setDoc(state.firebase.doc(state.db,'users',state.user.uid,'progress',id),{done:next,updatedAt:state.firebase.serverTimestamp()});toast('Progression enregistrée ✓')}catch(e){if(previous===undefined)delete state.overrides[id];else state.overrides[id]=previous;refresh(true);showRoute(id);toast('Échec de sauvegarde : '+e.message)}};
$('query').oninput=e=>{state.query=e.target.value.toLocaleLowerCase('fr').trim();refresh(true)};$('distance').onchange=e=>{state.maxDistance=+e.target.value;refresh(true)};$('filters').addEventListener('click',e=>{const b=e.target.closest('button[data-filter]');if(!b)return;state.filter=b.dataset.filter;for(const el of $('filters').children)el.classList.toggle('active',el===b);refresh(true)});$('sort').onclick=()=>{state.sortAsc=!state.sortAsc;$('sort').textContent=state.sortAsc?'Distance ↑':'Distance ↓';refresh()};$('fit').onclick=()=>{if(boundary)map.fitBounds(boundary.getBounds());else map.setView([45.8,1.15],10)};
$('locate').onclick=()=>{if(!navigator.geolocation){toast('Géolocalisation indisponible');return}navigator.geolocation.getCurrentPosition(p=>{const latlng=[p.coords.latitude,p.coords.longitude];L.circleMarker(latlng,{radius:8,color:'#fff',weight:3,fillColor:'#2878d8',fillOpacity:1}).addTo(map).bindPopup('Ma position').openPopup();map.setView(latlng,13)},e=>toast('Position non accessible : '+e.message),{enableHighAccuracy:true,timeout:12000})};
$('water').onchange=async e=>{if(e.target.checked){if(!state.markers){const d=await fetch('./data/water.geojson').then(r=>r.json());state.markers=L.geoJSON(d,{pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:4,color:'#fff',weight:1,fillColor:'#1687d1',fillOpacity:.95}),onEachFeature:(f,l)=>l.bindPopup('Eau potable · '+(f.properties.commune||''))})}state.markers.addTo(map)}else state.markers?.remove()};
async function initFirebase(){if(!firebaseConfig?.apiKey){$('login').textContent='Cloud à configurer';$('login').onclick=()=>toast('Configurer firebase-config.js et Firestore selon README.md');return}try{const [app,auth,db]=await Promise.all([import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js'),import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js')]);const firebaseApp=app.initializeApp(firebaseConfig);state.auth=auth.getAuth(firebaseApp);state.db=db.getFirestore(firebaseApp);state.firebase=db;try{await db.enableIndexedDbPersistence(state.db)}catch(e){console.info('Cache Firestore non disponible',e.code)}$('login').onclick=()=>auth.signInWithPopup(state.auth,new auth.GoogleAuthProvider()).catch(e=>toast('Connexion impossible : '+e.message));$('logout').onclick=()=>auth.signOut(state.auth);let unsubscribe=null;auth.onAuthStateChanged(state.auth,user=>{if(unsubscribe){unsubscribe();unsubscribe=null}state.user=user;$('login').hidden=!!user;$('logout').hidden=!user;if(!user){state.overrides={};refresh(true);return}toast('Connecté : '+(user.email||'compte Google'));unsubscribe=db.onSnapshot(db.collection(state.db,'users',user.uid,'progress'),snap=>{const next={};snap.forEach(d=>{if(typeof d.data().done==='boolean')next[d.id]=d.data().done});state.overrides=next;refresh(true);if(state.selected)showRoute(state.selected)},e=>toast('Lecture progression impossible : '+e.message))})}catch(e){toast('Configuration Firebase invalide : '+e.message)}}
async function init(){try{const [r,b,g]=await Promise.all([fetch('./data/routes.geojson').then(r=>r.json()),fetch('./data/boundary.geojson').then(r=>r.json()),fetch('./data/gpx-status.json').then(r=>r.json()).catch(()=>({items:{}}))]);state.features=r.features;state.byId=new Map(r.features.map(f=>[f.properties.id,f]));state.previews=new Map(r.features.map(f=>[f.properties.id,previewFeature(f)]));state.gpx=g.items||{};boundary=L.geoJSON(b,{style:{color:'#43584a',weight:2,fill:false,dashArray:'6 6'}}).addTo(map);map.fitBounds(boundary.getBounds(),{animate:false});refresh(true);setTimeout(()=>map.invalidateSize({pan:false}),250);await initFirebase();}catch(e){toast('Chargement des parcours impossible : '+e.message);console.error(e)}}
init();if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);
