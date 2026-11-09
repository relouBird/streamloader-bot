# Changements à reporter sur le projet principal

Ce fichier décrit les changements de ce clone par rapport au premier commit
`1b78fc4` (`first commit`). Il sert de guide de portage vers le projet
principal. Les commits listés ci-dessous existent dans l'historique Git de ce
clone.

## Ordre historique

```text
1b78fc4  first commit
  └─ df7ccd3  Somes changes on deployment process.
      └─ 2bc9dc5  Somes changes on process.
          └─ 8a90739  Breaking changes on bot.
              └─ 0f37cf5  env bot secret correction
                  └─ 3d84262  Breaking changes on process of bot images.
                      └─ 28d04a9  Somes changes on Configuration of Telegram Bot
                          └─ 8fa43b9  Add optional site offer flow
```

Le dernier commit historique est `8fa43b9` (`main` et `origin/main`). Le
premier commit est donc la base de production originale ; les commits suivants
constituent les écarts à examiner et à reporter sélectivement. Les changements
non encore commités de documentation alignent maintenant le clone sur le
contrat API v2 effectivement retenu.

## 1. `df7ccd3` — déploiement

Fichiers modifiés :

- `.github/workflows/main.yml`
- `.github/workflows/first-deployment.yml`

Objectif :

- adapter le processus de déploiement PlanetHoster/CloudLinux ;
- conserver la configuration serveur `.env` ;
- reconstruire et redémarrer l'application via `cloudlinux-selector`.

Point important : le workflow ne copie volontairement pas `.env`. Les
variables Telegram doivent donc être configurées directement dans
`$HOME/testbot/.env`.

## 2. `2bc9dc5` — ajustements bot et page publique

Fichiers modifiés :

- `src/bot.ts`
- `src/public/index.html`

Objectif :

- ajuster le comportement du bot ;
- mettre à jour le contenu de la page publique.

Porter ce commit après avoir vérifié les changements métier dans le diff.

## 3. `8a90739` — configuration Telegram et registre utilisateur

Fichiers modifiés :

- `.env.example`
- `.gitignore`
- `README.md`
- `src/assets/logo.jpg`
- `src/bot.ts`
- `src/config/bot.ts`
- `src/utils/userStore.ts`

Ajouts fonctionnels :

- configuration du nom, des descriptions et des commandes Telegram ;
- configuration de la photo de profil ;
- configuration de la photo du message de bienvenue ;
- configuration du texte `/start` ;
- compteur local des utilisateurs privés ;
- fichier runtime `data/bot-users.json`, ignoré par Git ;
- registre appelé par `/start` et les messages privés.

Décision de portage :

- porter `src/config/bot.ts` et les appels `setMy*` si le projet principal
  utilise la même bibliothèque ;
- porter `userStore.ts` uniquement si un compteur local est réellement voulu ;
- préférer la base/API métier pour une statistique multi-instance durable ;
- ne jamais reporter de secrets depuis `.env.prod.local`.

## 4. `0f37cf5` — secret API

Fichier modifié :

- `src/config/bot.ts`

Objectif :

- corriger la lecture du secret inter-services.

À reporter manuellement en vérifiant le nom exact de la variable et sans
copier de valeur secrète dans Git.

## 5. `3d84262` — images du bot

Fichiers modifiés :

- `.env.example`
- `README.md`
- `scripts/copy-public.js`
- `src/assets/logo.jpg`
- `src/assets/welcome.jpg`
- `src/bot.ts`
- `src/config/bot.ts`

Ajouts fonctionnels :

- résolution des chemins d'images depuis la racine, `src/` ou `dist/` ;
- copie de `src/assets` vers `dist/assets` pendant le build ;
- envoi d'une photo optionnelle avec `/start` ;
- upload d'une photo de profil via `setMyProfilePhoto`.

Point de vigilance :

- l'image envoyée par `/start` est un message Telegram ;
- la photo d'introduction affichée par le client Telegram peut rester gérée
  par BotFather et n'est pas garantie par l'API Bot ;
- une erreur d'upload ne doit pas empêcher l'installation des handlers.

## 6. `28d04a9` — configuration Telegram et démarrage

Fichiers modifiés :

- `.env.example`
- `README.md`
- `src/bot.ts`
- `src/config/bot.ts`

Ajouts et corrections :

- configuration de l'identité et du menu Telegram ;
- `/start` accepte aussi `/start@nom_du_bot` ;
- configuration Telegram rendue non bloquante ;
- timeout de 15 secondes par appel de configuration ;
- logs d'erreurs explicites ;
- démarrage du polling/webhook et installation des handlers indépendants de
  l'API de configuration.

Le point essentiel à conserver est l'ordre suivant :

```ts
await bot.start();
bot.startBot();
bot.getMessage();
bot.callbackQuery();
```

`bot.start()` ne doit pas attendre indéfiniment les appels `setMyName`,
`setMyDescription`, `setMyProfilePhoto` ou `setChatMenuButton`.

