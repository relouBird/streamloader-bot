# StreamLoaders Bot API

Service Node.js/TypeScript qui héberge le bot Telegram **StreamLoaders**. Le
bot reçoit une URL vidéo, demande l'analyse ou le téléchargement au service
vidéo distant, puis renvoie le résultat à l'utilisateur dans Telegram.

Le projet expose également une base de serveur Express destinée à accueillir
les routes de l'application StreamLoaders (authentification, médias,
paiements et avis).

## Vue d'ensemble

```text
Utilisateur Telegram
        |
        v
Bot Telegram (ce dépôt)
        |
        | HTTP + X-BOT-SECRET
        v
API StreamLoaders / service vidéo
        |
        v
MySQL
```

Le serveur Express sert aussi une page d'accueil, applique les middlewares
communs (CORS, JSON, sécurité et rate limiting), expose un endpoint de santé
et reçoit les webhooks Telegram en production.

## État actuel du périmètre

- Le bot Telegram est implémenté dans [`src/bot.ts`](./src/bot.ts).
- Le démarrage de l'application et l'ordre d'initialisation sont centralisés
  dans [`src/index.ts`](./src/index.ts).
- Le serveur HTTP, le webhook Telegram et `/api/health` sont gérés par
  [`src/server.ts`](./src/server.ts).
- La connexion MySQL et l'initialisation/migration des tables sont dans
  [`src/database/`](./src/database/).
- Le client du service vidéo est préparé dans
  [`src/utils/videoService.ts`](./src/utils/videoService.ts).
- [`api.md`](./api.md) décrit le contrat API cible consommé par le frontend et
  le bot. Dans l'état actuel du bootstrap, les routeurs métier sont encore à
  monter dans `src/index.ts` ; les routes documentées dans `api.md` ne sont
  donc pas nécessairement toutes actives dans ce dépôt.

## Fonctionnalités du bot

- Mode **polling** en développement.
- Mode **webhook Telegram** en production, avec URL et secret dérivés du token.
- Commandes `/start` et `/help`.
- Réception d'URLs vidéo HTTP(S), analyse et choix du format.
- Téléchargement vidéo, audio et identification musicale optionnelle via
  Shazam/RapidAPI.
- Limites gratuites : 4 minutes par vidéo et 20 téléchargements par jour,
  persistées dans MySQL.
- Liaison d'un compte Telegram à un compte du site via une clé API.
- Nettoyage périodique des fichiers temporaires et arrêt propre du processus.

Le quota quotidien est associé à l'identifiant Telegram et à la date du jour
dans la table `daily_download_limits`. Le compte utilisateur lié, lorsqu'il
existe, détermine directement si le plan est `free` ou `premium`.

## Arborescence

```text
.
├── api.md                  # Contrat et exemples des routes API StreamLoaders
├── package.json            # Scripts et dépendances
├── tsconfig.json           # Configuration TypeScript
├── src/
│   ├── index.ts            # Bootstrap de l'application
│   ├── bot.ts              # Client et handlers Telegram
│   ├── server.ts           # Serveur Express et webhook
│   ├── config/env.ts       # Lecture de la configuration
│   ├── database/
│   │   ├── index.ts        # Pool MySQL
│   │   ├── initORM.ts      # Création et migrations idempotentes
│   │   └── queries.ts      # Requêtes utilisateurs, paiements, téléchargements et avis
│   ├── types/              # Types des données persistées
│   ├── utils/              # Limiteurs, service vidéo, Premium et pages de retour
│   └── public/index.html   # Page d'accueil servie par Express
└── dist/                   # Sortie générée par `npm run build` (ignorée par Git)
```

## Prérequis

- Node.js `>= 18`
- npm
- MySQL accessible par l'application
- Un bot Telegram créé avec BotFather
- L'URL et le secret du service vidéo distant

## Installation locale

```bash
npm install
copy .env.example .env
```

Sous macOS/Linux, utilisez `cp .env.example .env` à la place de `copy`.

Complétez ensuite `.env`. Les variables attendues par le code sont :

| Variable | Rôle |
| --- | --- |
| `NODE_ENV` | `development` pour le polling, `production` pour le webhook |
| `PORT` | Port HTTP local, par défaut `3000` |
| `APP_URL` | URL publique de l'application ; obligatoire en webhook et doit être en HTTPS |
| `API_URL` | URL de l'API consommée par le bot |
| `API_SECRET` | Secret utilisé comme clé JWT côté serveur |
| `TELEGRAM_BOT_TOKEN` | Token du bot Telegram |
| `DB_HOST`, `DB_PORT` | Hôte et port MySQL |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Identifiants et base MySQL |
| `VIDEO_SERVICE_URL` | URL du microservice vidéo |
| `VIDEO_SERVICE_SECRET` | Secret envoyé dans `X-Service-Secret` |
| `X_BOT_SECRET` | Secret partagé optionnel entre le bot et l'API |
| `SHAZAM_API_KEY` | Clé RapidAPI, nécessaire pour l'identification musicale |
| `SHAZAM_API_HOST` | Hôte RapidAPI ; une valeur par défaut est fournie |

