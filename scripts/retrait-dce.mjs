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
 * Parcours observé sur AW Solutions, en deux temps, et il faut les deux.
 *
 * L'adresse « dematEnt.login&type=DCE » publiée par l'avis ne propose, pour un
 * visiteur anonyme, qu'un téléchargement protégé par une épreuve anti-robot —
 * celle de l'arrêté du 14/12/2009, qui n'oblige à rien de plus que de laisser
 * une trace. Contrairement à ce que son nom laisse croire, elle ne porte aucun
 * formulaire de connexion : vérifié, il n'y a pas de champ de mot de passe.
 *
 * La connexion se fait ailleurs, sur une adresse de la même consultation qui
 * redirige vers Keycloak. Une fois la session ouverte, on revient sur la page
 * du dossier, qui n'a plus affaire à un visiteur anonyme.
 *
 * Pourquoi se connecter plutôt que de prendre la voie anonyme : le retrait
 * identifié inscrit l'établissement sur la liste des retraits, et c'est ce qui
 * déclenche l'envoi des avis rectificatifs. C'est la raison d'être du compte.
 *
 * D'où deux adresses, et deux rôles distincts :
 *
 *     node scripts/retrait-dce.mjs \
 *       --auth "<adresse de la consultation, qui mène à Keycloak>" \
 *       --url  "<adresse du DCE publiée par l'avis>"
 *
 *     --mode diagnostic : décrit les deux pages et ne télécharge rien.
 *
 * La phase d'authentification ne clique sur rien. Elle traverse la page sur
 * laquelle Keycloak nous dépose — qui se trouve être le début du parcours de
 * dépôt — et s'en va. Regarder une page n'engage personne ; c'est cliquer qui
 * engage, et le garde-fou du dépôt veille sur la phase où l'on clique.
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

/**
 * Ouvre la session sur le profil d'acheteur.
 *
 * Ne clique sur rien d'autre que le bouton de connexion. Keycloak dépose
 * l'utilisateur sur la page de son choix — ici le début du parcours de dépôt —
 * et ce n'est pas une raison pour y toucher.
 */
