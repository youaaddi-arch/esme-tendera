# Basculer ESME TENDERA sur d'autres comptes GitHub et Vercel

Marche à suivre dans l'ordre. L'opération n'est pas difficile, mais elle a
**un point irréversible** : la base de données. Tout le reste se refait.

> **Règle unique à ne pas enfreindre : déconnecter n'est pas supprimer.**
> On ne supprime rien de l'ancien avant que le nouveau réponde.

---

## Étape 0 — Savoir où vit la base, avant tout le reste

La configuration porte `DATABASE_URL_UNPOOLED`, qui est la signature de **Neon**.
Reste à savoir *par quel chemin* ce Neon existe, et c'est toute la différence :

| Chemin | Comment le reconnaître | Conséquence |
|---|---|---|
| **Neon via le Marketplace Vercel** | Dans Vercel → projet `esme-tendera` → onglet **Storage**, Neon apparaît comme ressource du projet, facturée par Vercel | La base appartient à l'équipe Vercel. **Supprimer le projet Vercel détruit les données.** Elle doit suivre le transfert, ou être migrée |
| **Compte Neon indépendant** | L'onglet Storage ne montre rien, et `DATABASE_URL` est une variable saisie à la main | Aucun risque. La base ne bouge pas ; on recopie la chaîne de connexion dans le nouveau projet |

**À faire** : ouvrir cet onglet et regarder. Deux clics, et ils décident de la suite.

## Étape 1 — Sauvegarder la base

Avant de toucher à quoi que ce soit, et quel que soit le résultat de l'étape 0 :

```bash
pg_dump "$DATABASE_URL_UNPOOLED" --no-owner --no-privileges -Fc -f tendera-$(date +%F).dump
```

La chaîne de connexion **ne doit pas passer par la conversation avec Claude**.
Deux façons propres :

- depuis la console Neon, qui propose ses propres sauvegardes et branches ;
- en local, la chaîne restant dans un `.env` sur votre poste.

Vérifier que le fichier n'est pas vide (`ls -lh`), et le garder ailleurs que sur
le poste qui sert à la bascule.

## Étape 2 — GitHub

**Transfert du dépôt** (recommandé) : `github.com/youaaddi-arch/esme-tendera`
→ Settings → tout en bas → *Transfer ownership*.

Ce qui suit le dépôt, d'après la documentation GitHub : les 51 commits et leur
historique, les issues, **les pull requests #7 à #10 avec leurs descriptions**,
le wiki, les étoiles. Les anciennes adresses redirigent automatiquement,
y compris pour `git clone`, `git fetch` et `git push`.

Conditions et pièges :

- être **administrateur** du dépôt ;
- si la cible est un **compte personnel**, son propriétaire doit accepter
  **dans les 24 heures**, sinon l'invitation expire ;
- si c'est une **organisation**, il faut y avoir le droit de créer un dépôt ;
- le compte cible ne doit pas déjà avoir de dépôt nommé `esme-tendera` ;
- **ne jamais recréer** plus tard un dépôt `esme-tendera` sur l'ancien compte :
  cela supprime définitivement les redirections.

Après le transfert, sur chaque poste qui a un clone :

```bash
git remote set-url origin https://github.com/NOUVEAU-PROPRIETAIRE/esme-tendera.git
```

*Variante sans transfert* : créer un dépôt vide sous le nouveau compte ; Claude y
pousse tout l'historique. Le code et les commits sont préservés, **les pull
requests et leurs discussions sont perdues** — elles vivent chez GitHub, pas
dans Git.

## Étape 3 — Claude

1. Reconnecter le compte GitHub sur **https://claude.ai/connect-github**
2. Depuis cette même page, installer l'**application Claude** sur le nouveau
   propriétaire, et lui donner accès au dépôt.
3. Le périmètre des dépôts d'une session est figé à son démarrage : ouvrir une
   **nouvelle session** avec le nouveau dépôt sélectionné.

## Étape 4 — Vercel

Deux chemins. Le premier est de loin le plus sûr.

### a. Transférer le projet existant

