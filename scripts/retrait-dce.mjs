/**
 * Retrait du dossier de consultation sur un profil d'acheteur AW Solutions.
 *
 * Une plateforme de dépôt n'est pas une plateforme de veille. Le BOAMP, TED ou
 * France Marchés *publient* les avis, en données ouvertes : la veille les lit
 * librement. AW Solutions, PLACE ou Maximilien sont les profils d'acheteur où
 * l'on *retire* le dossier et où l'on *dépose* l'offre : l'accès y est
 * nominatif, et l'avis BOAMP ne fait que pointer vers eux.
 *
 * Ce script fait donc, avec le compte de l'établissement, ce qu'un chargé
 * d'affaires ferait à la main sur une consultation précise.
 *
 * Deux limites, tenues par le code :
 *
 *  - il ne traite **que** la consultation qu'on lui désigne. Il ne parcourt
 *    pas le catalogue d'avis de la plateforme et n'en recopie rien : leurs
 *    conditions d'utilisation interdisent la reproduction de leur contenu,
 *    alors que retirer le dossier d'un marché auquel on répond est l'usage
 *    même du compte ;
 *  - il s'arrête devant toute protection — épreuve anti-robot, second facteur.
 *    Les contourner serait franchir la ligne.
 *
 * Parcours observé sur AW Solutions : la page « dematEnt.login&type=DCE » offre
 * deux routes vers le même dossier. Un téléchargement anonyme, protégé par une
 * épreuve anti-robot — celle de l'arrêté du 14/12/2009, qui n'oblige à rien de
 * plus que de laisser une trace. Et une connexion au compte opérateur
 * économique, qui donne le dossier sans épreuve et, surtout, inscrit
 * l'établissement sur la liste des retraits : c'est ce qui déclenche l'envoi
 * des rectificatifs. C'est la seconde qu'on prend, et c'est pour cela que le
 * compte existe.
 *
 * La distinction compte pour l'ordre des opérations : la page affiche les deux
 * routes à la fois, donc l'épreuve anti-robot y est visible alors même qu'on
 * ne la rencontrera pas. On s'authentifie d'abord, et on ne juge qu'ensuite
 * s'il reste un obstacle sur notre chemin. Une épreuve qui survit à
 * l'authentification, elle, est un vrai mur : on s'arrête.
 *
 *     node scripts/retrait-dce.mjs --url "<adresse DCE de l'avis>"
 *     node scripts/retrait-dce.mjs --url "…" --mode diagnostic
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

// Playwright n'est pas une dépendance du projet : il n'a rien à faire dans le
// paquet déployé, qui n'ouvre jamais de navigateur. Il est fourni par
// l'environnement d'exécution du script.
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const SORTIE = process.env.RETRAIT_SORTIE ?? "retrait-dce";

function argument(nom, defaut = null) {
  const index = process.argv.indexOf(`--${nom}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : defaut;
}

/**
 * Indices d'une protection qu'on ne doit pas tenter de franchir.
 *
 * La détection est volontairement large : en cas de doute on s'arrête et on le
 * dit, plutôt que d'insister et de ressembler à ce qu'on n'est pas.
 */
const PROTECTIONS = [
  /recaptcha/i, /hcaptcha/i, /turnstile/i, /\bcaptcha\b/i,
  /double\s*authentification/i, /authentification\s*à\s*deux\s*facteurs/i,
  /code\s*de\s*v[ée]rification/i, /vous\s*n'êtes\s*pas\s*un\s*robot/i,
];

async function protectionDetectee(page) {
  const contenu = await page.content();
  const trouve = PROTECTIONS.find((motif) => motif.test(contenu));
  return trouve ? trouve.source : null;
}

