# Monétisation du bot Telegram — Téléchargeur de vidéos

## Objectif

Garder le téléchargement **gratuit**, tout en finançant le service grâce à la publicité, sans dégrader l’expérience utilisateur ni prendre de risques inutiles avec les régies publicitaires.

## Principe retenu

Le message central sera :

> **Téléchargement gratuit, financé par la publicité.**

L’utilisateur peut soutenir le projet **volontairement** en visitant le site web. Aucun téléchargement ne doit être bloqué derrière une publicité ou un Smartlink.

## Parcours utilisateur

1. L’utilisateur envoie un lien vidéo au bot.
2. Le bot traite la demande et envoie la vidéo.
3. Après l’envoi, le bot affiche un message de soutien :

```text
✅ Ta vidéo a été téléchargée avec succès !

🎬 Téléchargement gratuit, financé par la publicité.

Tu peux soutenir le projet en visitant notre site :
[ Soutenir le projet ]
```

4. Le bouton envoie vers le site web avec un paramètre de suivi, par exemple :

```text
https://monsite.com/?src=telegram_bot&uid=123456&t=token_unique
```

5. Sur le site, une popup s’affiche immédiatement, sans délai imposé :

```text
Merci d’avoir visité notre site 💙

Ton soutien nous aide à garder le téléchargeur gratuit.

[ Retourner au bot ]
```

6. Le Smartlink Adsterra peut être proposé comme bouton optionnel, jamais comme condition d’accès.

## Règles importantes

- Le clic sur « Soutenir le projet » doit rester **optionnel**.
- Ne pas imposer de minuteur de plusieurs secondes avant l’affichage de la popup.
- Ne pas écrire « Regarde la pub pour télécharger » ou « Clique pour débloquer ».
- Ne pas conditionner le téléchargement à une visite, un clic ou une attente publicitaire.
- Le site doit apporter une valeur réelle : page d’accueil, informations, aperçu, historique, support, etc.
- Les bannières et popups du site restent possibles, mais sans être présentées comme la condition d’accès au service.

## Fréquence des messages

- Afficher le message de soutien **une fois toutes les 6 heures maximum** par utilisateur.
- Cela correspond à **4 messages maximum par jour**.
- Enregistrer la date du dernier message envoyé pour chaque utilisateur.
- Ne pas renvoyer le message si l’utilisateur vient déjà d’interagir avec le bot.

## Limite gratuite et option payante

Pour rendre le modèle plus durable :

- Offrir par exemple **3 téléchargements gratuits par jour**.
- Au-delà, proposer un déblocage via **Telegram Stars** ou un abonnement.
- Le message peut être :

```text
🎬 Il te reste 1 téléchargement gratuit aujourd’hui.

🚀 Débloque 5 téléchargements supplémentaires avec 25 Stars.
```

## Gestion technique du lien

- Générer un **token signé côté serveur**, jamais un simple paramètre modifiable comme `?ad=1`.
- Le token doit contenir ou référencer :
  - l’identifiant Telegram de l’utilisateur ;
  - la source : `telegram_bot` ;
  - une date d’expiration ;
  - une signature vérifiable.
- Le token doit être à usage unique ou limité dans le temps.
- La validation doit se faire côté serveur, pas uniquement dans le navigateur.
- Utiliser des identifiants de source différents pour mesurer les performances :
  - `telegram_bot`
  - `site_web`
  - `canal_telegram`
  - `groupe_telegram`

## Formats publicitaires

| Emplacement | Format | Statut |
|---|---|---|
| Site web | Bannières | Autorisé |
| Site web | Popup non bloquante | À utiliser avec modération |
| Site web | Smartlink optionnel | Autorisé |
| Bot Telegram | Bouton « Soutenir le projet » | Autorisé |
| Bot Telegram | Clic obligatoire pour télécharger | À éviter |
| Bot Telegram | Minuteur publicitaire avant téléchargement | À éviter |

## Message final recommandé

```text
✅ Ta vidéo est prête !

🎬 Téléchargement gratuit, financé par la publicité.

Tu peux soutenir le projet en visitant notre site :
[ Soutenir le projet ]

💡 Tu peux aussi débloquer plus de téléchargements avec Telegram Stars.
```

## À retenir

Le modèle doit reposer sur :

- un service réellement utile ;
- une publicité volontaire ;
- une expérience utilisateur propre ;
- une monétisation secondaire via Telegram Stars ou abonnement ;
- des liens tracés et sécurisés côté serveur.

Le Smartlink et les publicités sont un complément, pas une barrière d’accès au téléchargement.
