# État des fonctionnalités

Ce document dit ce qui fonctionne, ce qui fonctionne partiellement, et ce qui n'est pas
fait — avec, dans ce dernier cas, ce qu'il faut fournir pour l'activer.

Il est tenu à jour avec le code. Une fonctionnalité listée comme opérationnelle a été
vérifiée sur l'application en fonctionnement, pas seulement écrite.

Dernière vérification : build complet, 60 tests unitaires, 59 vérifications de bout en bout
dans un navigateur, et une synchronisation BOAMP réelle ayant créé 115 affaires à partir
d'avis publiés.

---

## ✅ Opérationnel

### Socle

| Fonction | Détail |
|---|---|
| Base de données persistante | PostgreSQL, 32 tables, schéma Prisma |
| Authentification | sessions signées, bcrypt, 6 rôles, permissions vérifiées côté serveur |
| Journal d'audit | toute action tracée (acteur, entité, résumé, détail), consultable et filtrable, non modifiable |
| Design system | charte ESME appliquée (couleurs, Kumbh Sans, gimmicks, trame), jetons centralisés |
| Marque modifiable | nom, signature, établissement, groupe et logos éditables depuis `/admin` |

### Référentiel pédagogique

| Fonction | Détail |
|---|---|
| Catalogue ESME | 48 formations extraites du catalogue officiel 2027, avec page source |
| Formations voisines | 10 fiches, signalées comme non confirmées |
| Cartographie IONIS | 8 établissements, 9 fiches de compétences, avec rappel de la règle d'engagement |
| Fiche détaillée | objectifs, prérequis, méthodes, programme détaillé, mots-clés, source |
| Administration | modification, archivage, versionnage ; recalcul automatique des affaires actives |

### Veille

| Fonction | Détail |
|---|---|
| Connecteur BOAMP | API publique Opendatasoft ; extraction des CPV, lots, dates limites et montants depuis l'avis complet |
| Lancement manuel | exécution réelle, résultat affiché, échec motivé |
| Synchronisation quotidienne | route protégée par jeton, à brancher sur un ordonnanceur |
| Déduplication | par identifiant de source, et par recoupement acheteur + intitulé + date limite |
| Avis rectificatifs | rattachés à l'affaire initiale, date limite actualisée, alerte produite |
| Avis d'attribution | écartés : ils n'ouvrent aucune consultation |
| Registre des sources | 9 sources déclarées avec leur état réel et les accès à fournir |

### Affaires et pipeline

| Fonction | Détail |
|---|---|
| Kanban 11 colonnes | glisser-déposer, défilement horizontal, règles de transition appliquées côté serveur |
| Carte | intitulé, acheteur, consultation, lot, montant, dates, jours restants, score, domaine, responsable, statut du DCE |
| Fiche à 10 onglets | informations, lots, DCE, analyse, matching, Go/No Go, documents, contrôle, dépôt/résultat, historique |
| Édition | tous les champs modifiables, modifications journalisées |
| Lots | listés, créables, et transformables en affaires distinctes |
| Vue tableau | recherche globale, filtres, tri, archives |
| Calendrier | dates limites, jalons de préparation, échéances de négociation |
| Création manuelle | toujours disponible, y compris sans connecteur joignable |

### Dossiers de consultation

| Fonction | Détail |
|---|---|
| Import | PDF, DOCX, XLSX, CSV, TXT, ZIP déplié ; déduplication par empreinte |
| Extraction | texte page par page (PDF), par feuille (classeurs) |
| Classification | 16 types de pièces, score de confiance affiché, correction manuelle |
| Synthèse | 18 rubriques, chacune rattachée à sa pièce et à sa page |
| Critères d'attribution | intitulé et pondération extraits, avec leur source |
| Exigences | obligatoires / évaluées / recommandations, avec citation et statut arbitrable |
| Contradictions | divergences entre pièces détectées et remontées comme points à clarifier |
| Téléchargement | route protégée, hors dossier public |

### Matching

| Fonction | Détail |
|---|---|
| Trois scores | catalogue ESME, formations voisines, Groupe IONIS |
| Score global | pondération configurable, recalcul immédiat des affaires actives |
| Explication | formations correspondantes, thèmes communs, compétences couvertes et manquantes, contraintes |
| Ajustement manuel | possible, justification obligatoire, conservée au journal |
| Avertissements | portée des scores et limites rappelées à chaque restitution |

