/**
 * Préparation de la base au moment du build.
 *
 * L'application est déployée sur un hébergement où personne n'ouvre de
 * terminal : il n'y a pas de poste depuis lequel lancer « npm run db:push »
 * puis « npm run db:seed » contre la base de production. Les chaînes de
 * connexion y sont d'ailleurs stockées comme secrets non relisibles, donc
 * même l'exploitant ne peut pas les récupérer pour le faire à la main.
 *
 * Ce script comble ce vide : il crée le schéma et charge le référentiel
 * pendant le build, à partir des variables d'environnement que la plateforme
 * injecte déjà. Les deux opérations sont rejouables sans effet de bord, ce qui
 * les rend sûres à chaque déploiement :
 *
 *  - « prisma db push » ne touche à rien quand le schéma est déjà conforme ;
 *  - le seed procède par upsert, et ne réécrit jamais un mot de passe modifié
 *    depuis l'initialisation.
 *
 * Deux garde-fous :
 *
 *  - sans DATABASE_URL, le script ne fait rien et laisse le build réussir.
 *    C'est le cas du tout premier déploiement, avant que la base ne soit
 *    rattachée : l'application se construit et affiche son écran de
 *    configuration au lieu de planter ;
 *  - « db push » est lancé SANS --accept-data-loss. Si une évolution du
 *    schéma devait supprimer une colonne, le build échoue bruyamment au lieu
 *    de détruire des données en production. Ce cas demande une intervention
 *    humaine, pas une option de confort.
 *
 * Les affaires de démonstration sont explicitement désactivées : une base de
 * production ne doit contenir que de vraies consultations.
 */
import { execFileSync } from "node:child_process";

const url = process.env.DATABASE_URL;

if (!url) {
  console.log(
    "[provision] DATABASE_URL absent : création du schéma ignorée. " +
      "L'application se construit et affichera son écran de configuration.",
  );
  process.exit(0);
}

/**
 * Connexion directe, hors pooler.
 *
 * Les hébergeurs Postgres sans serveur exposent deux chaînes : une passant par
 * un pooler en mode transaction, et une directe. Le pooler convient aux
 * requêtes de l'application mais pas aux migrations, qui prennent des verrous
 * de session. On préfère donc la directe quand elle existe, sous l'un ou
 * l'autre des noms usuels, et on retombe sur DATABASE_URL sinon.
 */
const directUrl =
  process.env.DATABASE_URL_UNPOOLED ?? process.env.POSTGRES_URL_NON_POOLING ?? url;

if (directUrl === url) {
  console.log("[provision] Pas de connexion directe déclarée : DATABASE_URL sera utilisée.");
}

function run(label, file, args, extraEnv = {}) {
  console.log(`[provision] ${label}…`);
  execFileSync(file, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv, DATABASE_URL: directUrl },
  });
}

try {
  run("création du schéma", "npx", ["prisma", "db", "push", "--skip-generate"]);
  run("chargement du référentiel et des comptes", "npx", ["tsx", "prisma/seed.ts"], {
    TENDERA_SEED_DEMO: "0",
  });
  console.log("[provision] Base prête.");
} catch (error) {
  console.error(
    "[provision] Échec de la préparation de la base. " +
      "Le build est interrompu : déployer une application dont le schéma est " +
      "incomplet produirait des erreurs à chaque page.",
  );
  console.error(error.message);
  process.exit(1);
}
