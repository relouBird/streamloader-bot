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
- Le bot ne lit plus directement la base de données : le compte, le plan, les
  quotas et les autorisations viennent de l'API dédiée.
- Les sessions JWT sont conservées dans un cache LRU borné et temporaire,
  défini dans [`src/stores/sessionStore.ts`](./src/stores/sessionStore.ts).
- [`read-api.md`](./read-api.md) décrit l'unique contrat API v2 consommé par le
  bot.
  Dans l'état actuel du bootstrap, les routeurs métier sont encore à monter
  dans `src/index.ts` ; les routes documentées ne sont donc pas nécessairement
  toutes actives dans ce dépôt.

## Fonctionnalités du bot

- Mode **polling** en développement.
- Mode **webhook Telegram** en production, avec URL et secret dérivés du token.
- Identité Telegram configurable dans `src/config/bot.ts` ou via `.env` :
  nom, descriptions, photo JPEG, commandes et bouton de menu.
- Menu Telegram natif configuré avec `/start`, `/help` et `/link`.
- Compteur persistant des utilisateurs privés enregistré dans
  `data/bot-users.json` et affiché dans `/start`.
- Commandes `/start` et `/help`.
- Réception d'URLs vidéo HTTP(S), analyse et choix du format.
- Téléchargement vidéo, audio et identification musicale optionnelle via
  Shazam/RapidAPI.
- Les limites gratuites sont appliquées par l'API dédiée.
- Liaison d'un compte Telegram à un compte du site via une clé API.
- Nettoyage périodique des fichiers temporaires et arrêt propre du processus.

Le registre local du compteur conserve l'identifiant Telegram, le prénom et le
nom d'utilisateur facultatif. Il est ignoré par Git, n'est pas transmis à
l'API et n'est pas partagé entre plusieurs instances du bot.

Le quota quotidien est associé à l'identifiant Telegram et à la date du jour
dans la table `daily_download_limits`. Le compte utilisateur lié, lorsqu'il
existe, détermine directement si le plan est `free` ou `premium`.

## Arborescence

```text
.
├── read-api.md             # Contrat API v2 consommé par le bot
├── read-monetization.md    # Contrat Monetisation
├── ads.md                  # Contrat API pour ads pour le bot
├── BREAKING-CHANGES.md     # Contrat des modifications entre le testbot et le bot
├── package.json            # Scripts et dépendances
├── tsconfig.json           # Configuration TypeScript
├── src/
│   ├── index.ts            # Bootstrap de l'application
│   ├── bot.ts              # Client et handlers Telegram
│   ├── server.ts           # Serveur Express et webhook
│   ├── config/             # Configuration de l'environnement et du bot
│   ├── stores/             # Cache de session et registre local des utilisateurs
│   ├── utils/              # Limiteurs et pages de retour
│   ├── assets/             # Images du profil et du message de bienvenue
│   └── public/index.html   # Page d'accueil servie par Express
└── dist/                   # Sortie générée par `npm run build` (ignorée par Git)
```

## Prérequis

- Node.js `>= 18`
- npm
- API StreamLoaders accessible par le bot
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
| `SITE_URL` | URL du site utilisée par le bouton de visite optionnel |
| `TELEGRAM_BOT_TOKEN` | Token du bot Telegram |
| `TELEGRAM_SITE_OFFER_ENABLED` | Active la demande d'offre site après un téléchargement réussi |
| `TELEGRAM_BOT_NAME` | Nom public du bot |
| `TELEGRAM_BOT_DESCRIPTION` | Description affichée dans le chat vide |
| `TELEGRAM_BOT_SHORT_DESCRIPTION` | Description courte du profil |
| `TELEGRAM_BOT_PROFILE_PHOTO` | Photo JPEG affichée dans l'écran vide du bot |
| `TELEGRAM_BOT_WELCOME_PHOTO` | Chemin vers la photo envoyée avec `/start` |
| `TELEGRAM_BOT_WELCOME_TITLE` | Nom affiché dans le message `/start` |
| `TELEGRAM_BOT_WELCOME_TEXT` | Texte complémentaire du message `/start` |
| `TELEGRAM_BOT_COMMANDS` | Tableau JSON optionnel des commandes Telegram |
| `X_BOT_SECRET` | Secret partagé entre le bot et l'API |
| `SHAZAM_API_KEY` | Clé RapidAPI, nécessaire pour l'identification musicale |
| `SHAZAM_API_HOST` | Hôte RapidAPI ; une valeur par défaut est fournie |