async function authentifier(page, url, login, motDePasse) {
  console.log(`Authentification : ${url}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });

  const protection = await protectionDetectee(page);
  if (protection) {
    console.error(`Protection sur la page de connexion (${protection}). Arrêt volontaire.`);
    await page.screenshot({ path: `${SORTIE}/protection-connexion.png`, fullPage: true });
    return { ok: false, code: 2 };
  }

  const champMotDePasse = page.locator('input[type="password"]').first();
  if ((await champMotDePasse.count()) === 0) {
    console.error(
      "Aucun formulaire de connexion sur cette adresse. Vérifiez --auth : il faut l'adresse de la " +
        "consultation qui redirige vers l'authentification, pas celle du DCE.",
    );
    await page.screenshot({ path: `${SORTIE}/connexion-introuvable.png`, fullPage: true });
    await writeFile(`${SORTIE}/connexion-introuvable.json`, JSON.stringify(await decrire(page), null, 2), "utf8");
    return { ok: false, code: 3 };
  }

  await page.locator('input[name="username"], input[type="text"], input[type="email"]').first().fill(login);
  await champMotDePasse.fill(motDePasse);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle", timeout: 90_000 }).catch(() => {}),
    page.locator('input[type="submit"], button[type="submit"]').first().click(),
  ]);
  await page.waitForTimeout(5000);

  // Un champ de mot de passe encore présent signale un refus : la page de
  // connexion s'est réaffichée.
  if ((await page.locator('input[type="password"]').count()) > 0) {
    console.error(
      "Connexion refusée. Vérifiez AWS_LOGIN et AWS_PASSWORD dans les secrets du dépôt — " +
        "le mot de passe a-t-il bien été changé puis redéposé ?",
    );
    await page.screenshot({ path: `${SORTIE}/connexion-refusee.png`, fullPage: true });
    return { ok: false, code: 4 };
  }

  console.log(`Session ouverte. Keycloak a déposé la session sur : ${page.url()}`);
  return { ok: true };
}

/**
 * Suit le lien du retrait identifié, et seulement celui-là.
 *
 * Une fois la session ouverte, la page du dossier propose les deux routes côte
 * à côte, et les nomme :
 *
 *   « retirer le DCE en mode anonyme »  → index.cfm?fuseaction=dce.avertissement
 *   « le bordereau de retrait »         → https://awsolutions.fr/apr/inscription
 *
 * La seconde est celle du compte : s'inscrire au retrait, c'est entrer sur la
 * liste des retraits de la consultation, et c'est cette inscription qui
 * déclenche l'envoi des avis rectificatifs. La première ne laisse qu'une trace
 * anonyme et passe par l'épreuve anti-robot.
 *
 * La route anonyme est donc explicitement exclue, par son adresse et par son
 * intitulé. Non pas parce qu'on ne saurait pas la prendre, mais parce que la
 * prendre reviendrait à se présenter en inconnu avec les clés en poche, et à
 * perdre les rectificatifs sur un marché qui se clôt dans un mois.
 */
const ANONYME = [/dce\.avertissement/i, /anonyme/i];

const RETRAIT_IDENTIFIE = [
  /bordereau\s+de\s+retrait/i,
  /^\s*retrait\s*$/i,
  /s'inscrire\s+au\s+retrait/i,
  /r[ée]obtenir/i,
];

async function suivreRetraitIdentifie(page) {
  const liens = await page.evaluate(() =>
    [...document.querySelectorAll("a, button")].map((el) => ({
      texte: (el.innerText || el.value || "").trim(),
      href: el.getAttribute("href"),
    })),
  );

  for (const motif of RETRAIT_IDENTIFIE) {
    const lien = liens.find(
      (l) =>
        motif.test(l.texte) &&
        l.href &&
        !ANONYME.some((exclu) => exclu.test(l.href) || exclu.test(l.texte)),
    );
    if (!lien) continue;

    const adresse = new URL(lien.href, page.url()).toString();
    console.log(`Retrait identifié : « ${lien.texte} » → ${adresse}`);
    await page.goto(adresse, { waitUntil: "networkidle", timeout: 90_000 });
    return adresse;
  }
  return null;
}

async function main() {
  const cible = argument("url");
  const authUrl = argument("auth");
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
    if (authUrl) {
      const auth = await authentifier(page, authUrl, login, motDePasse);
      if (!auth.ok) {
        process.exitCode = auth.code;
        return;
      }

      // Décrire la page d'arrivée aide à trouver où se fait le retrait dans
      // l'application : c'est de l'observation, et aucun clic n'en découle.
      const arrivee = await decrire(page);
      await page.screenshot({ path: `${SORTIE}/apres-connexion.png`, fullPage: true });
      await writeFile(`${SORTIE}/apres-connexion.json`, JSON.stringify(arrivee, null, 2), "utf8");
    } else {
      console.log("Aucun --auth : on tente la page du dossier telle quelle.");
    }

    console.log(`Page du dossier : ${cible}`);
    await page.goto(cible, { waitUntil: "networkidle", timeout: 90_000 });

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

    // La page du dossier n'est qu'un carrefour : le retrait identifié est une
    // page de l'application, pas un bouton de celle-ci.
    const suivi = await suivreRetraitIdentifie(page);
    if (suivi) {
      const depotApres = await parcoursDeDepot(page);
      if (depotApres) {
        console.error(
          `Le lien de retrait mène au parcours de dépôt (${depotApres}). Arrêt immédiat : ` +
            "ce script retire des dossiers, il ne dépose jamais d'offre.",
        );
        await page.screenshot({ path: `${SORTIE}/parcours-de-depot.png`, fullPage: true });
        process.exitCode = 7;
        return;
      }
      const vueRetrait = await decrire(page);
      await page.screenshot({ path: `${SORTIE}/retrait.png`, fullPage: true });
      await writeFile(`${SORTIE}/retrait.json`, JSON.stringify(vueRetrait, null, 2), "utf8");
      console.log(JSON.stringify(vueRetrait, null, 2));
    } else {
      console.log(
        "Aucun lien de retrait identifié sur cette page. Les intitulés figurent dans consultation.json.",
      );
    }

    const protection = await protectionDetectee(page);

    if (mode === "diagnostic") {
      console.log(
        `\nMode diagnostic : rien n'est téléchargé.` +
          (protection ? ` Une protection est présente sur cette page (${protection}).` : ""),
      );
      return;
    }

    if (protection) {
      console.error(
        `Protection sur la page du dossier (${protection}), session ouverte comprise. Arrêt volontaire : ` +
          "la franchir n'est pas de notre ressort. Si le retrait identifié existe, il est ailleurs " +
          "dans l'application — les intitulés de la page d'arrivée figurent dans apres-connexion.json.",
      );
      await page.screenshot({ path: `${SORTIE}/protection.png`, fullPage: true });
      process.exitCode = 2;
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
