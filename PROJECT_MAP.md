# PROJECT_MAP.md — eFootball Cup (League & Knockout)

> Mémoire externe du projet. Dernière consolidation : **2026-08-22** (horloge système vérifiée via shell, UTC+1).
> Statut : **implémentation terminée et vérifiée** — M0→M3 validés par exécution (12/12 tests verts, typecheck 0 erreur, build prod OK, smoke test API complet incluant persistance au redémarrage et SSE). UI livrée (M4→M6) ; reste à l'utilisateur : test LAN multi-appareils (M7).

---

## [TECH_STACK]

Versions relevées directement sur `registry.npmjs.org` (endpoint `/latest`) et `endoflife.date/api/nodejs.json` à la date du 22/08/2026. Aucune dépendance marquée `deprecated`.

### Runtime
| Élément | Version retenue | Justification |
|---|---|---|
| Node.js | **24.x LTS (24.19.0)** | Active LTS jusqu'au 2026-10-20 (maintenance jusqu'en 2028). Node 25 déjà EOL (2026-06-01) ; Node 26 passe LTS le 2026-10-28 → migration optionnelle postérieure. |
| Gestion de paquets | npm (workspaces) | Natif, zéro outil supplémentaire. |

### Backend (`server/`)
| Paquet | Version | Rôle |
|---|---|---|
| express | **5.2.1** | API REST + service statique SPA + SSE. Rejets de promesses gérés nativement (v5). |
| zod | **4.4.3** | Validation des entrées API et des variables d'environnement. |
| pino | **10.3.1** | Journalisation asynchrone bufferisée (Protocole n°4). |
| pino-pretty | 13.1.3 | Formatage lisible, dev uniquement. |
| @types/express | 5.0.6 | Typage Express 5. |

### Frontend (`web/`)
| Paquet | Version | Rôle |
|---|---|---|
| vite | **8.2.2** | Bundler/dev server (proxy `/api` vers Express en dev). |
| @vitejs/plugin-react | 6.1.0 | Intégration React. |
| react / react-dom | **19.2.8** | UI. Compiler React natif, pas de configuration supplémentaire. |
| react-router | **8.3.0** | Mode déclaratif uniquement (`<BrowserRouter>`), pas de framework mode/RSC. |
| tailwindcss + @tailwindcss/vite | **4.3.3** | Design system utilitaire (CSS-first config). |
| motion | **13.1.1** | Animations (successeur de framer-motion ; import depuis `motion/react`). |

### Outillage dev/test
| Paquet | Version | Rôle |
|---|---|---|
| typescript | **7.0.2** | Typechecking strict. ⚠ Voir [ORPHANS & PENDING] pour repli 5.x. |
| tsx | 4.23.12 | Exécution TS directe du serveur en dev (esbuild). |
| vitest | **4.1.11** | Tests unitaires du domaine pur (générateurs calendrier/bracket/classement). |
| concurrently | 10.0.5 | Orchestration `npm run dev` (API + Vite en parallèle). |

### Décisions techniques structurantes
1. **Persistance = fichier JSON unique** (`data/db.json`) avec écriture atomique (temp + rename) et file d'écriture sérialisée dans le process. Rejet de better-sqlite3 (13.0.3) : compilation native inutile sous Windows pour un volume < 100 Ko. *Simplicity First.*
2. **Temps réel = SSE** (Server-Sent Events, unidirectionnel serveur→client) : suffisant car les spectateurs sont en lecture seule. Rejet de Socket.IO/WebSocket : duplex superflu.
3. **Auth organisateur = cookie httpOnly signé HMAC** (secret serveur, TTL 12 h), émis après `POST /api/auth/login`. Zéro dépendance JWT ; aucune session stockée.
4. **Un seul process Node** sert l'API et la SPA buildée en production → partage LAN sur une seule origine, pas de CORS.

---

## [SYSTEM_FLOW]

### Flux A — Création d'un tournoi (Organisateur)
```
/ (accueil) → POST mot de passe → session admin
  → page "Créer" : nom, type {league|knockout}, toggle aller-retour (league),
    saisie des pseudos (3–32 joueurs, validation live)
  → POST /api/tournaments
      ├─ league   : génération journées par méthode du cercle (+ miroir si double)
      └─ knockout : bracket puissance de 2 ≥ N, BYE auto, tirage aléatoire animé côté UI
  → redirection /t/:id/admin
```

