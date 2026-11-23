# Mon Planning

Application d'emploi du temps personnel : calendrier (jour, 3 jours, semaine, mois, liste), tâches, objectifs, organisation automatique de la semaine et bilan de ce qui manque.
Elle s'installe sur le téléphone (PWA), marche hors connexion, se synchronise entre PC et téléphone, et n'a besoin d'aucun serveur ni d'aucun compte payant.

---

## 1. Mettre l'application en ligne (gratuit, environ 10 minutes)

On utilise **GitHub Pages**. C'est gratuit, sans carte bancaire et sans date d'expiration.
Si tu abandonnes le projet, rien ne t'est facturé : le site reste simplement en ligne.

1. Crée un compte sur **https://github.com** (bouton *Sign up*).
2. En haut à droite, clique sur **+** › **New repository**.
   - Repository name : `planning` (ou un autre nom).
   - Coche **Public**. GitHub Pages gratuit l'exige. Seul le code est public : tes données restent sur tes appareils.
   - Clique sur **Create repository**.
3. Sur la page du dépôt, clique sur le lien **uploading an existing file**.
4. Décompresse le zip sur ton PC, ouvre le dossier `mon-planning`, sélectionne **tout son contenu** et glisse-le dans la page.
   Il faut glisser `index.html`, `sw.js`, `manifest.webmanifest`, `README.md` et les dossiers `css`, `js`, `icons`, mais pas le dossier `mon-planning` lui-même.
   Clique ensuite sur **Commit changes**.
5. Va dans **Settings** › **Pages**.
   - Source : **Deploy from a branch**.
   - Branch : **main**, dossier **/ (root)**.
   - Clique sur **Save**.
6. Attends 1 à 2 minutes puis recharge la page. L'adresse de ton app s'affiche :
   `https://TON-PSEUDO.github.io/planning/`

### Installer l'app sur le téléphone
- **iPhone** : ouvre l'adresse dans **Safari**, touche le bouton Partager, puis **« Sur l'écran d'accueil »**.
- **Android** : ouvre l'adresse dans **Chrome**, touche le menu ⋮, puis **« Installer l'application »**.
- **PC** : dans Chrome ou Edge, clique sur l'icône d'installation à droite de la barre d'adresse.

Une fois installée, l'app s'ouvre en plein écran et fonctionne sans réseau.
Sur iPhone, installe-la vraiment sur l'écran d'accueil : Safari peut effacer les données des sites restés plusieurs jours sans visite, mais pas celles des apps installées.

### Mettre à jour l'app plus tard
Dans le dépôt GitHub, utilise **Add file** › **Upload files** et glisse les fichiers modifiés (ils remplacent les anciens).
L'app installée se met à jour toute seule à la prochaine ouverture avec du réseau. **Tes données ne sont pas touchées.**

---

## 2. Synchroniser le PC et le téléphone (gratuit)

La synchronisation passe par un **Gist secret** de ton compte GitHub : c'est le même compte que celui qui héberge l'app, et il n'y a aucun serveur à gérer.

1. Sur le PC, dans l'app : **Réglages › Synchronisation PC ↔ téléphone**.
2. Clique sur le lien de création de jeton. Il ouvre GitHub avec la case **gist** déjà cochée.
   - Expiration : **No expiration**.
   - Clique sur **Generate token**, puis copie le code `ghp_…`.
3. Colle le code dans l'app et clique sur **Connecter**.
4. Sur le téléphone, même chose avec **le même code**. Quand l'app demande quoi faire, choisis **« Utiliser le planning du cloud »**.

Ensuite :
- chaque modification est envoyée au bout d'1 à 2 secondes ;
- l'autre appareil la récupère dès que tu ouvres l'app, puis toutes les minutes tant qu'elle est ouverte ;
- si tu modifies les deux appareils hors ligne, les changements sont **fusionnés** : la modification la plus récente gagne et les suppressions sont respectées ;
- l'état de la synchro est affiché en bas du menu ☰ (touche-le pour forcer une synchro).

Côté sécurité :
- le code reste sur l'appareil ;
- il ne donne accès qu'à tes Gists, pas à tes dépôts ;
- tu peux le révoquer sur github.com › Settings › Developer settings › Tokens.

Sauvegarde de secours : **Réglages › Exporter une sauvegarde (.json)**. Export vers Google Agenda : **Exporter (.ics)**.

---

## 3. Importer l'emploi du temps de cours

