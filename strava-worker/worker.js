// RUNdo Strava OAuth -> Firebase custom authentication.
// Deploy this file to Cloudflare Worker "rundo-auth"; NEVER commit credentials.
// Secrets: STRAVA_CLIENT_SECRET, FIREBASE_SERVICE_ACCOUNT (service account JSON)
// Public variable: STRAVA_CLIENT_ID=43297
// Service account JSON is highly sensitive. Store ONLY as an encrypted Worker secret.
const SITE = 'https://superwebium.github.io/rundo/';
const CALLBACK = 'https://rundo-auth.superwebium.workers.dev/callback';
const COOKIE = '__Host-rundo_oauth_state';
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
   iat:now, exp:now+3600, uid
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
  if(url.pathname==='/start'){
   if(request.method!=='GET')return errorPage('Méthode incorrecte',405);
   if(!env.STRAVA_CLIENT_ID||!env.STRAVA_CLIENT_SECRET||!env.FIREBASE_SERVICE_ACCOUNT)return errorPage('Authentification Strava non encore configurée',503);
   const state=b64u(crypto.getRandomValues(new Uint8Array(24)));
   const target=new URL('https://www.strava.com/oauth/authorize');
   target.searchParams.set('client_id',String(env.STRAVA_CLIENT_ID));
   target.searchParams.set('response_type','code');
   target.searchParams.set('redirect_uri',CALLBACK);
   target.searchParams.set('approval_prompt','auto');
   target.searchParams.set('scope','read');
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
    // We deliberately do NOT persist activity/refresh tokens in this login-only version.
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