### Décision et préparation

| Fonction | Détail |
|---|---|
| Go / No Go | éléments d'arbitrage factuels, recommandation argumentée, décision humaine, motif obligatoire pour un NO GO, réouverture possible |
| Espace de réponse | créé au GO : checklist, planning à rebours de la date limite, tâches affectables |
| Mémoire technique | plan issu du cadre imposé s'il existe, sinon des critères d'attribution ; premier jet rédigé |
| Documents administratifs | DC1, DC2, acte d'engagement, DC4 si nécessaire, préremplis de l'identification |
| Offre financière | structure reprise du BPU/DQE/DPGF de l'acheteur, prix laissés vides |
| Informations manquantes | listées explicitement, jamais comblées automatiquement |

### Documents et collaboration

| Fonction | Détail |
|---|---|
| Éditeur | sections éditables, ajout, suppression, réordonnancement par glisser-déposer |
| Versions | chaque enregistrement crée une version ; restauration possible |
| Commentaires | par section, avec proposition de réécriture et résolution |
| Statuts | brouillon, en rédaction, en relecture, validé — la validation exige l'absence de lacune |
| Exports | Word (charte ESME appliquée), Markdown, Excel pour l'offre financière |

### Contrôle

| Fonction | Détail |
|---|---|
| Complétude | note sur 100, pièces obligatoires pesant 80 % |
| Qualité | avancement de la rédaction, couverture pondérée des critères, personnalisation, lacunes |
| Conformité | note distincte, plafonnée dès la première non-conformité |
| Alertes bloquantes | affichées avant tout le reste, indépendamment du niveau des scores |
| Corrections proposées | problème, risque encouru, correction attendue, document visé |
| Vue transverse | `/contrôle` : état de tous les dossiers en préparation |

### Dépôt, négociation, résultats

| Fonction | Détail |
|---|---|
| Dépôt | enregistré uniquement sur attestation explicite ; plateforme, date, responsable, accusé de réception, liste des documents |
| Négociation | demandes de précisions, réunions, offres révisées, versions, échéances, affectations |
| Résultats | attribution ou rejet, classement, notes, attributaire, analyse des écarts, enseignements |

### Pilotage

| Fonction | Détail |
|---|---|
| Tableau de bord | 19 indicateurs, trois natures de montant tenues séparées |
| Graphiques | entonnoir, détections hebdomadaires, répartitions par domaine, acheteur, établissement |
| Alertes | 11 types, rappels J-15 à J-0 configurables |
| Base de connaissances | 14 catégories, indexation en fragments, recherche lexicale sur le contenu, validité, obsolescence, confidentialité |

---

## ⚠️ Partiel

| Fonction | Ce qui marche | Ce qui manque |
|---|---|---|
| **Recherche sémantique (RAG)** | indexation en fragments avec leur page, recherche lexicale sur le contenu | la recherche vectorielle : il faut un fournisseur d'embeddings et l'extension `pgvector`. Le champ `DocumentChunk.embedding` est prévu et vide |
| **Moteur IA** | le moteur déterministe produit analyse, matching, mémoire et contrôles sans aucune clé | l'enrichissement par modèle de langage n'est pas branché. Fournir `ANTHROPIC_API_KEY` ; l'abstraction serveur est en place, les prompts restent à écrire |
| **Récupération automatique des DCE** | import manuel complet, déduplication, lien vers la consultation conservé | le retrait automatique : sur la plupart des profils d'acheteur il est nominatif et suppose un compte opérateur économique. Non contourné délibérément |
| **Notifications externes** | alertes en base et dans l'interface | courriel et Microsoft Teams. Fournir un relais SMTP et une application Microsoft Graph |
| **Import de catalogue depuis l'interface** | script de génération reproductible, administration des fiches en ligne | le dépôt direct d'un PDF/Word/Excel de catalogue avec extraction automatique |
| **PDF scannés** | détectés et signalés comme non analysables | la reconnaissance optique (OCR), non installée |
| **Export PDF des documents** | Word, Markdown et Excel | le PDF : prévoir un moteur de rendu (LibreOffice headless ou équivalent) |

---

