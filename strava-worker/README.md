# Backend Strava RUNdo — Cloudflare Worker

Worker Cloudflare : `rundo-auth.superwebium.workers.dev`

## Déploiement

Remplacer le code Hello World du Worker par `worker.js` depuis l'éditeur Cloudflare (ou utiliser Wrangler).
Ne pas publier de secrets ni de JSON de compte de service dans GitHub.

Dans **Settings → Variables and Secrets**, ajouter :

- `STRAVA_CLIENT_ID` — variable texte publique : `43297`
- `STRAVA_CLIENT_SECRET` — **Secret** : valeur fournie par Strava
- `FIREBASE_SERVICE_ACCOUNT` — **Secret** : JSON complet du compte de service Firebase (à protéger particulièrement)

Dans Strava API Settings, définir **Authorization Callback Domain** à `superwebium.workers.dev`.
L'URL de retour configurée dans le Worker est `https://rundo-auth.superwebium.workers.dev/callback`.

`/health` doit répondre `{"ok":true}`. `/start` renverra une erreur 503 tant que les secrets ne sont pas installés.

## Sécurité / limites

- OAuth state vérifié contre un cookie HttpOnly/Secure/SameSite=Lax, valable 10 minutes.
- Le secret Strava et la clé privée Firebase ne sont jamais renvoyés au navigateur.
- Le jeton Firebase temporaire est renvoyé dans le fragment d'URL et doit être immédiatement effacé par le front.
- L'UID Firebase est `strava-<id athlète>`, **différent de l'ancien UID Google**.
- **Ne pas désactiver Google avant d'avoir migré volontairement l'historique existant** : les comptes ne sont pas fusionnés automatiquement.
- Cette version sert uniquement à **l'authentification** ; elle ne stocke pas de jetons Strava et ne synchronise pas encore les activités.
- La création d'une clé privée de compte de service Firebase implique un risque élevé : la conserver uniquement comme secret chiffré Cloudflare et limiter l'accès administrateur.
- Exige des règles Firestore multi-utilisateurs publiées sur le projet Firebase.

## Profil RUNdo (nouvelle version)

La nouvelle version de `worker.js` inclut le prénom, le nom et la miniature de profil Strava dans les claims Firebase signés. **Elle doit être redéployée manuellement dans Cloudflare** (les commits GitHub ne mettent pas le Worker à jour automatiquement).

Après redéploiement, se déconnecter puis se reconnecter avec Strava pour rafraîchir ces informations. La session Firebase existante reste utilisable ; elle ne contient pas encore les nouveaux claims tant qu'une nouvelle authentification Strava n'a pas été effectuée.

## Import de l'historique uMap

L'import des PR historiquement terminés est volontaire et limité côté interface à l'UID Firebase `legacyOwnerUid` indiqué dans la configuration publique de RUNdo. L'UID est obtenu dans Firebase Authentication > Utilisateurs, avec le préfixe `strava-`.

L'import ne peut ajouter des validations qu'au profil actuellement connecté. Il ne lit ni ne modifie les documents d'autres utilisateurs. La valeur d'UID configurée côté client n'est **pas un secret de sécurité** : l'autorisation d'écriture est imposée par les règles Firestore, qui isolent tous les profils.

La connexion Google reste disponible en secours tant que la migration n'a pas été vérifiée.


## Calque Activités Strava — depuis le 8 mai 2025

Nécessite un **namespace Workers KV** (aucun jeton utilisateur dans le dépôt ou le navigateur).

1. Cloudflare → **Storage & databases → KV** → créer un namespace `rundo-strava-tokens`.
2. Cloudflare → Workers & Pages → `rundo-auth` → **Settings → Bindings → Add → KV namespace**.
3. Associer le namespace créé avec le nom de binding exact **`STRAVA_TOKENS`**.
4. Cloudflare → Worker → **Settings → Variables and Secrets** : ajouter la variable texte publique `FIREBASE_WEB_API_KEY` avec la **clé API Web Firebase déjà présente dans `firebase-config.js`** (pas la clé du compte de service).
5. Remplacer le code du Worker Cloudflare par la dernière version de `strava-worker/worker.js`, puis **Deploy**.
6. Se déconnecter puis se reconnecter dans RUNdo avec Strava. La nouvelle autorisation demande `read,activity:read_all`. L'utilisateur doit l'approuver pour accéder à ses propres activités, y compris celles dont la visibilité est limitée à lui-même.
7. Cliquer sur le bouton **Activités Strava** dans la carte. Le calque reste **désactivé au démarrage**, même après une connexion.

Le Worker stocke dans KV les jetons de l'athlète sous `strava:<id>` et renouvelle le jeton d'accès si nécessaire. Il ne renvoie au client que les résumés d'activités et leurs polylignes simplifiées, après validation du jeton Firebase de l'utilisateur. CORS est limité à `https://superwebium.github.io`. Chaque athlète ne voit que ses propres sorties. Aucun calque partagé ou classement n'est proposé.

L'API utilise `GET /api/activities?page=N`, avec 200 activités par page et limite de 30 pages côté client, en filtrant à partir du 8 mai 2025 00:00 heure française. Les activités sans polyligne GPS ne sont pas affichées. Le calque n'utilise **pas** les traces GPS haute précision : une future version pourra les charger à la demande pour un parcours sélectionné.

**Attention** : sans le binding KV et la variable Firebase, l'API renverra 503. L'authentification Strava existante continuera de fonctionner mais le calque ne pourra pas charger d'activités. Les quotas Strava s'appliquent ; si le site reçoit une réponse 429, réessayer plus tard. Les modifications GitHub n'actualisent jamais automatiquement le Worker Cloudflare tant qu'aucune chaîne de déploiement Worker n'est configurée.

### Confidentialité

Les informations d'activité Strava sont visibles uniquement par l'athlète concerné, conformément aux restrictions Strava. Ne pas afficher de traces d'un utilisateur aux autres. En cas de révocation Strava, les jetons enregistrés doivent être supprimés du KV ; prévoir les webhooks de désautorisation avant d'ouvrir l'application à un grand nombre de personnes.
