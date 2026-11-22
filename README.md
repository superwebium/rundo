# RUNdo — Tous les PR de Haute-Vienne

PWA mobile, sans serveur personnel : **GitHub Pages (front-end) + Firebase Authentication / Firestore (progression) + GitHub Actions (contrôle périodique des liens GPX)**.

## Contenu migré

- 343 PR identifiés, avec leurs tracés d'origine, distances, dénivelés, IDs et liens GPX ; 69 sont initialement marqués `Terminé=ok` dans le backup uMap.
- 205 points d'eau (affichage optionnel) et limite du département.
- Les deux points isolés présents dans la couche des chemins ne sont pas traités comme des PR.
- L'état initial n'est **pas** copié en base : chaque parcours utilise `initialDone` tant qu'aucune modification n'est enregistrée pour lui. Les changements s'enregistrent dans `users/<uid>/progress/<route_id>` et sont synchronisés entre appareils.

## Mise en ligne

1. Créer un **dépôt public** GitHub nommé `rundo` (GitHub Pages gratuit pour un dépôt public sur compte personnel). Ajouter tous les fichiers de ce dossier, y compris `.github/workflows/`.
2. Dans le dépôt, **Settings → Pages → Build and deployment → Source : GitHub Actions**.
3. Dans Firebase Console : créer un projet, ajouter une application **Web**, activer **Authentication → Sign-in method → Google**, puis **Firestore Database** (mode production).
4. Remplacer `firebaseConfig = null` dans `firebase-config.js` par la configuration de l'application Web Firebase (`apiKey`, `authDomain`, `projectId`, `appId`, etc.). Ces identifiants **ne sont pas des secrets** ; la protection des données dépend des règles Firestore.
5. Dans Firestore → Rules, coller `firestore.rules` en remplaçant `REPLACE_WITH_YOUR_GOOGLE_EMAIL` par l'adresse Google autorisée. Publier les règles. Ne pas laisser les règles ouvertes.
6. Dans Firebase Authentication → Settings → Authorized domains, ajouter `<votre_login>.github.io` (sans protocole ni chemin). Il peut être nécessaire d'utiliser une connexion par redirection si le navigateur bloque la popup.
7. Le workflow `Publish RUNdo` déploie l'application après chaque push. URL : `https://<votre_login>.github.io/rundo/`.
8. Dans GitHub Actions, lancer manuellement `Check GPX availability` pour remplir `data/gpx-status.json`, puis laisser le contrôle hebdomadaire agir.

## Utilisation

La carte et les parcours sont consultables sans compte. **La sauvegarde des changements est désactivée tant que Firebase n'est pas configuré et que l'utilisateur n'est pas connecté.** Une connexion Google autorisée permet de modifier l'état `terminé` et de le retrouver sur d'autres appareils.

Le bouton de géolocalisation demande la permission du navigateur. Les tuiles de carte OpenStreetMap nécessitent Internet. La PWA ne garantit pas l'accès cartographique totalement hors ligne.

## Contrôle GPX

`scripts/check_gpx.py` vérifie chaque lien en téléchargeant au plus 5 Mo, valide le XML et la présence d'un élément GPX (`trk`, `rte`, `wpt`). Les codes 404/410 sont `unavailable`, les autres échecs (403, 429, réseau, réponse HTML...) sont `unknown`, pas une preuve de suppression du sentier. Le résultat est enregistré dans `data/gpx-status.json`, puis commité par GitHub Actions ; aucun compte Firebase privilégié n'est nécessaire au script. Vérification hebdomadaire (lundi 03:17 UTC), déclenchable à la demande. Le robot peut être limité par les sites tiers.

Un GPX disponible ne prouve pas que le PR est toujours officiellement ouvert ou praticable.

## Reconstruction des données

`python scripts/build_data.py chemin/vers/export.umap` régénère les couches. **Attention :** cette commande réinitialise aussi le fichier de statut GPX. La progression personnelle reste sauvegardée dans Firestore.

## Développement local

Lancer `python -m http.server 8000`, puis ouvrir `http://localhost:8000`. Ne pas ouvrir directement `index.html` depuis le disque : les modules et `fetch()` nécessitent HTTP(S).

## Sécurité et confidentialité

- Les chemins sont dans un dépôt public et leurs tracés sont publics ; la progression utilisateur est stockée dans Firestore, privée selon les règles ci-dessus.
- Ne jamais commiter de clés de compte de service Firebase ou de jetons GitHub.
- Prévoir des exports réguliers de Firestore ; l'absence d'export constitue une limite de cette première version.
- Ne pas oublier de vérifier les quotas/conditions d'utilisation d'OpenStreetMap et de Firebase avant un usage public soutenu.
