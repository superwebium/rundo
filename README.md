# RUNdo — Challenge des PR de Haute-Vienne

Application cartographique PWA avec **profils individuels**.

## Architecture
- GitHub Pages : carte et interface sans backend permanent.
- Firebase Authentication (Google) : compte personnel.
- Cloud Firestore : données isolées sous `users/<uid>` et `users/<uid>/progress/<routeId>`.
- GitHub Actions : vérification des liens GPX.
- Strava (à venir) : liaison OAuth sécurisée et comparaison des activités, via fonction serverless. **Aucun jeton Strava dans le navigateur ou GitHub Pages**.

## Données
Les 343 PR, 205 points d’eau et limites du département sont publics et partagés.
Les 69 PR terminés de l'ancien uMap sont une donnée **historique personnelle**, non une progression commune : un nouvel utilisateur démarre à **0/343**.
Une fois Firebase configuré, le propriétaire peut importer volontairement ses anciens PR à l'aide du bouton dédié. Pour afficher ce bouton, renseigner `legacyOwnerEmail` dans `firebase-config.js`, correspondant à **l'adresse du compte Google utilisé pour se connecter à RUNdo**. Pour les autres comptes, le bouton n'est pas visible.

## Activer les comptes
1. Dans [Firebase Console](https://console.firebase.google.com), créer un projet et enregistrer une application Web.
2. Activer Authentication > Sign-in method > Google.
3. Ajouter `superwebium.github.io` dans Authentication > Settings > Authorized domains.
4. Créer Cloud Firestore en mode production.
5. Publier le contenu du fichier `firestore.rules` dans Firestore > Rules.
6. Remplacer `export const firebaseConfig = null;` par l'objet public Firebase Web contenant `apiKey`, `authDomain`, `projectId`, `appId` (et éventuellement `legacyOwnerEmail`).
7. Vérifier avec deux comptes Google différents : chaque profil doit démarrer à zéro ; une validation sur le premier compte ne doit apparaître sur le second.

**Important** : les règles Firestore ne sont pas automatiquement publiées via GitHub Pages. Il faut explicitement les appliquer dans la console Firebase avant d'activer le multi-utilisateur.

## Strava : architecture future
- Association optionnelle du compte Strava après connexion RUNdo.
- OAuth 2.0 sur un endpoint HTTPS serverless avec gestion sécurisée du secret et des refresh tokens.
- Stockage privé des jetons inaccessible aux clients Firestore.
- Reconnaissance GPS proposée et confirmée par l'utilisateur, sans partage par défaut de ses activités.
- Vérifier les règles API Strava avant l'ouverture à des amis et avant tout classement.

## Données & maintenance
- Les données originales dans `data/routes.geojson` conservent `initialDone` pour l'import historique, mais ce champ n'est plus interprété comme état actuel d'un nouvel utilisateur.
- La progression de chacun est enregistrée par UID, avec timestamp de modification.
- Les fichiers GPX sont vérifiés par `scripts/check_gpx.py` et `.github/workflows/check-gpx.yml`.
- Le basemap est sélectionnable dans l'interface.
- Ne jamais publier de clés de service Firebase, secrets OAuth Strava ou refresh tokens dans GitHub.