## 7. Offre optionnelle vers le site — contrat du bot

Fichiers modifiés ou ajoutés :

- `.env.example`
- `README.md`
- `read-api.md`
- `ads.md`
- `src/config/env.ts`
- `src/bot.ts`

Le bot appelle `POST /api/bot/site-offer` uniquement après qu'un utilisateur
actif a reçu son fichier. L'API doit répondre `showSupportButton` et, si
nécessaire, un `redirectToken` temporaire signé. Le bot n'envoie aucun message
si l'API indique qu'aucune offre n'est due. La fonctionnalité est désactivée
par défaut avec `TELEGRAM_SITE_OFFER_ENABLED=false`.

Cette fonctionnalité ne doit jamais conditionner le téléchargement à une
visite, une impression publicitaire ou un clic.

## 8. Contrat API v2 et identité Telegram

Fichiers de référence :

- `read-api.md`
- `ads.md`

Le contrat v2 corrige le problème d'identité du flux :

- `POST /api/bot/session` reçoit `telegramId` et crée ou met à jour
  `telegram_users` ;
- la session JWT porte ensuite l'identité Telegram ;
- `POST /api/bot/site-offer` utilise cette session et ne reçoit pas de
  `telegramId` supplémentaire ;
- `telegram_users.last_offer_at` applique la fenêtre de six heures ;
- `telegram_site_offer_events` conserve `jti`, `token_hash`, `offered_at`,
  `expires_at` et `verified_at` ;
- le site vérifie le jeton avec `POST /api/bot/verify-offer` et
  `x-site-offer-secret` ;
- `SITE_OFFER_SECRET` n'est jamais placé dans le bot ou dans le navigateur.

Les statistiques doivent distinguer l'offre envoyée (`offered_at`) de la
validation serveur (`verified_at`) et de la page réellement rendue
(`visited_at`). Le bouton reste optionnel et le téléchargement reste
indépendant du flux publicitaire.

## 9. Déplacement des stores

Fichiers concernés :

- suppression de `src/utils/sessionStore.ts` ;
- suppression de `src/utils/userStore.ts` ;
- ajout de `src/stores/sessionStore.ts` ;
- ajout de `src/stores/userStore.ts` ;
- mise à jour des imports dans `src/bot.ts`.

Il s'agit d'un déplacement organisationnel sans changement de comportement.
Les chemins d'import du projet principal doivent être adaptés en conséquence.

## 10. Nettoyage des documentations sur le serveur

Fichiers modifiés :

- `.github/workflows/main.yml`
- `.github/workflows/first-deployment.yml`

Les fichiers Markdown restent versionnés dans Git et disponibles dans le dépôt,
mais ne sont plus conservés dans le répertoire applicatif de production. Les
deux workflows exécutent, après le build et avant le redémarrage, une
suppression des fichiers `*.md` sous `$HOME/testbot`.

Le nettoyage exclut `$HOME/testbot/.git` afin de préserver le mécanisme de
déploiement suivant (`git fetch`, `git reset` et comparaison des révisions).
Le fichier `.env` reste également protégé par le processus existant : il est
ignoré et n'est jamais copié depuis GitHub.

Cette suppression est répétée à chaque déploiement, ce qui retire aussi les
anciens fichiers Markdown déjà présents sur le serveur. Elle ne modifie pas
les fichiers du dépôt local ni les fichiers suivis dans Git.

## Différence globale à reporter

Depuis `1b78fc4`, le clone ajoute ou modifie :

- le déploiement automatique ;
- la configuration Telegram par environnement ;
- les assets du bot ;
- l'initialisation du menu Telegram ;
- le compteur local des utilisateurs ;
- la robustesse du démarrage ;
- l'offre optionnelle vers le site après téléchargement ;
- la documentation du contrat API de cette offre ;
- le contrat API v2 et la persistance des utilisateurs Telegram ;
- le déplacement organisationnel des stores ;
- la fusion du contrat v2 dans `read-api.md` ;
- le nettoyage des fichiers Markdown lors des déploiements GitHub Actions ;
- certains textes et contenus publics.

Commande utile pour le portage :

```bash
git diff 1b78fc4..28d04a9
git diff --name-status 1b78fc4..28d04a9
git log --reverse --oneline 1b78fc4..28d04a9
```

## Ce qui ne doit pas être copié aveuglément

- `.env`, `.env.prod.local` et tout token ;
- `dist/` ou `node_modules/` ;
- `data/bot-users.json` ;
- des changements de déploiement si l'infrastructure du projet principal
  diffère ;
- une logique de publicité qui conditionnerait l'accès au téléchargement ;
- un stockage local si plusieurs instances du bot sont prévues.

## État de ce document

Ce document est un inventaire de portage. Il ne prétend pas résoudre les
conflits du projet principal. Avant application, comparer les versions de
`src/bot.ts`, de la configuration et des workflows, puis reporter chaque
changement avec les tests adaptés.