### Flux B — Saisie d'un résultat (Organisateur)
```
/t/:id/admin → sélection match → saisie score
  → PATCH /api/tournaments/:id/matches/:matchId/result  [cookie admin requis]
      ├─ league   : recalcul classement (Pts 3/1/0 → diff → buts marqués → ordre alpha)
      └─ knockout : si égalité → champs tirs au but obligatoires ;
                    vainqueur propagé automatiquement au tour suivant (nextMatchId)
  → broadcast SSE sur le canal du tournoi
```

### Flux C — Consultation (Spectateurs, lecture seule)
```
Partage du lien http://<ip-lan>:3000/t/:id
  → GET snapshot initial + EventSource /api/events/:id (heartbeat 25 s)
  → à chaque événement "update" : refetch du snapshot complet
      ├─ league   : table classée avec réordonnancement animé (layout animations)
      └─ knockout : arbre avec connecteurs, révélation progressive des vainqueurs
```

### Flux D — Démarrage local & partage LAN
```
npm run build && npm start → Express écoute 0.0.0.0:3000
  → bannière console listant les IPs locales (http://192.168.x.x:3000)
  → un appareil = organisateur (route /admin protégée), les autres = spectateurs
```

### Invariants métier
- Un match de knockout exige **un vainqueur** : score nul ⟹ pens home/away requises (validation zod).
- League : matchs générés une fois à la création ; édition des scores uniquement (pas de régénération).
- Suppression/ajout de joueur possible **tant que 0 match est joué**, puis verrouillé.

---

## [ARCHITECTURE]

Monorepo npm workspaces, organisation **domain-driven**, pas de micro-fichiers (< ~200 lignes par fichier).

```
/
├─ package.json                  # workspaces ["server","web"], scripts racine
├─ .env.example                  # PORT, ADMIN_PASSWORD, SESSION_SECRET, DATA_FILE
├─ data/db.json                  # persistance runtime (gitignoré)
├─ server/src/
│  ├─ index.ts                   # bootstrap Express + arrêt gracieux
│  ├─ core/config.ts             # env validée par zod (fail-fast au boot)
│  ├─ core/logger.ts             # singleton pino (Protocole n°4)
│  ├─ core/db.ts                 # store JSON : lecture mémoire + écriture atomique sérialisée
│  ├─ domain/
│  │  ├─ types.ts                # modèles + schémas zod (source unique de vérité)
│  │  ├─ league.ts               # round-robin « méthode du cercle » + classement
│  │  └─ knockout.ts             # bracket + BYE + propagation vainqueurs
│  └─ http/
│     ├─ auth.ts                 # login, middleware garde cookie HMAC
│     ├─ sse.ts                  # hub broadcast par tournoi + heartbeat
│     ├─ tournaments.routes.ts   # endpoints REST (voir tableau ci-dessous)
│     └─ static.ts               # service web/dist + fallback SPA
└─ web/src/
   ├─ main.tsx / App.tsx         # routes : / · /create · /t/:id · /t/:id/admin
   ├─ shared/api.ts              # client fetch typé (erreurs normalisées)
   ├─ shared/live.ts             # hook useTournamentStream (EventSource + refetch)
   ├─ ui/primitives.tsx          # Button, Card, Field, Badge (petits composants groupés)
   ├─ ui/fx.tsx                  # Confetti, fond pelouse, compteurs animés
   └─ features/
      ├─ create/CreatePage.tsx   # formulaire + animation de tirage
      ├─ admin/AdminPage.tsx     # saisie scores + gestion joueurs pré-démarrage
      └─ view/ViewerPage.tsx     # routeur interne StandingsTable | BracketTree
           ├─ StandingsTable.tsx # classement league animé (réordonnancement FLIP)
           └─ BracketTree.tsx    # arbre knockout (connecteurs SVG, révélations)
```

**Couche shared/core minimale** : `types.ts`, `logger.ts`, `db.ts`, `api.ts` — chaque module n'existe que parce qu'il est utilisé par ≥ 2 consommateurs ou constitue un point de configuration unique. Aucune abstraction spéculative.

### Modèle de données
```ts
type TournamentType = 'league' | 'knockout';

interface Player { id: string; name: string; }        // id: crypto.randomUUID()

interface Match {
  id: string;
  round: number;                                       // journée (league) | profondeur (knockout, 0 = finale)
  homeId: string | null;  awayId: string | null;       // null = slot TBD/BYE (knockout)
  homeScore?: number;     awayScore?: number;
  homePens?: number;      awayPens?: number;           // knockout uniquement, si égalité
  nextMatchId?: string;   nextSlot?: 'home'|'away';    // propagation bracket
}

interface Tournament {
  id: string;                                          // nanoid court (slug URL)
  name: string;
  type: TournamentType;
  doubleRound: boolean;                                // league seulement
  createdAt: string;                                   // ISO 8601
  players: Player[];
  matches: Match[];
}
```