/**
 * Reconnaît le parcours de dépôt d'une offre, pour en sortir aussitôt.
 *
 * Sur AW Solutions, l'adresse de la consultation et celle du dépôt se
 * ressemblent, et l'une redirige vers l'autre une fois connecté : on arrive
 * sur un assistant « CGU → Lots → Documents → Récapitulatif » qui est la
 * remise des plis. Un script qui y cliquerait « Suivant » engagerait
 * l'établissement.
 *
 * Déposer une offre est un acte humain, qui suppose des pièces relues et une
 * décision prise. Ce script ne doit jamais s'en approcher, même par accident,
 * et surtout pas parce qu'aucun bouton de téléchargement n'a été trouvé.
 */
async function parcoursDeDepot(page) {
  // Deux signes, et seulement ceux-là : l'adresse du dépôt, et l'assistant au
  // complet.
  //
  // La tentation serait de guetter des mots. Elle est mauvaise : « remise des
  // plis » figure sur toutes les pages de consultation, dans « date limite de
  // remise des plis », et un lien « déposer un pli » peut très bien voisiner
  // avec le retrait du dossier sans qu'on soit engagé dans quoi que ce soit.
  // Un garde-fou qui se déclenche à tort est un garde-fou qu'on finit par
  // retirer. Ce qui compte n'est pas ce que la page propose, c'est où l'on est.
  const url = page.url();
  if (/\/apr\/depot\//i.test(url)) return `adresse de dépôt (${url})`;

  const contenu = await page.content();
  const etapes = [/\bCGU\b/i, /\bLots\b/i, /\bDocuments\b/i, /r[ée]capitulatif/i];
  if (etapes.every((motif) => motif.test(contenu))) {
    return "assistant de dépôt (CGU, Lots, Documents, Récapitulatif)";
  }
  return null;
}

/** Décrit la structure d'une page, sans en recopier le contenu. */
async function decrire(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return {
      titre: document.title,
      url: location.href,
      champs: [...document.querySelectorAll("input, select")].filter(visible).map((el) => ({
        type: el.getAttribute("type"),
        name: el.getAttribute("name"),
        id: el.id || null,
      })),
      actions: [...document.querySelectorAll("button, a, input[type=submit]")]
        .filter(visible)
        .map((el) => ({
          texte: (el.innerText || el.value || "").trim().slice(0, 60),
          href: el.getAttribute("href"),
        }))
        .filter((a) => a.texte)
        .slice(0, 40),
    };
  });
}

