# RUNdo — Tous les PR de Haute-Vienne

Application cartographique mobile (PWA) pour suivre les parcours de petite randonnée de Haute-Vienne.

## Architecture cible

- **GitHub Pages** : interface mobile statique et données géographiques GeoJSON.
- **Firebase Authentication + Cloud Firestore** : enregistrement et synchronisation de la progression sur smartphone et ordinateur.
- **GitHub Actions** : déploiement et vérification périodique de la disponibilité des liens GPX.

## État du dépôt

Dépôt initialisé. Le code complet préparé (application et export des 343 parcours) doit encore être importé dans ce dépôt avant de pouvoir publier la PWA. **Ne pas activer le déploiement en considérant ce README comme une application fonctionnelle.**

## Préparation Firebase

1. Créer un projet Firebase et une application Web.
2. Activer l'authentification Google et Cloud Firestore.
3. Configurer les domaines autorisés pour l'authentification, les règles de sécurité Firestore et la configuration Firebase publique de l'application.
4. Ne jamais commiter de clé de compte de service ni de jeton privé.

## Source des données

Export uMap RUNdo : parcours, points d'eau et limite départementale, à conserver avec les identifiants de parcours stables pour préserver la progression synchronisée.