### Contrat API
| Méthode & route | Auth | Effet |
|---|---|---|
| `POST /api/auth/login` | — | body `{password}` → cookie `admin_session` (HMAC, 12 h) |
| `POST /api/auth/logout` | admin | invalide le cookie |
| `POST /api/tournaments` | admin | crée + génère calendrier/bracket → `{id}` |
| `GET /api/tournaments/:id` | public | snapshot complet |
| `PATCH …/matches/:matchId/result` | admin | saisie/correction score (+pens si KO nul) → recompute + broadcast |
| `POST /api/tournaments/:id/players` · `DELETE …/players/:pid` | admin | roster modifiable tant que 0 match joué |
| `GET /api/events/:tournamentId` | public | flux SSE (`event: update`, heartbeat 25 s) |

### Journalisation (Protocole n°4)
- pino, **asynchrone par défaut** (bufferisation sonic-boom, jamais de blocage du thread requêtes).
- Niveaux essentiels uniquement : `error` (échec requête/écriture disque), `warn` (entrée invalide, auth refusée), `info` (boot, création tournoi, IP LAN). `debug` activable via `LOG_LEVEL`.
- Une ligne `info` par requête HTTP (méthode, route, statut, durée) ; **jamais** le mot de passe ni les cookies (champ redact).
- Destination : stdout uniquement. Pas de rotation de fichiers (périmètre local).

---

## MILESTONES (objectifs vérifiables)

| # | Jalon | Livrable | Critère de vérification objectif |
|---|---|---|---|
| M0 | Scaffolding & tooling | Monorepo, configs TS strictes, Tailwind, proxy Vite, scripts racine | `npm run dev` démarre API+front ; `GET /api/health` → 200 ; `npm run typecheck` exit 0 |
| M1 | Domaine pur + tests | `league.ts`, `knockout.ts`, `types.ts` (fonctions pures, zéro I/O) | `npm test` vert : N ∈ {3,4,7,12} → nb matchs exacts (league simple 66 pour N=12 ; double 132 ; knockout N−1) ; cas impair + BYE ; nul+pens détermine le vainqueur |
| M2 | Persistance + API + auth + logs | `db.ts`, routes, garde cookie, pino câblé | Script PowerShell : création → patch score → **redémarrage process → état conservé** ; patch sans cookie → 401 ; logs JSON visibles sans fuite de secret |
| M3 | Canal temps réel | Hub SSE + hook client | Deux onglets : mutation dans l'un → rendu dans l'autre < 500 ms sans reload ; heartbeat observé à 25 s |
| M4 | UI Création + Admin | Formulaire validé, animation tirage, saisie scores | Checklist E2E manuelle : league 12 joueurs créée, scores saisis, table à jour |
| M5 | UI Spectateur league | StandingsTable animée | Réordonnancement fluide au changement de points (layout animation motion) ; mise à jour SSE |
| M6 | UI Spectateur knockout | BracketTree + connecteurs + pens | Victoire propagée visuellement au tour suivant ; égalité → saisie pens imposée |
| M7 | Packaging LAN + polish | Build prod servi par Express, bannière IP, confetti champion, README | Depuis un 2ᵉ appareil du LAN : consultation temps réel fonctionnelle ; `npm run build && npm start` sans erreur |

Dépendances entre jalons : M0 → M1 → M2 → M3 → (M4 ∥ M5 ∥ M6) → M7.

---

## [ORPHANS & PENDING]

Éléments non tranchés, risques suivis et exclusions volontaires :