Ne commitez jamais `.env`, `.env.test.local` ou `.env.prod.local`. Ces fichiers
sont ignorés par Git ; utilisez `.env.example` comme modèle sans y placer de
secret.

## Commandes

```bash
# Compiler TypeScript vers dist/
npm run build

# Lancer la version compilée
npm start

# Développement avec rechargement automatique
npm run dev
```

La commande `npm run build` compile TypeScript puis copie les assets statiques
de `src/public/` vers `dist/public/`. Cette seconde étape est nécessaire car
TypeScript ne copie pas les fichiers HTML, CSS ou autres fichiers non-TS.

Au démarrage, l'application :

1. charge la configuration ;
2. initialise ou met à jour les tables MySQL (`users`, `transactions`,
   `downloads_log` et `reviews`) ;
3. démarre Express ;
4. démarre le bot en polling ou en webhook ;
5. monte le health check et le webhook Telegram ;
6. installe les handlers d'arrêt propre.

Le health check est disponible sur `GET /api/health` et renvoie notamment
`status`, `version`, `uptime` et un timestamp.

## Documentation API

La documentation détaillée du contrat consommé par le frontend et le bot se
trouve dans [`api.md`](./api.md). Elle couvre notamment :

- authentification (`/api/auth/*`) ;
- analyse, téléchargement et progression média (`/api/media/*`) ;
- paiements et webhooks de paiement (`/api/payment/*`) ;
- routes de test de paiement ;
- health check.

Pour ajouter ou activer ces fonctionnalités dans ce dépôt, les routeurs
correspondants doivent être enregistrés dans le bootstrap, avant l'appel à
`server.finalize()`.

## Déploiement

En production, configurez `NODE_ENV=production`, utilisez une URL publique
HTTPS dans `APP_URL` et faites passer les requêtes vers le port de l'application
via le reverse proxy ou le gestionnaire de processus utilisé par votre
infrastructure. Telegram doit pouvoir atteindre le chemin de webhook généré
par le bot :

```text
/telegram/webhook/<token dérivé>
```

Le serveur utilise `trust proxy` pour récupérer l'IP client derrière un proxy
et applique un limiteur global de 200 requêtes par IP toutes les 15 minutes.
Des limiteurs plus ciblés sont disponibles dans
[`src/utils/limiters.ts`](./src/utils/limiters.ts).

Le déploiement PlanetHoster est décrit par deux workflows GitHub Actions :

- [`main.yml`](./.github/workflows/main.yml) déploie automatiquement chaque
  push sur `main` ;
- [`first-deployment.yml`](./.github/workflows/first-deployment.yml) initialise
  manuellement une nouvelle installation.

Les fichiers de configuration de production (`.env`, `.env.*`, `.htaccess`,
etc.) doivent être créés directement sur le serveur avant le premier
déploiement. Les workflows ne copient jamais les fichiers `.env` locaux et ne
transmettent pas les secrets de production dans le dépôt.
Les mises à jour utilisent l'ancien et le nouveau commit de `main`, conservent
les fichiers cachés du serveur et ne réinitialisent pas la base de données. Le
démarrage de l'application applique uniquement les créations de tables et
migrations additives prévues par [`initORM.ts`](./src/database/initORM.ts).

## Branches de travail

La hiérarchie de branches prévue pour ce projet est :

```text
main
└── dev
    └── sync-process
```

Les changements de cette session sont réalisés sur `sync-process`, créée à
partir de `dev`, elle-même créée à partir de `main`.

## Points d'attention

- Les versions affichées par le serveur et le health check ne sont pas encore
  alignées sur la version `2.1.0` de `package.json`.
- Le statut `yt-dlp` décrit dans `api.md` concerne le service vidéo distant ;
  il n'est pas vérifié directement par ce processus Node.
- La liaison Telegram nécessite une clé API valide du compte du site ; un
  identifiant Telegram ne peut être associé qu'à un seul compte.
- Les routes de paiement doivent conserver une validation de webhook côté
  serveur et ne jamais faire confiance aux données envoyées par le navigateur.

## Licence

Aucune licence n'est actuellement déclarée dans le dépôt.
