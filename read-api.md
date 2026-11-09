# API dédiée au bot Telegram

> **Version du contrat : v2**

Le bot ne doit plus importer `database/queries` et ne doit plus appliquer les
quotas ou vérifier le plan localement. L'API est la source de vérité pour le
compte lié, le plan, les quotas, la durée maximale et les autorisations.

## Configuration du bot

Dans l'environnement du bot :

```env
API_URL=https://api.example.com/api
X_BOT_SECRET=<même secret long que sur l'API>
```

`X_BOT_SECRET` est un secret inter-services. Il ne doit jamais être envoyé à
Telegram, au navigateur ou dans une URL.

## 1. Obtenir une session bot

Le bot renouvelle sa session au démarrage et lorsqu'elle expire :

```http
POST /api/bot/session
x-bot-token: <X_BOT_SECRET>
Content-Type: application/json

{"telegramId":123456789}
```

Réponse :

```json
{
  "success": true,
  "token": "<JWT valable 15 minutes>",
  "expiresIn": "1d",
  "user": null
}
```

`user` contient le compte lié, ou `null` si le chat Telegram n'est pas encore
lié.

L'API crée ou met à jour `telegram_users` pendant cet appel. La session JWT
porte ensuite l'identité Telegram authentifiée ; les routes protégées n'ont
pas besoin de recevoir un `telegramId` fourni par le client.

## 2. Lier un compte

Le bot envoie la clé API saisie en message privé uniquement à l'API :

```http
POST /api/bot/link
x-bot-token: <X_BOT_SECRET>
Content-Type: application/json

{"telegramId":123456789,"apiKey":"sl_..."}
```

La réponse contient une nouvelle session bot et les informations publiques du
compte. La clé API ne doit pas être conservée par le bot et ne doit jamais être
journalisée.

## 3. Utiliser la session

Pour les appels suivants, utiliser uniquement :

```http
Authorization: Bearer <JWT de session bot>
```

### Profil

```http
GET /api/bot/me
```

### Analyse

```http
GET /api/bot/media/analyze?url=https%3A%2F%2Fexample.com%2Fvideo
```

### Démarrer un téléchargement

```http
POST /api/bot/media/download/start
Content-Type: application/json

{"url":"https://example.com/video","quality":"1080p","title":"video"}
```

### Musique

```http
POST /api/bot/media/music/start
Content-Type: application/json

{"query":"artist title official audio","title":"title","artist":"artist","coverUrl":null}
```

### Progression et fichier

```http
GET /api/bot/media/progress/<jobId>
GET /api/bot/media/file/<jobId>
```

Le endpoint de progression est un flux SSE et doit conserver
`Accept: text/event-stream`.

## Règles à retirer du bot

- `queries.getUserByTelegramId`
- `queries.linkTelegramAccount`
- `queries.consumeDailyDownload`
- les contrôles locaux du plan Premium et de la durée maximale
- l'en-tête `x-bot-token` sur les routes `/media/*` après migration vers
  `/api/bot/*`

Le bot peut conserver les contrôles purement ergonomiques, comme vérifier
qu'un texte ressemble à une URL avant de l'envoyer. Toute décision de sécurité
ou de quota doit rester dans l'API.

## Renouvellement

Sur une réponse `401` provenant d'une route `/api/bot/*`, le bot doit refaire
`POST /api/bot/session` avec son `telegramId`, puis rejouer la requête une seule
fois. Il ne doit pas boucler indéfiniment.

## Offre optionnelle vers le site

Après un téléchargement réellement envoyé à Telegram, le bot peut demander
si une offre de visite du site est due :

```http
POST /api/bot/site-offer
Authorization: Bearer <session bot>
Content-Type: application/json

{"source":"telegram_bot"}
```

Cette route ne doit être appelée que pour l'utilisateur actif qui vient de
terminer un téléchargement. Elle ne doit pas diffuser de campagne globale.
L'API applique la fréquence minimale (par exemple six heures) et retourne :

```json
{
  "showSupportButton": true,
  "redirectToken": "<jeton court signé>",
  "nextEligibleAt": "2026-11-06T20:00:00.000Z"
}
```

Si aucune offre n'est due :

```json
{"showSupportButton":false}
```

Le bot ne bloque jamais l'envoi du fichier si cette route échoue. Le jeton
est destiné à l'URL `SITE_URL/from-telegram?t=...`; le site doit le vérifier
auprès de l'API côté serveur. Un simple `telegramId` en URL n'est pas accepté.

L'API enregistre atomiquement la date de l'offre décidée afin que deux
téléchargements simultanés ne produisent pas deux messages. La preuve que le
site a effectivement été visité est une métrique distincte, enregistrée par
le serveur du site lors de la validation du jeton.

### 4. Vérifier une offre côté site

Le navigateur ne doit jamais appeler directement cette route avec le secret.
Le serveur du site reçoit le paramètre `t`, puis appelle l'API :

```http
POST /api/bot/verify-offer
Content-Type: application/json
x-site-offer-secret: <SITE_OFFER_SECRET>

{"token":"<jeton reçu par le site>"}
```

Le secret est partagé uniquement entre le serveur du site et l'API. Il est
distinct de `X_BOT_SECRET` et n'est jamais envoyé au bot, à Telegram ou au
navigateur.

Réponse valide :

```json
{
  "valid": true,
  "campaign": "site_visit",
  "source": "telegram_bot",
  "expiresAt": "2026-11-06T15:00:00.000Z"
}
```

La vérification peut enregistrer `verified_at` et associer l'événement au
`jti` de `telegram_site_offer_events`. Le site ne doit pas déduire une visite
réelle de la seule présence du bouton Telegram.