**Avec le fichier .ics (le plus simple)** : **Réglages › Importer des cours**, puis « Choisir un fichier » et sélectionne ton `.ics`.
Indique la période (par exemple jusqu'au 09/01) et clique sur **Importer**.

À l'import :
- les examens (`[Examen]`) arrivent dans « Examens & CC » ;
- les révisions se concentrent automatiquement sur les matières dont l'examen approche ;
- la date du TOEFL est détectée.

Les cours du 16/11/2026 au 09/01/2027 sont **déjà inclus** dans l'app.
Quand tu auras un nouveau .ics complet (après le 9 janvier), importe-le avec « à partir du » = la date du jour.

**Avec une capture d'écran** :
1. Fais une capture de ton emploi du temps de la semaine (une ou deux captures, comme d'habitude).
2. Envoie-la à Claude en lui demandant : *« Convertis pour Mon Planning »*.
3. Claude te renvoie un bloc de texte comme celui-ci :
   ```json
   {"format":"edt-cours","events":[
     {"title":"Algèbre linéaire","kind":"TD","start":"2026-11-23T10:00","end":"2026-11-23T11:30","location":"NCHA-108"}
   ]}
   ```
4. Dans l'app, ouvre **Réglages › Importer des cours**, colle le bloc et clique sur **Importer**.

À l'import :
- les cours sont classés automatiquement par matière ;
- une matière inconnue est créée ;
- le sport (`SP`) part dans « Sport » ;
- la semaine est **réorganisée** autour des nouveaux cours : révisions, marges, repas…
- tes événements ajoutés à la main et les créneaux 📌 épinglés ne bougent jamais.

Pour corriger un import, recolle le bloc corrigé : la case « Remplacer les cours déjà importés aux mêmes dates » évite les doublons.

---

## 4. Utilisation rapide

| Action | Ordinateur | Téléphone |
|---|---|---|
| Créer un événement | clic sur un créneau, ou cliquer-glisser pour choisir la durée | toucher un créneau, ou le bouton **+** |
| Déplacer | glisser l'événement | **appui long** puis glisser |
| Changer la durée | tirer le bas de l'événement | appui long sur le bas puis glisser |
| Modifier, dupliquer, supprimer, répéter | clic sur l'événement | toucher l'événement |
| Annuler la dernière action | Ctrl+Z ou bouton « Annuler » | bouton « Annuler » du message |
| Changer de période | flèches ‹ › ou touches ← → | flèches, ou balayage en vue Jour / 3 jours |

Autres fonctions :
- **Vue Jour = check-liste** : tu coches ce qui est fait, avec un trait rouge à l'heure actuelle. Le bouton « Grille » revient à l'affichage horaire. Touche un jour dans la semaine pour l'ouvrir.
- **Tout tient dans l'écran** : la semaine de 7h à minuit s'affiche sans défiler (désactivable dans Réglages › Affichage).
- **Organiser la semaine** (✨) :
  - place automatiquement sommeil, repas, sport, objectifs perso, révisions par matière et marges pour les imprévus ;
  - suit ton ordre de priorité : sommeil › études › repas › sport › objectifs perso › volley/BDE › sorties ;
  - ne touche pas aux cours, aux événements manuels ni aux créneaux épinglés.
- **Bilan** : liste ce qui manque (nuits trop courtes, repas sans créneau, séances de sport, temps sur les objectifs, matières peu révisées, conflits, infos à compléter).
- **Conflits** : deux événements qui se chevauchent sont entourés en rouge. Pour une compétition le jeudi, ajoute-la, puis ouvre le cours concerné et coche « Pas fait / annulé ».
- **Tâches** : le bouton « Planifier » trouve le prochain créneau libre avant l'échéance.
- **Objectifs** : sous-tâches, avancement, temps par semaine, et « Proposer des créneaux ».
- **Réglages** : tout est modifiable (horaires affichés, thème sombre, catégories, matières et dates d'examen, priorités, habitudes, fenêtres de travail, marges…).

---

## 5. Technique

- HTML, CSS et JavaScript, **sans compilation ni dépendance** : les fichiers se servent tels quels.
- Données : `localStorage` (clé `mon-planning-v1`). Synchronisation via l'API GitHub Gists (`js/sync.js`), avec horodatage par élément et suppressions mémorisées. Sauvegarde et restauration en JSON, export iCalendar (.ics).
- PWA : `manifest.webmanifest` et `sw.js` (le réseau d'abord, le cache si hors ligne).
- Code :
  - `js/planner.js` : organisation automatique ;
  - `js/analysis.js` : bilan ;
  - `js/calendar.js` : vues et glisser-déposer ;
  - `js/editors.js` : formulaires ;
  - `js/seed.js` : configuration de départ.
- Tester en local : `python3 -m http.server`, puis ouvre http://localhost:8000.