## ❌ Non implémenté

| Fonction | Ce qu'il faut fournir |
|---|---|
| **Connecteur TED** | clé d'API nominative (portail des développeurs de l'Office des publications de l'UE) |
| **Connecteur DECP** | rien côté accès ; prévoir le téléchargement périodique et l'indexation locale (plusieurs centaines de Mo) |
| **Connecteurs PLACE, Maximilien, AWS-Achat, Marchés Sécurisés, Achatpublic** | compte opérateur économique, et cadrage avec chaque éditeur sur l'existence d'une API partenaire. Aucune de ces plateformes n'expose d'API publique de recherche |
| **SharePoint / OneDrive** | application Microsoft Graph autorisée (`Sites.Read.All`, `Files.ReadWrite`), et consentement administrateur. Le module `storage.ts` est le point de substitution |
| **Connexion ERP** | spécification de l'ERP cible et de son API |
| **Dépôt automatique sur les plateformes** | hors périmètre : le dépôt engage juridiquement et reste manuel. La plateforme ne le simule pas |
| **Édition collaborative en temps réel** | les documents sont versionnés et commentables, mais pas édités simultanément. Suppose une couche de synchronisation (CRDT ou OT) |
| **Signature électronique** | hors périmètre. Aucune signature n'est jamais apposée automatiquement |

---

## Garde-fous vérifiés

Les règles de fiabilité du cahier des charges, et comment elles sont tenues :

| Règle | Mise en œuvre |
|---|---|
| Ne jamais inventer une consultation | les affaires viennent d'un connecteur ou d'une saisie ; un connecteur en échec n'en crée aucune |
| Ne jamais afficher un montant fictif | un montant absent s'affiche « Non communiqué », jamais 0 € ; la nature du montant est toujours portée |
| Ne jamais inventer de références institutionnelles | le générateur de mémoire laisse `[À COMPLÉTER]` partout où une référence, un CV ou un chiffre est nécessaire |
| Ne jamais prétendre avoir analysé un DCE non récupéré | `basedOnDocuments` conditionne la synthèse ; sans pièce lisible, l'écran le dit |
| Ne jamais indiquer un dépôt effectué sans preuve | le dépôt exige une attestation cochée ; la transition Kanban vers « Dépôt effectué » est refusée sans elle |
| Ne jamais considérer une pièce manquante comme conforme | une pièce obligatoire manquante produit une alerte bloquante et plafonne la conformité |
| Ne jamais générer de signature fictive | les documents administratifs portent « signature non apposée » |
| Ne jamais masquer les incertitudes | chaque analyse liste ses limites ; chaque matching liste ses réserves |
| Conserver les sources | pièce et page sur chaque information extraite |
| Permettre la correction humaine | types de pièces, exigences, scores, contenus, statuts : tous corrigeables |
| Conserver les historiques | journal d'audit, versions de documents, historique des décisions |
| Identifier les données de démonstration | drapeau `isDemo`, badge dans l'interface, bandeau sur la fiche et le tableau de bord |
| Afficher les connecteurs réellement opérationnels | l'état affiché est celui du code |
| Signaler les fonctions à intégrer | ce document, et les avertissements dans les écrans concernés |
| Ne pas présenter les scores comme des garanties | rappelé sur le matching et sur chaque contrôle |

---

## Points d'attention pour la mise en service

1. **Changer les mots de passe** des comptes créés par le seed.
2. **Supprimer les affaires de démonstration**, ou réinitialiser avec `TENDERA_SEED_DEMO=0`.
3. **Générer un `AUTH_SECRET`** propre à l'environnement.
4. **Sauvegarder le dossier de stockage** autant que la base : les pièces des DCE ne sont
   pas re-téléchargeables.
5. **Vérifier la sortie réseau** vers `boamp-datadila.opendatasoft.com`, et démarrer avec
   `NODE_USE_ENV_PROXY=1` derrière un proxy.
6. **Renseigner le référentiel de tarifs** (`/admin`), créé vide : le catalogue ESME ne
   publie pas de prix et la plateforme n'en invente aucun.
7. **Alimenter la base de connaissances** avec les mémoires précédents, les références, les
   CV formateurs et les documents qualité : c'est elle qui permet au générateur de produire
   autre chose que des marqueurs à compléter.