async function main() {
  const cible = argument("url");
  const mode = argument("mode", "retrait");
  const login = process.env.AWS_LOGIN;
  const motDePasse = process.env.AWS_PASSWORD;

  if (!cible) {
    console.error("--url <adresse DCE> est obligatoire. Elle figure dans l'avis BOAMP de la consultation.");
    process.exitCode = 1;
    return;
  }
  if (!login || !motDePasse) {
    console.error("AWS_LOGIN et AWS_PASSWORD doivent venir des secrets du dépôt, jamais de la ligne de commande.");
    process.exitCode = 1;
    return;
  }

  await mkdir(SORTIE, { recursive: true });

  const navigateur = await chromium.launch();
  const contexte = await navigateur.newContext({
    locale: "fr-FR",
    acceptDownloads: true,
    // Identifiable : on ne se fait pas passer pour un visiteur ordinaire.
    userAgent: "ESME-TENDERA/0.1 (retrait de DCE pour le compte titulaire)",
  });
  const page = await contexte.newPage();

  try {
    console.log(`Ouverture de la consultation : ${cible}`);
    await page.goto(cible, { waitUntil: "networkidle", timeout: 90_000 });

    // On ne juge pas les protections avant d'avoir pris notre route.
    //
    // La page du DCE présente les deux accès côte à côte : l'épreuve
    // anti-robot du téléchargement anonyme y est donc dans le HTML même quand
    // on ne la rencontrera jamais. Abandonner ici, c'était renoncer à la porte
    // qui nous est ouverte parce que l'autre est fermée.
    const champMotDePasse = page.locator('input[type="password"]').first();
    if ((await champMotDePasse.count()) > 0) {
      console.log("Page d'authentification détectée, connexion…");
      await page.locator('input[name="username"], input[type="text"], input[type="email"]').first().fill(login);
      await champMotDePasse.fill(motDePasse);
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle", timeout: 90_000 }).catch(() => {}),
        page.locator('input[type="submit"], button[type="submit"]').first().click(),
      ]);
      await page.waitForTimeout(5000);
    } else {
      console.log("Pas de formulaire d'authentification : session déjà ouverte, ou page inattendue.");
    }

    // Maintenant le jugement a un sens : ce qui reste est sur notre chemin.
    const protection = await protectionDetectee(page);
    if (protection) {
      console.error(
        `Protection après authentification (${protection}). Arrêt volontaire : une épreuve qui ` +
          "survit à la connexion est un vrai mur, et la franchir n'est pas de notre ressort.",
      );
      await page.screenshot({ path: `${SORTIE}/protection.png`, fullPage: true });
      process.exitCode = 2;
      return;
    }

    // Un champ de mot de passe encore présent signale un refus : la page de
    // connexion s'est réaffichée.
    if ((await page.locator('input[type="password"]').count()) > 0) {
      console.error(
        "Connexion refusée. Vérifiez AWS_LOGIN et AWS_PASSWORD dans les secrets du dépôt — " +
          "le mot de passe a-t-il bien été changé puis redéposé ?",
      );
      await page.screenshot({ path: `${SORTIE}/connexion-refusee.png`, fullPage: true });
      process.exitCode = 4;
      return;
    }

    console.log(`Connecté. Page courante : ${page.url()}`);

    const depot = await parcoursDeDepot(page);
    if (depot) {
      console.error(
        `Parcours de dépôt détecté (${depot}). Arrêt immédiat : ce script retire des dossiers, ` +
          "il ne dépose jamais d'offre. Déposer suppose des pièces relues et une décision prise — " +
          "cela ne s'automatise pas.",
      );
      await page.screenshot({ path: `${SORTIE}/parcours-de-depot.png`, fullPage: true });
      process.exitCode = 7;
      return;
    }

    const vue = await decrire(page);
    await page.screenshot({ path: `${SORTIE}/consultation.png`, fullPage: true });
    await writeFile(`${SORTIE}/consultation.json`, JSON.stringify(vue, null, 2), "utf8");
    console.log(JSON.stringify(vue, null, 2));

    if (mode === "diagnostic") {
      console.log("\nMode diagnostic : session ouverte, page décrite, rien n'est téléchargé.");
      return;
    }

    // Le bouton de téléchargement est cherché par son intitulé : les classes
    // d'une application JavaScript changent à chaque livraison, pas les mots
    // affichés à l'utilisateur.
    const intitules = [
      /t[ée]l[ée]charger\s+le\s+dce/i,
      /t[ée]l[ée]charger\s+le\s+dossier/i,
      /retrait\s+du\s+dossier/i,
      /dossier\s+de\s+consultation/i,
      /t[ée]l[ée]charger/i,
    ];

    let telechargement = null;
    for (const motif of intitules) {
      const bouton = page.getByRole("button", { name: motif }).or(page.getByRole("link", { name: motif })).first();
      if ((await bouton.count()) === 0) continue;
      console.log(`Déclenchement : « ${(await bouton.innerText()).trim()} »`);
      const attente = page.waitForEvent("download", { timeout: 120_000 }).catch(() => null);
      await bouton.click();
      telechargement = await attente;
      if (telechargement) break;
    }

    if (!telechargement) {
      console.error(
        "Aucun téléchargement déclenché. Les intitulés de la page figurent dans consultation.json : " +
          "ajoutez le bon motif à la liste.",
      );
      process.exitCode = 5;
      return;
    }

    const nom = telechargement.suggestedFilename() || "dce.zip";
    const chemin = `${SORTIE}/${nom}`;
    await telechargement.saveAs(chemin);
    console.log(`\nDossier récupéré : ${chemin}`);
    await writeFile(`${SORTIE}/fichier.txt`, nom, "utf8");
  } finally {
    await contexte.close();
    await navigateur.close();
  }
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});
