# Guide utilisateur XShield

## 1. Installation

1. Ouvrez `chrome://extensions` dans Chrome.
2. Activez le **mode développeur**.
3. Cliquez sur **Load unpacked**.
4. Sélectionnez `apps/extension/dist`.
5. Épinglez XShield dans la barre d'outils Chrome.

Construire depuis le code source :

```bash
corepack enable
pnpm install
pnpm build
```

Chargez ensuite `apps/extension/dist`.

## 2. Créer des règles

Dans **Rules**, créez des règles de détection.

- `keyword` : mot-clé simple, un par ligne.
- `regex` : expression régulière, une par ligne.
- Champs analysés : username, displayName, bio, content.
- Score : score de risque ajouté quand la règle correspond.

Les publications détectées sont surlignées en jaune clair, et les utilisateurs sont ajoutés à la liste des candidats.

## 3. Examiner les candidats

Dans **Candidate Users**, vérifiez l'avatar, le lien du profil, la bio, les abonnés et la raison de détection. Ajoutez les faux positifs à la liste blanche et les cibles confirmées à la file de blocage.

## 4. Exécuter la file de blocage

- **Run Batch** : respecte la taille du lot, l'intervalle et le mode configurés.
- **Manual Block Now** : ignore l'intervalle configuré. Trop de blocages en une seule fois peuvent affecter le compte.
- **Start/Stop** : met en pause ou reprend la file automatique.

## 5. Exporter les utilisateurs bloqués

Dans **Blocked Users**, exportez les données en TXT, CSV, JSON, NDJSON ou SQL.

## 6. Avertissement sur le mode réel

Le mode réel dépend de la session X/Twitter ouverte dans Chrome. Il peut cesser de fonctionner si X modifie son API web, sa connexion, sa gestion CSRF ou sa structure de page. Utilisez des lots prudents et des intervalles suffisants.