0. **Résolu pendant l'implémentation (2026-08-22)** :
   - TS 7.0.2 fonctionne (`typecheck` exit 0 sur les 2 workspaces) — pas de repli 5.x nécessaire.
   - Tailwind 4.3.3 + Vite 8 : OK. Piège noté : les classes dynamiques `gap-${n}` ne sont pas générées par le JIT → styles inline.
   - Bug corrigé dans `knockout.ts` : `propagateWinner` écrivait sur les clés `home`/`away` au lieu de `homeId`/`awayId` (esbuild ne typecheck pas → passé inaperçu à l'exécution ; détecté par tests + traçage JSON).
   - Bug corrigé : `resolveByes` doit se limiter au tour 1 (un slot vide des tours suivants = « en attente d'un vainqueur », pas un BYE).
   - Route SSE montée dans `tournaments.routes.ts` (`apiRouter.get('/events/:tournamentId', sseHandler)`) — elle existait mais n'était branchée nulle part.
   - Express 5 : `req.params.*` typé `string | string[]` → coercition `String(...)` aux points d'usage.
   - Windows : `localhost` peut résoudre en IPv6 (`::1`) alors que le serveur écoute en IPv4 → utiliser `127.0.0.1`.
0bis. **Lot fonctionnel (2026-08-23)** — 6 demandes utilisateur livrées et vérifiées (18/18 tests, typecheck 0, build OK, smoke tests API + navigateur) :
   - Suppression de tournoi : `DELETE /api/tournaments/:id` (admin), bouton « Zone de danger » dans `/t/:id/admin`.
   - Knockout aller-retour : `Match.tieKey` + `Match.leg` (1=aller, 2=retour) ; qualification au cumul des buts, TAB exigés sur la saisie qui achève une confrontation à égalité agrégée ; BYE = manche unique autoAdvance ; propagation remplit les 2 manches du tour suivant ; champion calculé via `tieWinner`.
   - Labels de tours professionnels (serveur + web miroir) : Finale / Demi-finales / Quarts / Huitièmes / Seizièmes / Trente-deuxièmes de finale.
   - Logo joueur = maillot SVG coloré (hash pseudo) avec initiale imprimée (`JerseyIcon` + `PlayerAvatar`).
   - Bouton « 🏠 Accueil » dans le header global.
   - Phrase d'accueil remplacée par « Bienvenue sur le site Championnat Rafraf eFootball ».
   - Accès Internet amis : tunnel cloudflared quick (`start-public.ps1` à la racine relance serveur+tunnel et affiche l'URL trycloudflare.com).
0ter. **Lot formats & stats (2026-08-23)** — 2 nouvelles demandes livrées et vérifiées (29/29 tests, typecheck 0, build OK, smoke tests API + navigateur) :
   - 4 formats : `league`, `knockout`, `league-knockout` (championnat → éliminations des Top N), `groups-knockout` (groupes → éliminations croisées). Nouveau champ `Match.phase` ('league'|'group'|'knockout', absent = déduit du type pour les anciens tournois) + `Tournament.qualifiers/groupsCount/qualifiedPerGroup/groups`.
   - Auto-bracket : dès que tous les matchs round-robin sont joués (`maybeGenerateKnockoutPhase` dans `server/src/domain/hybrid.ts`, appelé après chaque saisie), la phase knockout est générée une seule fois (idempotent). Têtes de série croisées pour les groupes : vainqueur du groupe i vs dauphin du groupe miroir (`buildGroupSeeds`) — jamais deux joueurs du même groupe au 1er tour.
   - Refactor `knockout.ts` : `placePlayersInBracket(orderedIds, {doubleRound, phase})` permet de placer un ordre imposé (têtes de série) ; `generateKnockoutBracket` délègue.
   - Éliminations des hybrides : aller simple avec TAB (doubleRound ne s'applique qu'à la phase round-robin).
   - publicView renvoie `standings` (limité à la phase championnat), `groupStandings` par groupe, et `championId` calculé sur les seuls matchs KO (`championOf`).
   - Récompenses league (client, `web/src/features/view/AwardsBar.tsx`) : ⚽ buteur (max BP), 🛡️ min. buts encaissés, 🥅 max. buts encaissés — affichées sous le classement spectateur.
   - Web : CreatePage 4 formats + options conditionnelles (Top N / nb groupes / qualifiés par groupe) ; AdminPage sépare « Journées » et « Éliminations directes » ; ViewerPage affiche classement (+récompenses) et/ou tables de groupes puis l'arbre des éliminations ; helpers partagés dans `web/src/shared/tournament.ts`.
   - Piège corrigé dans les tests : helper de simulation qui donnait 1 but au perdant → classements faussés.
0quater. **Lot visuel (2026-08-23)** — diaporama de fond + logos par format, livré et vérifié (typecheck 0, build OK, tests navigateur : transition 7 s ✓, badges ✓, zone champion ✓, zéro erreur console) :
   - `BackgroundSlideshow` (`web/src/ui/fx.tsx`) : fond plein écran derrière tout le site, 6 visuels (LaLiga, Premier League, Ligue 1 FR, Ligue 1 Pro Tunisie, UCL, Coupe du Monde), 7 s par visuel (`SLIDE_INTERVAL_MS`), fondu enchaîné 1,5 s + zoom Ken Burns + halo flouté du même visuel + légende animée façon broadcast + points de progression. Voile sombre en dégradé pour la lisibilité ; précharge des images. Monté dans `App.tsx` en `fixed -z-10`.
   - Assets dans `web/public/` : `backgrounds/{laliga.png,premierleague.png,ligue1.svg,tunisie.png,ucl.svg}` et `logos/{league.svg,knockout.svg,group.png,worldcup.svg}` — tous transparents. Sources : cdnlogo (SVG knockout/UCL/Ligue1/WorldCup2022), Wikipedia/Wikimedia (PNG LaLiga/PremierLeague/Tunisie), `ilahb.com/logo.png` (groupes). Logo « League » = écusson SVG original dessiné à la main (la source Vecteezy utilisateur n'exposait qu'un JPG avec filigrane).
   - `TypeBadge` affiche désormais les logos du format (hybrides = 2 logos) ; `CreatePage` : cartes de format avec logos au lieu des emojis.
   - `BracketTree` : logo Coupe du Monde flottant à côté du titre « Champion » + grand logo animé (apparition spring + flottement) à côté de la carte du champion couronné.
   - Piège environnement : fonts.gstatic.com inaccessible localement → `page.screenshot` Playwright expire sur « waiting for fonts » (hors périmètre).
0quinquies. **Lot visuel 2 (2026-08-23)** — retours utilisateur sur le knockout et l'accueil, livrés et vérifiés (typecheck 0, build OK, tests navigateur : icône accueil ✓, coupe dorée 160 px ✓, fond ardoise ✓, zéro erreur console) :
   - Grande coupe du vainqueur (`BracketTree`) : `worldcup.svg` → `trophy-gold.svg` (SVG original dessiné : coupe dorée dégradés + étoile + anses), agrandie h-20 → h-32/sm:h-40, animations conservées (apparition spring + flottement). Le petit logo FIFA WC 2022 à côté du titre « Champion » reste inchangé.
   - L'utilisateur a donné 2 liens share.google pour ce même logo (Qatar line-art Vecteezy puis coupe dorée PNGTree) ; consigne la plus précise appliquée (coupe dorée, plus grande). Les deux liens pointaient vers des JPG de banques d'images → fond blanc + filigrane, inutilisables → SVG originaux recréés.
   - Icône « Accueil » du header : emoji 🏠 → `/logos/home-icon.svg` (maison lime dégradée, SVG original).
   - Fond vert sombre (#04160d/#06281a) remplacé par ardoise neutre (#0b0f19/#131c31) dans `index.css`, voile du diaporama allégé (88/62/92 → 80/50/90) dans `fx.tsx`, header `App.tsx` synchronisé. Accents lime conservés.
   - Piège modèle : impossible d'afficher visuellement les images téléchargées (modèle sans entrée image) → se fier au format/headers et recréer des SVG propres plutôt que livrer un asset douteux.
0sexies. **Lot visuel 3 (2026-08-23)** — nouvelle coupe du vainqueur demandée via share.google/b24XiQNYnFVfWTovq (« coupe or ruban rouge réaliste », magnific.com, aperçu JPG → recréé en SVG original `trophy-cup.svg` : coupe or + ruban rouge noué + queues fourchues, SANS étoile). Livré et vérifié (typecheck 0, build OK, navigateur : 2 coupes affichées 80 px + 224 px, zéro erreur console) :
   - `trophy-gold.svg` (coupe à étoile animée) retiré de l'UI à la demande explicite (« le coupe animé qui contient étoile éviter ») ; fichier conservé dans public/ pour rollback éventuel.
   - Grande coupe flottante : h-32/sm:h-40 → h-44/sm:h-56 (224 px rendus), animations spring + flottement conservées.
   - Emoji 🏆 remplacé par `trophy-cup.svg` dans la carte champion (h-20) ET le bouton « Créer un tournoi » de l'accueil (h-7).
0septies. **Lot visuel 4 (2026-08-23)** — 3 nouvelles diapositives + maillots 3D, livré et vérifié (typecheck 0, build OK, navigateur : 9 points de diaporama, diapo encadrée affichée, 6 maillots 3D sans initiale, zéro erreur console) :
   - Diaporama passe à 9 visuels (7 s chacun) : + `wc2026.svg` (emblème officiel WM 2026, Wikimedia), + `laliga-trophy.jpg` et `premierleague-trophy.jpg` (photos réelles des trophées espagnol/anglais, Commons ~1280px). Ordre : trophée juste après le logo de son championnat.
   - Nouveau flag `framed?: boolean` sur BackgroundSlide : les photos rectangulaires s'affichent dans un panneau vitré arrondi (border white/15 + backdrop-blur) au lieu d'à nu.
   - Pièges téléchargement Commons : URL miniatures à obtenir via l'API (`prop=imageinfo&iiurlwidth`) puis télécharger telles quelles — construire l'URL à la main donne HTTP 400 ; rate-limit 429 persistant → espacer les requêtes (~5-25 s) et réessayer.
   - Maillots joueurs (`JerseyIcon`/`PlayerAvatar` dans primitives.tsx) : rendu 3D par superposition de dégradés (reflet radial + ombrage latéral + plis ourlet/col) au-dessus du `currentColor` (couleur par hash du pseudo conservée) ; ids de gradients uniques via `useId` (plusieurs instances dans le DOM) ; **initiale supprimée** (« sans symbole » demandé).
0octies. **Perf diaporama (2026-08-23)** — lags signalés chez les joueurs à l'ouverture des liens ; cause : halo plein écran `blur-3xl saturate-150` sur image géante animée en scale JS (motion) + double chargement des images. Solution pro appliquée :
   - `sharp` (devDep web) + `web/scripts/bg-assets.mjs`, lancé via `npm run bg` : génère dans `public/backgrounds/gen/` un `.webp` principal optimisé ET un `-halo.webp` minuscule (160px, flou+saturation cuits) pour chacun des 9 visuels. Le diaporama ne référence plus que ces fichiers ; les originaux restent pour régénérer.
   - `BackgroundSlideshow` : halo = img étirée SANS aucun filtre CSS ; zoom Ken Burns déplacé de motion (rAF JS) vers animation CSS pure `.kb-zoom` (@keyframes + will-change, thread compositeur) définie dans index.css avec fallback `prefers-reduced-motion` ; interval qui n'avance pas quand `document.hidden`.
   - Piège PowerShell 5.1 : réécrire package.json via `ConvertTo-Json|Set-Content -Encoding UTF8` ajoute un BOM → Vite « Unexpected token '﻿' » au build. Corrigé en strippant le BOM via node. Toujours éditer les package.json avec Edit/write outils, pas PowerShell.
   - Vérifié : typecheck 0, build OK, navigateur 61 fps headless, zéro filtre blur dans le slideshow, 9 diapos + cadrées OK.
1. **TypeScript 7.0.2** : première majeure du compilateur natif (Go). Friction possible avec l'écosystème (types, tsconfig). *Plan de repli documenté* : bascule vers la dernière ligne 5.x stable si `typecheck` échoue à M0 — décision prise et tracée ici.
2. **@tailwindcss/vite 4.3.3** : aligné sur tailwindcss, compatibilité Vite 8 à confirmer au premier `npm run dev` (M0).
3. **Règle de départage league** : critères retenus = Pts → différence de buts → buts marqués → ordre alphabétique (déterministe). La *confrontation directe* est volontairement hors v1 (complexité de calcul, faible valeur locale). Réévaluation possible post-M5.
4. **Tirage au sort knockout** : randomisation à la création (Fisher-Yates via `crypto.getRandomValues`). Pas de re-tirage en cours de tournoi (exclu).
5. **Dossier OneDrive** : le répertoire projet est synchronisé OneDrive — risque théorique de contention sur `data/db.json` pendant l'écriture atomique. Mitigation acceptée : rename atomique ; sinon déplacer `DATA_FILE` hors dossier synchronisé (variable d'env prévue).
6. **HTTPS** : absent (LAN local, HTTP simple). Toute exposition internet sort du périmètre.
7. **Exclusions volontaires (No Feature Creep)** : comptes utilisateurs multiples, rôles fins, chat/commentaires, statistiques avancées (buteurs, cartons), i18n (UI française uniquement), QR code de partage, mode hors-ligne/PWA, historique multi-saisons, déploiement cloud.
8. **Sauvegarde** : copie manuelle de `data/db.json` ; aucun mécanisme de backup automatique (hors besoin).
