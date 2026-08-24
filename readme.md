# eFootball Cup — Tournois entre amis (League & Knockout)

## Démarrer le serveur et lancer le site

### 1. Installation (une seule fois)

```bash
npm install
```

Créer ensuite un fichier `.env` à la racine (ou copier `.env.example`) :

```
PORT=3000
ADMIN_PASSWORD=admin1234
SESSION_SECRET=
LOG_LEVEL=info
```

> Prérequis : Node.js 22 ou supérieur.

### 2. Lancer en mode développement

```bash
npm run dev
```

- API : http://localhost:3000
- Site (front) : **http://localhost:5173** ← ouvrir cette adresse dans le navigateur

### 3. Lancer en mode production (à partager sur le réseau local / LAN)

```bash
npm run build
npm start
```

Le site est alors servi par le serveur Express : **http://localhost:3000**.
La console affiche les adresses IP locales (ex. `http://192.168.x.x:3000`) — les autres appareils du même réseau Wi-Fi peuvent y accéder directement pour suivre le tournoi.

> Sous Windows, si `localhost` ne répond pas, utiliser `http://127.0.0.1:3000`.

## Comptes

Il n'y a pas de comptes utilisateurs. Il existe un seul mot de passe **organisateur** :

| Rôle | Mot de passe |
|---|---|
| Organisateur (admin) | `admin1234` |

Ce mot de passe est défini dans le fichier `.env` (`ADMIN_PASSWORD`). Les spectateurs n'ont besoin d'aucun mot de passe : ils consultent simplement via le lien du tournoi.
## Fonctionnement du site (front)

- **Accueil `/`** — Page de connexion de l'organisateur : saisir le mot de passe admin pour débloquer l'espace organisateur.
- **Créer un tournoi `/create`** — Choisir le format parmi 4 :
  - **League** 🛡️ : championnat, chacun rencontre tous les autres (3 à 32 joueurs) ;
  - **Knockout** 🏆 : élimination directe avec tableau animé, BYE automatiques si nécessaire, option aller-retour (qualification au cumul des buts, TAB en cas d'égalité) ;
  - **League + Knockout** 🛡️🏆 : championnat complet puis éliminations entre les Top N (2/4/8/16 qualifiés, à choisir) ; le tableau des éliminations est **généré automatiquement** dès que le dernier match de championnat est saisi ;
  - **Groupes + Knockout** 🔤🏆 : tirage de groupes équilibrés, round-robin dans chaque groupe, puis éliminations croisées (le 1er du groupe A affronte le 2e du groupe B, etc.) ; nombre de groupes et qualifiés par groupe (1er ou 2 premiers) configurables.

  Pour les formats avec phase de groupes/championnat : option rencontres aller simple / aller-retour sur cette phase ; les éliminations se jouent en aller simple (TAB si égalité).
- **Espace organisateur `/t/:id/admin`** — Saisir et corriger les scores (journées pour la phase championnat/groupes, tours nommés + libellés « Aller »/« Retour » pour les éliminations). En knockout, en cas d'égalité, la saisie des tirs au but est demandée ; le vainqueur est propagé automatiquement. Avant le premier match joué, on peut ajouter/supprimer des joueurs. Le tournoi peut être supprimé depuis la zone de danger.
- **Vue spectateur `/t/:id`** — Lecture seule, temps réel (SSE) :
  - classement animé (+ récompenses : ⚽ buteur de la ligue, 🛡️ min. buts encaissés, 🥅 max. buts encaissés) ;
  - tables par groupe (A, B…) pour les phases de groupes ;
  - arbre des éliminations avec tours nommés (Quarts, Demi-finales, Finale) et cartes aller-retour (agrégat + détail des manches).

Partagez simplement le lien du tournoi (ex. `http://192.168.x.x:3000/t/abc123`) aux autres appareils : chaque changement de score apparaît chez tous instantanément. Pour un accès via Internet, lancez `start-public.ps1` qui crée un lien public trycloudflare.com.
