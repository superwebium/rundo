// RUNdo Strava OAuth -> Firebase custom authentication.
// Deploy this file to Cloudflare Worker "rundo-auth"; NEVER commit credentials.
// Secrets: STRAVA_CLIENT_SECRET, FIREBASE_SERVICE_ACCOUNT (service account JSON)
// Public variable: STRAVA_CLIENT_ID=43297
// Service account JSON is highly sensitive. Store ONLY as an encrypted Worker secret.
const SITE = 'https://superwebium.github.io/rundo/';
const CALLBACK = 'https://rundo-auth.superwebium.workers.dev/callback';
const COOKIE = '__Host-rundo_oauth_state';
const ORIGIN = 'https://superwebium.github.io';
const AFTER = Math.floor(Date.parse('2025-05-08T00:00:00Z')/1000);
const PAGE_SIZE = 200;
const corsHeaders={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Authorization','Vary':'Origin','Cache-Control':'private, no-store'};
function apiError(message,status=400){return new Response(JSON.stringify({error:message}),{status,headers:{...corsHeaders,'Content-Type':'application/json; charset=utf-8'}})}
async function authenticatedAthlete(request, env){
 const match=/^Bearer (.+)$/i.exec(request.headers.get('Authorization')||'');
 if(!match)return null;
 // Validate Firebase ID token with Firebase's own authentication endpoint.
 const response=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(env.FIREBASE_WEB_API_KEY),{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:match[1]})
 });
 if(!response.ok)return null;
 const data=await response.json(),uid=data.users?.[0]?.localId||'';
 return /^strava-[0-9]+$/.test(uid)?uid.slice(7):null;
}
async function accessTokenForAthlete(env,athleteId){
 const key='strava:'+athleteId;
 const record=await env.STRAVA_TOKENS.get(key,'json');
 if(!record?.refresh_token)throw new Error('Reconnecter le compte Strava pour autoriser les activités');
 if(record.access_token && record.expires_at>Date.now()/1000+120)return record.access_token;
 const refresh=await fetch('https://www.strava.com/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({client_id:String(env.STRAVA_CLIENT_ID),client_secret:env.STRAVA_CLIENT_SECRET,grant_type:'refresh_token',refresh_token:record.refresh_token})});
 if(!refresh.ok)throw new Error('Renouvellement du jeton Strava refusé ('+refresh.status+')');
 const tokens=await refresh.json();
 const updated={access_token:tokens.access_token,refresh_token:tokens.refresh_token,expires_at:tokens.expires_at};
 await env.STRAVA_TOKENS.put(key,JSON.stringify(updated));
 return updated.access_token;
}
async function listActivities(request,env,url){
 if(request.headers.get('Origin')!==ORIGIN)return apiError('Origine non autorisée',403);
 if(!env.STRAVA_TOKENS||!env.FIREBASE_WEB_API_KEY)return apiError('Stockage Strava non configuré',503);
 const athleteId=await authenticatedAthlete(request,env);
 if(!athleteId)return apiError('Session Strava invalide',401);
 const page=Number(url.searchParams.get('page')||'1');
 if(!Number.isInteger(page)||page<1||page>100)return apiError('Page invalide');
 try{
  const token=await accessTokenForAthlete(env,athleteId);
  const target=new URL('https://www.strava.com/api/v3/athlete/activities');
  target.searchParams.set('after',String(AFTER));
  target.searchParams.set('per_page',String(PAGE_SIZE));
  target.searchParams.set('page',String(page));
  const res=await fetch(target,{headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
  if(!res.ok)return apiError('Strava a renvoyé HTTP '+res.status,res.status===429?429:502);
  const raw=await res.json();
  if(!Array.isArray(raw))return apiError('Réponse Strava invalide',502);
  // Return only minimal, owner-private mapping information, never raw Strava tokens.
  const activities=raw.map(a=>({id:a.id,name:a.name||'Activité',date:a.start_date_local||a.start_date||null,
   distance:a.distance||0,sportType:a.sport_type||a.type||'',polyline:a.map?.summary_polyline||null})); 
  return new Response(JSON.stringify({activities,page,hasMore:raw.length===PAGE_SIZE,after:'2025-05-08'}),{
   headers:{...corsHeaders,'Content-Type':'application/json; charset=utf-8'}
  });
 }catch(e){console.error('Activity lookup error',e?.message?.slice(0,120));return apiError(e.message||'Erreur Strava',502)}
}
const utf8 = new TextEncoder();
const b64u = data => {
  const b = data instanceof Uint8Array ? data : utf8.encode(data);
  let str='';for(const byte of b)str+=String.fromCharCode(byte);
  return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
function json(obj,status=200){return new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
const baseHeaders={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const clearCookie=`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
function errorPage(message,status=400){
 return new Response('RUNdo : '+message+'\nRetour : '+SITE,{status,headers:{...baseHeaders,'Content-Type':'text/plain; charset=utf-8','Set-Cookie':clearCookie}});
}
function privateKeyBytes(pem){
 const raw=pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
 return Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
}
async function customToken(serviceAccount,athlete){
 const key=await crypto.subtle.importKey('pkcs8',privateKeyBytes(serviceAccount.private_key),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const now=Math.floor(Date.now()/1000);
 // Namespaced UID ensures a Strava user never collides with other Firebase identities.
 const uid='strava-'+String(athlete.id);
 const header=b64u(JSON.stringify({alg:'RS256',typ:'JWT'}));
 const payload=b64u(JSON.stringify({
   iss:serviceAccount.client_email,
   sub:serviceAccount.client_email,
   aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
   iat:now, exp:now+3600, uid,
   claims: {
     stravaName: [athlete.firstname, athlete.lastname].filter(Boolean).join(' ').slice(0,100) || 'Coureur Strava',
     stravaPhoto: (athlete.profile_medium || athlete.profile || '').slice(0,1000),
     stravaAthleteId: String(athlete.id)
   }
 }));
 const input=header+'.'+payload;
 const signature=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,utf8.encode(input)));
 return input+'.'+b64u(signature);
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.hostname!=='rundo-auth.superwebium.workers.dev')return errorPage('Hôte inattendu',403);
  if(url.pathname==='/health')return json({ok:true,service:'rundo-auth'});
  if(url.pathname==='/api/activities'){
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders});
   if(request.method!=='GET')return apiError('Méthode non autorisée',405);
   return listActivities(request,env,url);
  }
  if(url.pathname==='/start'){
   if(request.method!=='GET')return errorPage('Méthode incorrecte',405);
   if(!env.STRAVA_CLIENT_ID||!env.STRAVA_CLIENT_SECRET||!env.FIREBASE_SERVICE_ACCOUNT)return errorPage('Authentification Strava non encore configurée',503);
   const state=b64u(crypto.getRandomValues(new Uint8Array(24)));
   const target=new URL('https://www.strava.com/oauth/authorize');
   target.searchParams.set('client_id',String(env.STRAVA_CLIENT_ID));
   target.searchParams.set('response_type','code');
   target.searchParams.set('redirect_uri',CALLBACK);
   target.searchParams.set('approval_prompt','force');
   target.searchParams.set('scope','read,activity:read_all');
   target.searchParams.set('state',state);
   return new Response(null,{status:302,headers:{...baseHeaders,'Location':target.toString(),'Set-Cookie':`${COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`}});
  }
  if(url.pathname==='/callback'){
   if(request.method!=='GET')return errorPage('Méthode incorrecte',405);
   const cookie=request.headers.get('Cookie')||'';
   const match=cookie.match(/(?:^|;\s*)__Host-rundo_oauth_state=([^;]+)/);
   const state=url.searchParams.get('state');
   if(!state||!match||match[1]!==state)return errorPage('Session OAuth expirée ou invalide. Recommence la connexion.');
   if(url.searchParams.get('error')||!url.searchParams.get('code'))return errorPage('Autorisation Strava refusée.');
   try{
    const response=await fetch('https://www.strava.com/oauth/token',{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:String(env.STRAVA_CLIENT_ID),client_secret:env.STRAVA_CLIENT_SECRET,code:url.searchParams.get('code'),grant_type:'authorization_code'}),
    });
    if(!response.ok)return errorPage('Échange OAuth Strava impossible ('+response.status+').',502);
    const strava=await response.json();
    const athlete=strava.athlete;
    if(!athlete||!Number.isSafeInteger(Number(athlete.id)))return errorPage('Identité Strava indisponible.',502);
    // Save encrypted-at-rest token material in private Cloudflare KV, never in GitHub Pages.
    if(env.STRAVA_TOKENS && strava.refresh_token && String(strava.scope||url.searchParams.get('scope')||'').includes('activity:read_all')){
     await env.STRAVA_TOKENS.put('strava:'+String(athlete.id),JSON.stringify({
       access_token:strava.access_token,refresh_token:strava.refresh_token,expires_at:strava.expires_at
     }));
    }
    const account=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    if(account.project_id!=='rundo-863fb')return errorPage('Projet Firebase incorrect.',503);
    const token=await customToken(account,athlete);
    // Fragment is not sent to GitHub Pages servers; frontend removes it immediately.
    const destination=SITE+'#strava_token='+encodeURIComponent(token);
    return new Response(null,{status:302,headers:{...baseHeaders,'Location':destination,'Set-Cookie':clearCookie}});
   }catch(e){console.error('OAuth callback failed',e?.name);return errorPage('Authentification temporairement indisponible.',502)}
  }
  return json({service:'RUNdo Strava OAuth',status:'ready',health:'/health',start:'/start'});
 }
};