Le projet garde ses variables d'environnement, son domaine, et le transfert
tente de déplacer les ressources de stockage attachées — la réponse de l'API
liste les *stores* déplacés (`transferredStoreIds`) et les échecs
(`resourceTransferErrors`), **à lire attentivement** si le Neon vient du
Marketplace.

Depuis l'interface : projet → Settings → *Transfer project*. Le code de
transfert est valable 24 h. Ensuite, repointer la source Git :

```bash
vercel git disconnect --project esme-tendera
vercel git connect https://github.com/NOUVEAU-PROPRIETAIRE/esme-tendera.git
```

### b. Créer un projet neuf

Importer le nouveau dépôt, puis ressaisir les variables :

| Variable | Remarque |
|---|---|
| `DATABASE_URL` | obligatoire |
| `DATABASE_URL_UNPOOLED` | sert à créer le schéma au build — fortement recommandée |
| `AUTH_SECRET` | obligatoire. `openssl rand -base64 48`. **Une nouvelle valeur déconnecte tout le monde une fois** : sans gravité, il suffit de se reconnecter. À définir pour **Production *et* Preview**, sinon les prévisualisations ne permettent pas de se connecter |
| `TENDERA_CRON_SECRET` | pour la veille planifiée |
| `BLOB_READ_WRITE_TOKEN` | pour les DCE de plus de 4 Mo |
| `ANTHROPIC_API_KEY` | optionnelle, pour le futur agent DCE |

Le domaine `esme-tendera.vercel.app` reste **pris par l'ancien projet** jusqu'à
sa libération : le nouveau projet aura une autre adresse tant que l'ancien vit.

Le build applique le schéma tout seul (`prisma db push` dans `npm run build`),
sans `--accept-data-loss` : si une colonne devait disparaître, le build échoue
bruyamment au lieu de détruire des données.

## Étape 5 — Vérifier, puis seulement après, supprimer

Sonde sans authentification, qui distingue l'ancien code du nouveau :

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://NOUVELLE-ADRESSE/api/veille/export
# 401 = la route existe et demande une session : le nouveau code est en ligne
# 404 = l'ancien code est encore servi
```

Puis, connecté : le pipeline affiche ses colonnes, la page Veille porte ses deux
boutons d'import et d'export, `/admin/comptes` répond, et une affaire au hasard
montre bien son montant et son acheteur.

**Alors seulement** supprimer l'ancien projet Vercel et, le cas échéant,
l'ancien dépôt.

---

## Ce qui ne se transfère pas, ou dont il faut se méfier

- **Les secrets GitHub Actions.** La documentation GitHub ne dit pas clairement
  s'ils survivent à un transfert. Dans ce projet c'est sans conséquence :
  `TENDERA_URL` et `TENDERA_JETON` n'ont jamais été renseignés, ce qui est
  précisément la raison pour laquelle le workflow « Ouvrier retrait DCE »
  échoue en boucle depuis des jours. Il n'y a rien à perdre, et c'est
  l'occasion de les renseigner — ou de désactiver sa planification.
- **Les applications GitHub installées.** La documentation ne le précise pas :
  considérer qu'il faut réinstaller l'application Claude côté nouveau
  propriétaire (étape 3).
- **Le domaine Vercel**, comme dit plus haut.
- **Les sessions ouvertes** des utilisateurs, si `AUTH_SECRET` change.

## Ce qui ne bouge pas

- Les **données** : affaires, décisions, documents, référentiel de formations —
  tant que la base n'est pas détruite, rien n'y touche. Le code ne contient
  aucune donnée.
- Les **comptes utilisateurs** et leurs mots de passe : ils sont dans la base.

## Rappels de sécurité toujours en vigueur

- Le mot de passe AW Solutions passé en conversation est **compromis** et doit
  être changé.
- Le compte `admin@esme.fr` est encore sur son mot de passe d'initialisation.
  La page `/admin/comptes` sert exactement à cela.
- Aucun identifiant ne doit transiter par la conversation : ni chaîne de
  connexion, ni jeton, ni mot de passe. Ils se déposent dans les variables
  d'environnement Vercel ou les secrets GitHub.
