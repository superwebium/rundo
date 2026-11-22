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
