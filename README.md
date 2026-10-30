# ESME TENDERA

**L'intelligence des appels d'offres.**

Plateforme métier de veille, d'analyse, de préparation et de pilotage des réponses aux
appels d'offres d'ESME Executive Education, avec ouverture aux expertises du Groupe IONIS.

---

## Sommaire

1. [Ce que fait la plateforme](#ce-que-fait-la-plateforme)
2. [Démarrage rapide](#démarrage-rapide)
3. [Architecture](#architecture)
4. [Identité et charte graphique](#identité-et-charte-graphique)
5. [Référentiel pédagogique](#référentiel-pédagogique)
6. [Moteur de matching](#moteur-de-matching)
7. [Analyse des dossiers de consultation](#analyse-des-dossiers-de-consultation)
8. [Veille](#veille)
9. [Rôles et permissions](#rôles-et-permissions)
10. [Tests](#tests)
11. [Déploiement](#déploiement)
12. [État des fonctionnalités](#état-des-fonctionnalités)

---

## Ce que fait la plateforme

Le cycle complet d'une consultation, de la détection au résultat :

```
veille → identification → DCE → analyse → matching → Go/No Go → préparation
      → contrôle qualité → validation → dépôt → négociation → résultat
```

Chaque étape est un état du pipeline, chaque transition est journalisée, et chaque
information restituée porte sa source.

**Trois principes gouvernent le produit :**

1. **Rien n'est inventé.** Aucune consultation, aucun montant, aucune référence, aucun
   formateur, aucun tarif n'est produit par la plateforme. Là où une donnée manque, elle
   est signalée comme manquante — jamais comblée par une valeur plausible.
2. **Tout est traçable.** Une information extraite d'un dossier porte le nom du fichier et
   la page dont elle vient. Une décision porte son auteur, sa date et sa motivation.
3. **L'humain décide.** Les scores sont des aides à la décision. Le Go/No Go, la validation
   des documents et l'enregistrement d'un dépôt supposent une action humaine explicite.

---

## Démarrage rapide

### Prérequis

- Node.js 20 ou plus
- PostgreSQL 14 ou plus

### Installation

```bash
npm install
cp .env.example .env     # puis renseigner DATABASE_URL et AUTH_SECRET
npm run db:push          # crée le schéma
npm run db:seed          # référentiel, connecteurs, comptes, données de démonstration
npm run dev
```

L'application démarre sur <http://localhost:3000>.

### Comptes de démarrage

Créés par le seed avec le mot de passe `Tendera2026!` (modifiable via
`TENDERA_SEED_PASSWORD`). **À changer dès la première connexion**, depuis
`/admin`.

| Adresse | Rôle |
|---|---|
| `admin@esme.fr` | Administrateur |
| `responsable.ao@esme.fr` | Responsable appels d'offres |
| `redacteur@esme.fr` | Rédacteur |
| `expert@esme.fr` | Expert pédagogique |
| `relecteur@esme.fr` | Relecteur |
| `lecteur@esme.fr` | Lecteur |

### Base vierge, sans données de démonstration

```bash
TENDERA_SEED_DEMO=0 npm run db:seed
```

Les affaires de démonstration portent le drapeau `isDemo` et un badge
« Démonstration » dans toute l'interface : elles ne peuvent pas être confondues avec
des consultations réelles.

### Variables d'environnement

| Variable | Rôle | Obligatoire |
|---|---|---|
| `DATABASE_URL` | Connexion PostgreSQL | oui |
| `AUTH_SECRET` | Signature des sessions (`openssl rand -base64 48`) | oui |
| `TENDERA_STORAGE_DIR` | Dossier de stockage documentaire (défaut `./storage`) | non |
| `TENDERA_CRON_SECRET` | Jeton de la synchronisation quotidienne | pour la veille planifiée |
| `CRON_SECRET` | Même rôle, sous le nom imposé par le cron Vercel | pour la veille planifiée **sur Vercel** |
| `DATABASE_URL_UNPOOLED` | Connexion directe, utilisée pour créer le schéma | non, mais recommandée |
| `BLOB_READ_WRITE_TOKEN` | Stockage objet, si le disque n'est pas persistant | selon l'hébergement |
| `ANTHROPIC_API_KEY` | Moteur IA optionnel | non |
| `TENDERA_AI_MODEL` | Modèle utilisé si une clé est fournie | non |
| `TENDERA_SEED_PASSWORD` | Mot de passe initial des comptes du seed | non |
| `TENDERA_SEED_DEMO` | `0` pour ne pas créer les affaires de démonstration | non |

---

## Architecture

**Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · PostgreSQL · Prisma.**

Ce choix a été retenu plutôt qu'une séparation front/back en deux services : l'application
est un outil interne à faible concurrence, où la quasi-totalité des écrans sont des vues de
base de données. Le rendu serveur évite une couche d'API à maintenir en double, et les
*server actions* gardent les règles métier côté serveur — un rôle qui n'a pas le droit de
déplacer une carte ne le peut pas, même en manipulant le client.

Les responsabilités restent séparées par module, ce qui permet d'extraire n'importe lequel
en service autonome si la charge l'exige :

```
src/
├── app/                      Interface et routes
│   ├── (app)/                Application authentifiée
│   └── api/                  Routes techniques (auth, documents, cron de veille)
├── components/
│   ├── ui/                   Design system (charte ESME)
│   └── app/                  Composants métier (Kanban, éditeur, graphiques)
├── lib/
│   ├── matching/             Moteur de matching — déterministe, sans dépendance externe
│   ├── dce/                  Extraction, classification et analyse documentaire
│   ├── veille/               Connecteurs de sources publiques
│   ├── docs/                 Génération et export des documents de réponse
│   ├── compliance/           Contrôle de complétude, qualité et conformité
│   ├── auth.ts, rbac.ts      Authentification et permissions
│   ├── audit.ts              Journal d'audit
│   └── storage.ts            Stockage documentaire (point de substitution S3/SharePoint)
└── data/                     Référentiels versionnés (catalogue, voisines, IONIS)
```

### Base de données

32 tables. Les entités structurantes :

- `Tender` — l'affaire, avec son étape, sa décision, son résultat ;
- `Lot` — les lots, qui peuvent devenir des affaires distinctes ;
- `Document` / `DocumentChunk` — les pièces et leurs fragments indexés ;
- `TenderAnalysis` / `Requirement` / `Citation` — la synthèse, les exigences, leurs sources ;
- `Training` / `Institution` — le référentiel pédagogique ;
- `MatchResult` / `TrainingMatch` — les scores et leur explication ;
- `ResponseDocument` / `DocumentVersion` / `DocumentComment` — les documents produits ;
- `QualityReview` — les contrôles successifs ;
- `AuditEvent` — le journal.

### Sécurité

- Sessions signées (JWT HS256, cookie `httpOnly`, 12 h), mots de passe en bcrypt (coût 12).
- Permissions vérifiées **côté serveur** dans chaque *server action* et route d'API.
- Les pièces sont stockées hors du dossier public et servies par une route qui vérifie la
  session, le rôle et la confidentialité du document.
- Les chemins de stockage sont dérivés d'une empreinte SHA-256, jamais du nom de fichier
  d'origine, et la résolution refuse toute sortie du dossier autorisé.
- Les appels aux services d'IA se font exclusivement côté serveur.

---

## Identité et charte graphique

Couleurs issues de la mini-charte ESME Executive Education (23 juillet 2026) :

| Rôle | Couleur | Code |
|---|---|---|
| Principale | Bleu ESME | `#174290` — CMJN 100/80/5/0 |
| Accentuation | Framboise | `#EB63A0` — CMJN 0/74/0/0 |
| Secondaires | | `#162259` `#3D276E` `#6A2B62` `#A879B4` `#F4ABBF` `#D1D9E8` `#F4E4D9` `#FBF4EE` |

Typographie **Kumbh Sans**. Les gimmicks de la charte (chevron, cercle, trame de points)
sont repris comme éléments d'interface. Tous les jetons sont définis dans
`src/app/globals.css` ; aucune couleur n'est écrite en dur dans un composant.

Le nom du produit, sa signature et les logos sont modifiables depuis `/admin` sans
toucher au code.

**Une contrainte mérite d'être signalée.** La charte ne contient que des teintes comprises
entre le bleu et le magenta. Testée avec un validateur de palette, toute série catégorielle
de trois couleurs issue de cette gamme échoue à la séparation pour les daltonismes protan
et deutan. Plutôt que d'introduire une couleur étrangère à la charte, les graphiques
n'utilisent qu'une seule teinte et portent l'identité par le texte : barres classées avec
leur valeur, série unique en aire, jauges nommées. Aucune information n'est portée par la
couleur seule.

---

## Référentiel pédagogique

Trois familles, dans l'ordre de priorité du moteur de matching.

### Priorité 1 — catalogue ESME (48 formations)

Extrait du document officiel **`ESME-EE_Catalogue_2027.pdf`** (68 pages). Pour chaque
formation : intitulé, domaine, thème, objectif général, public cible, objectifs
pédagogiques, prérequis, méthodes, durée, volume horaire, modalité, programme détaillé,
rubrique « Les + », et **page du catalogue**.

Quatre domaines, douze thèmes :

| Domaine | Thèmes |
|---|---|
| Énergies & Services | Smart grids et ENR · Réseaux et infrastructures · Efficacité énergétique · Data center |
| Industrie | Fabrication additive |
| Numérique | Intelligence artificielle · Cybersécurité |
| Management de la transformation | Leadership · Intrapreneuriat · Management de projets complexes · Stratégie · Soft skills |

Régénération après une nouvelle édition du catalogue :

```bash
npx tsx scripts/build-catalogue.ts   # data-source/ → src/data/catalogue-esme.json
npm run db:seed
```

### Périmètre d'intervention

ESME Executive Education intervient en **formation continue professionnelle
généraliste, tous secteurs** — un positionnement comparable à celui de Cegos, M2i ou
ORSYS — avec une appétence marquée pour les sujets d'ingénieur.

Le catalogue ne délimite donc pas le périmètre : il mesure l'**affinité**, c'est-à-dire la
part du besoin déjà couverte par une offre existante. Chaque consultation reçoit une
appréciation en clair :

| Appréciation | Ce qu'elle dit |
|---|---|
| **Formation — cœur de catalogue** | des programmes existants répondent au besoin |
| **Formation — proche du catalogue** | une adaptation des programmes existants suffit probablement |
| **Formation — dans le périmètre** | aucun programme ne couvre ce besoin : il est à concevoir, mais c'est bien notre métier |
| **Métier manuel — hors périmètre** | apprentissage d'un métier manuel étranger au champ de l'établissement (esthétique, coiffure, métiers de bouche, métiers du bâtiment) |
| **Ne porte pas sur de la formation** | marché de travaux ou de fournitures, conservé mais signalé |

Un score faible ne vaut jamais rejet : il dit « nous n'avons pas encore de programme sur
étagère », pas « ce n'est pas pour nous ». Les trois premières appréciations sont toutes
dans le périmètre.

### Priorité 2 — formations voisines (10 fiches)

Domaines proches, régulièrement demandés par les acheteurs publics : formation de
formateurs, management opérationnel, bureautique et outils collaboratifs, IA appliquée aux
métiers, gestion de projet, transformation des organisations, communication
professionnelle, RSE, compétences numériques, accompagnement à la transformation des
compétences.

> Une compétence voisine **n'est pas** une capacité de réalisation confirmée. Ces fiches
> servent à ne pas manquer une consultation pertinente. L'interface le rappelle sur chaque
> fiche et dans chaque restitution de matching.

### Priorité 3 — Groupe IONIS (8 établissements, 9 fiches de compétences)

Source : pages publiques de <https://www.ionis-group.com/>. EPITA, IA Institut, ISG, IPSA,
Sup'Biotech, Epitech, ETNA, ISEG.

> **Aucun établissement du groupe ne peut en engager un autre.** Toute réponse mobilisant
> une autre entité suppose un accord formel préalable. L'avertissement est porté par la
> cartographie, par les fiches, et par l'analyse de chaque affaire concernée.

---

## Moteur de matching

Entièrement **déterministe et local** : aucune clé d'API n'est nécessaire, et deux
exécutions sur les mêmes données donnent le même résultat.

### Le problème qu'il résout

Un acheteur public écrit rarement « formation à la cybersécurité ». Il écrit
« accompagnement à la montée en compétences des agents sur la sécurité des systèmes
d'information ». Les deux vocabulaires ne partagent aucun mot.

Le moteur procède en trois temps :

1. **Normalisation lexicale** — accents, mots vides, flexions régulières, bigrammes.
2. **Expansion conceptuelle** — un dictionnaire de 30 concepts métier rattache chaque
   formulation d'acheteur au concept du référentiel. C'est par là que passe l'essentiel
   des correspondances non littérales.
3. **Score par fiche** — similarité cosinus pondérée par l'IDF (50 %), recouvrement
   conceptuel (32 %), couverture des compétences listées (18 %), puis ajustements
   d'exécution (modalité distancielle, intra/inter).

### Les trois scores

| Score | Mesure | Pondération par défaut |
|---|---|---|
| A — Catalogue ESME | adéquation aux formations du catalogue | 60 % |
| B — Formations voisines | capacité d'adaptation et de conception sur mesure | 25 % |
| C — Groupe IONIS | compétences mobilisables dans le groupe | 15 % |

Pondération modifiable depuis `/admin` ; la modification recalcule immédiatement les
affaires actives. Les trois scores par famille ne dépendent **pas** de la pondération —
seule leur combinaison en score global en dépend.

> Ces scores mesurent l'adéquation **pédagogique et opérationnelle**. Ils ne prédisent pas
> la probabilité de remporter le marché, qui dépend du prix, de la concurrence et des
> références. L'interface le rappelle à chaque restitution.

Chaque score est explicable (formations correspondantes, compétences couvertes et
manquantes, thèmes communs, contraintes) et corrigeable à la main — l'ajustement et sa
justification sont conservés au journal d'audit.

### Comportement observé sur données réelles

Sur 115 avis du BOAMP importés : les marchés de travaux et de fournitures tombent entre
0 et 14/100, les marchés de formation entre 46 et 61/100.

---

## Analyse des dossiers de consultation

### Import

PDF, DOCX, XLSX/XLS/CSV, TXT et **ZIP** (déplié pièce par pièce). Déduplication par
empreinte SHA-256. Le texte est extrait **page par page**, ce qui permet de citer la source
d'une information avec son numéro de page.

Un PDF scanné sans couche texte est stocké et signalé comme non analysable : la
reconnaissance optique n'est pas installée.

### Classification

Détection automatique du type de pièce — RC, CCTP, CCAP, AE, BPU, DPGF, DQE, cadre de
mémoire, DC1, DC2, DC4, annexes, attestations — à partir du nom du fichier et du contenu.
Le score de confiance est affiché ; en dessous de 50 %, le type est présenté comme « à
confirmer » et reste modifiable.

### Synthèse

Objet, besoin, publics, nombre de stagiaires, sessions, volume horaire, modalités, lieux,
moyens humains, certifications exigées, exigences administratives, critères d'attribution
avec leur pondération, contraintes financières, délais, risques, pénalités, obligations.

Chaque information est rattachée à la pièce et à la page dont elle vient. Une information
non trouvée reste vide, et l'écran l'affiche comme telle.

### Exigences

Trois catégories :

- **obligatoires** — non-respect potentiellement éliminatoire (« à peine d'irrégularité »,
  « sous peine de rejet », « le candidat doit ») ;
- **évaluées** — les critères d'attribution et leur pondération ;
- **recommandations** — « il est souhaitable », « le candidat pourra ».

Chaque exigence porte sa citation, sa pièce et sa page, et un statut arbitrable par un
relecteur.

### Contradictions entre pièces

Comparaison des valeurs structurantes (durée du marché, validité des offres, nombre de
reconductions) quand elles apparaissent dans plusieurs pièces. Une divergence entre le RC
et le CCAP est signalée comme point à faire préciser avant de répondre.

---

## Veille

### État des connecteurs

| Source | État | Ce qu'il faut pour l'activer |
|---|---|---|
| **BOAMP** | **opérationnel** | rien — API publique, sans authentification |
| Import manuel | **opérationnel** | rien |
| TED (Union européenne) | à implémenter | clé d'API nominative (portail des développeurs de l'Office des publications) |
| DECP (données essentielles) | à implémenter | jeu ouvert, sans authentification ; prévoir téléchargement et indexation (plusieurs centaines de Mo) |
| PLACE | à implémenter | pas d'API publique de recherche ; via les DECP, ou compte opérateur économique |
| Maximilien | à implémenter | compte opérateur économique ; cadrage éditeur nécessaire |
| AWS-Achat | à implémenter | compte opérateur économique ; vérifier l'existence d'une API partenaire |
| Marchés Sécurisés | à implémenter | compte opérateur économique ; contact éditeur |
| Achatpublic.com | à implémenter | compte opérateur économique ; vérifier l'offre d'API partenaire |

L'état affiché dans l'interface est l'état **réel** du code, pas une intention.

### Connecteur BOAMP

Jeu de données ouvert exposé par l'API Explore v2.1 d'Opendatasoft. Aucune protection
n'est contournée.

Points appris du jeu de données réel, qui conditionnent le bon fonctionnement :

- **il n'existe pas de colonne `code_cpv`** — filtrer dessus fait échouer toute la requête
  (`ODSQLError: Unknown field`). Les CPV ne sont lisibles qu'une fois l'avis récupéré, dans
  la colonne `donnees` ;
- `donnees` contient l'avis complet dans **deux formats incompatibles** : eForms/UBL pour
  les avis européens, structure historique pour les avis nationaux. L'extraction se fait
  par parcours générique ciblé (CPV, lots, date limite, montant) ;
- un avis eForms contient **plusieurs dates de fin** qui ne veulent pas dire la même chose.
  La date limite est celle du conteneur `TenderSubmissionDeadlinePeriod` — ou, en procédure
  restreinte, `ParticipationRequestReceptionPeriod`. Prendre la plus tardive donnerait la
  fin d'exécution du marché, parfois deux ans plus tard ;
- les dates eForms s'écrivent `2026-11-18+01:00`, forme que `new Date()` ne sait pas lire ;
- les **avis d'attribution** sont écartés : ils annoncent un marché déjà attribué.

### Recherche

Un seul terme : **« formation »**, cherché dans l'objet des avis et dans les descripteurs
thématiques du BOAMP. Une liste de mots-clés par domaine faisait deux dégâts — elle ratait
les marchés de formation dont l'intitulé n'emploie aucun de ces mots, et elle ramenait des
marchés de travaux contenant « innovation » ou « données ».

La fenêtre par défaut est de **30 jours** : un avis publié il y a trois semaines dont la
date limite tombe dans deux mois est encore à traiter. La déduplication fait que revoir un
avis ne coûte rien.

Tous les avis récupérés sont visibles sur `/veille`, avec leur appréciation et leur score,
et filtrables par appréciation. **Rien n'est écarté en silence** : seuls les avis
d'attribution (marchés déjà attribués) et les enregistrements sans objet ni identifiant
sont ignorés, et le journal les compte séparément.

Mesure sur 30 jours de BOAMP : 211 avis retenus, 204 affaires créées, dont 168 marchés de
formation exploitables.

### Synchronisation

Bouton **« Lancer la veille maintenant »** sur `/veille` : exécute réellement la
synchronisation et affiche son résultat. Un connecteur injoignable produit un échec motivé,
jamais une affaire fictive.

**Chaque matin**, la route de synchronisation récupère les avis publiés depuis la dernière
exécution — ceux de la veille compris — et crée les affaires correspondantes. Deux
déclencheurs sont fournis dans le dépôt :

- `vercel.json` — cron de l'hébergeur, actif dès le déploiement sur Vercel ;
- `.github/workflows/veille-quotidienne.yml` — GitHub Actions, pour tout autre hébergeur ;
  il attend les secrets `TENDERA_URL` et `TENDERA_CRON_SECRET`.

Les deux sont réglés à 06:00 UTC, soit 7 h à Paris en heure d'hiver et 8 h en heure d'été :
ni Vercel ni GitHub Actions ne gèrent les fuseaux. Pour une heure fixe à Paris, utilisez un
`cron` système avec `CRON_TZ=Europe/Paris 0 7 * * *`.

Appel direct :

```bash
curl -X POST -H "Authorization: Bearer $TENDERA_CRON_SECRET" \
  https://tendera.example.fr/api/veille/quotidienne
```

Exemple de déclencheur (`vercel.json`) :

```json
{ "crons": [{ "path": "/api/veille/quotidienne", "schedule": "0 6 * * *" }] }
```

> **Derrière un proxy sortant**, démarrer le serveur avec `NODE_USE_ENV_PROXY=1` : le
> `fetch` natif de Node ignore `HTTPS_PROXY` et les appels partiraient en direct.

La synchronisation récupère les avis, écarte les doublons (par source et par recoupement
acheteur + intitulé + date limite), rattache les avis rectificatifs à l'affaire initiale,
actualise les dates limites, crée les affaires, lance le matching et produit les alertes.

---

## Rôles et permissions

| Rôle | Portée |
|---|---|
| **Administrateur** | tous les droits, y compris comptes, paramètres et référentiel |
| **Responsable appels d'offres** | pilote le portefeuille : affaires, Go/No Go, validation, dépôts, résultats, configuration de la veille |
| **Rédacteur** | import et analyse des DCE, rédaction, contrôle qualité. Ne décide pas du Go/No Go, n'enregistre pas de dépôt |
| **Expert pédagogique** | matching, référentiel, documents de réponse |
| **Relecteur** | lecture, commentaires, contrôle qualité |
| **Lecteur** | consultation seule |

Les permissions sont vérifiées côté serveur. Les documents confidentiels de la base de
connaissances exigent une permission dédiée.

---

## Tests

```bash
npm test          # 60 tests unitaires — moteur de matching, analyse de DCE, connecteur BOAMP
```

Les tests unitaires s'exécutent **sans base de données** : le référentiel est chargé depuis
les mêmes fichiers que le seed.

Parcours de bout en bout, dans un vrai navigateur (59 vérifications) :

```bash
npm run build && npm run start      # dans un terminal
node tests/e2e.mjs                  # dans un autre
```

Il couvre : connexion, pipeline, les dix onglets d'une fiche, import de DCE, analyse,
extraction des critères et de leur pondération, matching, décision GO, génération de
l'espace de réponse, éditeur, exports Word et Markdown, contrôle qualité, refus du dépôt
sans confirmation, veille, référentiel et journal d'audit.

Playwright est attendu dans l'environnement ; `TENDERA_PLAYWRIGHT` permet d'indiquer son
chemin.

---

## Déploiement

Le build prépare la base lui-même, via `scripts/provision.mjs` : `prisma db push`
puis le seed, avec les affaires de démonstration désactivées. Les deux opérations
sont rejouables sans effet de bord, et sont donc relancées à chaque déploiement
sans rien dupliquer ni réécrire un mot de passe modifié depuis l'initialisation.

Sur un hébergement sans accès terminal, il suffit donc de renseigner les
variables et de déclencher un déploiement :

1. PostgreSQL 14+ provisionné, `DATABASE_URL` renseignée. Lorsque l'hébergeur
   expose aussi une connexion directe (`DATABASE_URL_UNPOOLED` ou
   `POSTGRES_URL_NON_POOLING`), elle est utilisée pour la création du schéma :
   un pooler en mode transaction ne convient pas aux migrations.
2. `AUTH_SECRET` généré (`openssl rand -base64 48`).
3. Jeton de synchronisation défini et déclencheur quotidien configuré. Sur
   Vercel, la variable doit s'appeler `CRON_SECRET` : le cron de la plateforme
   ne joint un en-tête d'autorisation que sous ce nom précis, et une veille
   authentifiée autrement se ferait refuser en 401 sans que rien ne le signale.
   Ailleurs, `TENDERA_CRON_SECRET` suffit — la route accepte les deux.
4. `TENDERA_STORAGE_DIR` sur un volume persistant et sauvegardé, ou
   `BLOB_READ_WRITE_TOKEN` si le système de fichiers n'est pas persistant.
5. Déployer. Sans `DATABASE_URL`, le build réussit quand même et l'application
   affiche son écran de configuration au lieu de planter.
6. Changer les mots de passe des comptes de démarrage.

`db push` est lancé **sans** `--accept-data-loss` : une évolution du schéma qui
supprimerait une colonne fait échouer le build au lieu de détruire des données.
Ce cas demande une intervention humaine délibérée.

Sur un serveur dédié, les mêmes étapes restent disponibles à la main :

```bash
npm run db:push
TENDERA_SEED_DEMO=0 npm run db:seed
npm run build && npm run start
```

### Sauvegardes

Deux éléments à sauvegarder : la base PostgreSQL et le dossier de stockage documentaire.
Les pièces des DCE ne sont pas re-téléchargeables : leur retrait est souvent nominatif.

---

## État des fonctionnalités

Voir **[STATUS.md](./STATUS.md)** pour la liste détaillée de ce qui est opérationnel, de ce
qui est partiel et de ce qui reste à intégrer, avec les accès à fournir dans chaque cas.

---

## Références fonctionnelles

Les principes ergonomiques s'inspirent des plateformes du marché — Tenderbolt et Explain —
sans reprise de leur code, de leurs visuels ni de leur identité. L'univers graphique est
celui de l'ESME.

Sources institutionnelles : <https://www.esme.fr/> · <https://www.ionis-group.com/>
