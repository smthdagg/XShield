# XShield Guide utilisateur (aperçu rapide en français)

> Guide complet : [简体中文版](USER_GUIDE.zh-CN.md) ou [English](USER_GUIDE.en.md) (1.0.0+).

## Modèle principal

```
Mot-clé détecté → réponse masquée aussitôt, l'auteur entre dans « 触发记录 » (liste en attente)
  → file d'attente de blocage avec 30 minutes de délai
      ├─ sans intervention → blocage automatique au rythme limité
      ├─ liste blanche / suppression → exemption permanente + sortie de file
      └─ bloquer / bloquer la sélection(N) → exécution immédiate
  → succès → déplacé vers « 已拉黑 » (bloqués)
```

Une seule bibliothèque de mots-clés (cloud + personnalisé local).

## Démarrage rapide

1. `chrome://extensions` → Mode développeur → charger `apps/extension/dist`
2. Connexion à x.com ; tableau de bord → Rules & sync → Synchroniser
3. Parcourir X : les réponses détectées sont masquées, les auteurs entrent dans la liste
4. Traiter la liste sur la page des enregistrements (bloquer / liste blanche / supprimer)
5. Page des blocages : statistiques et résultats (300 plus récents paginés + recherche)

## Limitation (réglable sur la page des enregistrements)

300/jour (réglable), lots de 30 (réglable, pause de 15 min), intervalle 5 s ±5 s (réglable), pause 15 min sur 429.

## Liste noire communautaire

`handles.txt` est téléchargé à chaque synchronisation ; avec un GitHub Token, vos handles bloqués fusionnent dans le dépôt du projet pour tous les utilisateurs. Sans token, téléchargement seul.