Ne commitez jamais `.env`, `.env.test.local` ou `.env.prod.local`. Ces fichiers
sont ignorés par Git ; utilisez `.env.example` comme modèle sans y placer de
secret.

Les chemins relatifs sont recherchés depuis la racine du projet puis depuis
`src/`. Ainsi, un fichier placé dans `src/assets/logo.jpg` peut être configuré
avec `TELEGRAM_BOT_PROFILE_PHOTO=./assets/logo.jpg`. Le build recopie ensuite
`src/assets/` dans `dist/assets/`.

Au démarrage, le bot appelle `setMyName`, `setMyDescription`,
`setMyShortDescription`, `setMyProfilePhoto`, `setMyCommands` et
`setChatMenuButton`. La photo est renvoyée à Telegram comme nouveau fichier à
chaque démarrage ; utilisez donc un fichier JPEG local. Le compteur concerne
les utilisateurs ayant envoyé un message privé au bot, et non les membres
d'un canal ou d'un groupe.

Si `TELEGRAM_SITE_OFFER_ENABLED=true` et `SITE_URL` est défini, le bot demande
à l'API, uniquement après l'envoi réussi d'un téléchargement à l'utilisateur,
si un bouton de visite doit être affiché. L'API applique la fréquence de six
heures et fournit un jeton temporaire vérifié côté serveur du site. Une erreur
de cette fonctionnalité ne bloque jamais le téléchargement.

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
de `src/public/` vers `dist/public/` et les images de `src/assets/` vers
`dist/assets/`. Cette seconde étape est nécessaire car TypeScript ne copie pas
les fichiers non-TS.

Au démarrage, l'application :

1. charge la configuration ;
2. démarre Express ;
3. démarre le bot en polling ou en webhook ;
4. configure le menu natif Telegram ;
5. monte le health check et le webhook Telegram ;
6. installe les handlers d'arrêt propre.

Le health check est disponible sur `GET /api/health` et renvoie notamment
`status`, `version`, `uptime` et un timestamp.

## Documentation API

La documentation détaillée du contrat consommé par le frontend et le bot se
trouve dans [`read-api.md`](./read-api.md). La v2 couvre notamment :

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
les fichiers cachés du serveur et ne réinitialisent pas la base de données. La
base reste gérée par l'API StreamLoaders, pas par ce bot.
Les fichiers Markdown restent suivis dans Git, mais sont retirés du répertoire
de production après le build.

## Branches de travail

La hiérarchie de branches prévue pour ce projet est :

```text
main
└── dev
    └── testbot-port
```

Les changements de portage du testbot sont réalisés sur `testbot-port`, créée
à partir de `dev`, elle-même créée à partir de `main`.

## Points d'attention

- Les versions affichées par le serveur et le health check ne sont pas encore
  alignées sur la version `2.1.0` de `package.json`.
- Le statut `yt-dlp` décrit dans `read-api.md` concerne le service vidéo
  distant ;
  il n'est pas vérifié directement par ce processus Node.
- La liaison Telegram nécessite une clé API valide du compte du site ; un
  identifiant Telegram ne peut être associé qu'à un seul compte.
- Le bot ne possède plus de connexion MySQL locale : la base, les quotas et
  les plans sont exclusivement gérés par l'API.
- Les routes de paiement doivent conserver une validation de webhook côté
  serveur et ne jamais faire confiance aux données envoyées par le navigateur.

## Licence

Aucune licence n'est actuellement déclarée dans le dépôt.
