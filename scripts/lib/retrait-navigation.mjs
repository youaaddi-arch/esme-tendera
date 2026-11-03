/**
 * Navigation d'un retrait de dossier, indépendante de qui l'accompagne.
 *
 * Deux entrées se partagent ce code : un script de ligne de commande, où la
 * réponse à l'épreuve anti-robot arrive par un fichier, et un ouvrier de
 * tâche planifiée, où elle arrive par la plateforme. La navigation, elle, est
 * la même, et elle n'a pas à savoir laquelle des deux l'appelle.
 *
 * C'est pour cela qu'elle est ici plutôt que recopiée. Le moteur de matching
 * a eu deux copies, celle de l'application et celle d'un script : elles ont
 * divergé sans que personne le voie, et un recalcul global laissait la base
 * dans un état différent d'un recalcul depuis l'interface. Une règle qui
 * existe en deux exemplaires finit par exister en deux versions.
 *
 * Le dialogue avec l'extérieur passe par un « canal », qui sait quatre
 * choses : poser l'image, lire la réponse, verser le fichier, conclure.
 */

/** Indices d'une protection qu'on ne doit pas tenter de franchir seul. */
const PROTECTIONS_DURES = [
  /recaptcha/i,
  /hcaptcha/i,
  /turnstile/i,
  /double\s*authentification/i,
  /authentification\s*à\s*deux\s*facteurs/i,
  /code\s*de\s*v[ée]rification/i,
];

/**
 * Reconnaît le parcours de dépôt d'une offre, pour en sortir aussitôt.
 *
 * Deux signes, et seulement ceux-là : l'adresse du dépôt, et l'assistant au
 * complet. Guetter des mots serait pire qu'inutile — « remise des plis »
 * figure sur toutes les pages de consultation, et un garde-fou qui se
 * déclenche à tort est un garde-fou qu'on finit par retirer.
 */
export async function parcoursDeDepot(page) {
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
export async function decrire(page) {
  return page.evaluate(() => {
    const vu = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return {
      titre: document.title,
      url: location.href,
      champs: [...document.querySelectorAll("input, select, textarea")].filter(vu).map((el) => ({
        type: el.getAttribute("type") || el.tagName.toLowerCase(),
        name: el.getAttribute("name"),
        id: el.id || null,
        label: (el.labels?.[0]?.innerText || el.getAttribute("placeholder") || "").trim().slice(0, 60),
      })),
      actions: [...document.querySelectorAll("button, a, input[type=submit]")]
        .filter(vu)
        .map((el) => ({
          texte: (el.innerText || el.value || "").trim().slice(0, 60),
          href: el.getAttribute("href"),
        }))
        .filter((a) => a.texte)
        .slice(0, 30),
    };
  });
}

/**
 * Retire le dossier d'une consultation.
 *
 * @param {object} options
 * @param {import("playwright").BrowserContext} options.contexte
 * @param {string} options.url      adresse de retrait publiée par l'avis
 * @param {object} options.canal    poserCaptcha, lireReponse, verser, journaliser
 * @param {number} [options.epreuvesMax]
 * @returns {Promise<{ok: boolean, echec?: string, fichier?: string, page?: object}>}
 */
export async function retirerDossier({ contexte, url, canal, epreuvesMax = 3 }) {
  const dire = canal.journaliser ?? ((texte) => console.log(texte));

  /**
   * Les téléchargements s'écoutent sur le navigateur, pas sur la page.
   *
   * Un lien de téléchargement ouvre volontiers un onglet, et le fichier
   * arrive sur cette page-là : attendre l'événement sur la page d'origine le
   * manque et fait conclure à tort qu'aucun fichier n'est venu.
   */
  let recu = null;
  contexte.on("download", (d) => {
    recu = d;
  });
  contexte.on("page", (p) => {
    p.on("download", (d) => {
      recu = d;
    });
  });
  const attendreFichier = async (secondes) => {
    const limite = Date.now() + secondes * 1000;
    while (Date.now() < limite) {
      if (recu) return recu;
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  };

  const page = await contexte.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
  dire(`Page du dossier : ${page.url()}`);

  const depot = await parcoursDeDepot(page);
  if (depot) {
    return {
      ok: false,
      echec:
        `Parcours de dépôt détecté (${depot}). Ce retrait ne dépose jamais d'offre : ` +
        "déposer suppose des pièces relues et une décision prise.",
    };
  }

  // La voie anonyme est nommée par la page elle-même, quand elle existe.
  const lienAnonyme = page.getByRole("link", { name: /mode\s+anonyme/i }).first();
  if ((await lienAnonyme.count()) > 0) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle", timeout: 90_000 }).catch(() => {}),
      lienAnonyme.click(),
    ]);
    await page.waitForTimeout(2500);
    dire(`Retrait : ${page.url()}`);
  }

  const contenu = await page.content();
  const dure = PROTECTIONS_DURES.find((motif) => motif.test(contenu));
  if (dure) {
    return {
      ok: false,
      echec:
        `Protection que nous ne franchissons pas (${dure.source}). ` +
        "Le dossier doit être retiré à la main depuis la plateforme.",
    };
  }

  for (let epreuve = 1; epreuve <= epreuvesMax; epreuve += 1) {
    const image = page.locator('img[alt*="aptcha" i], img[src*="captcha" i]').first();
    if ((await image.count()) === 0) break;

    // L'image seule, pas la page : c'est ce qu'on donne à lire.
    const binaire = await image.screenshot();
    dire(`Épreuve ${epreuve} : image transmise, en attente d'une saisie humaine.`);
    const pose = await canal.poserCaptcha(`data:image/png;base64,${binaire.toString("base64")}`);
    if (!pose.ok) return { ok: false, echec: pose.raison ?? "Image refusée par la plateforme." };

    const reponse = await canal.lireReponse();
    if (reponse === null) {
      return { ok: false, echec: "Aucune saisie dans le délai : retrait abandonné." };
    }

    await page.locator('input[name="captchaVal"], #texteCaptcha').first().fill(reponse);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle", timeout: 60_000 }).catch(() => {}),
      page.locator('input[type="submit"], button[type="submit"]').first().click(),
    ]);
    await page.waitForTimeout(2500);

    const encore = page.locator('img[alt*="aptcha" i], img[src*="captcha" i]').first();
    if ((await encore.count()) === 0) break;
    if (epreuve === epreuvesMax) {
      return { ok: false, echec: `Saisie refusée ${epreuvesMax} fois de suite.` };
    }
    dire("L'épreuve est toujours affichée : saisie probablement refusée.");
  }

  // Le dossier se télécharge lot par lot : sans sélection, le bouton ne
  // produit rien. On prend tous les lots — on retire le dossier pour le lire,
  // et on ne sait pas encore sur lesquels on répondra.
  const lots = page.locator('input[type="checkbox"][name="lots"]');
  const nombreLots = await lots.count();
  if (nombreLots > 0) {
    for (let i = 0; i < nombreLots; i += 1) {
      await lots.nth(i).check().catch(() => {});
    }
    dire(`${await page.locator('input[type="checkbox"][name="lots"]:checked').count()}/${nombreLots} lot(s) coché(s).`);
  }

  // Un seul déclenchement, et le plus précis. Enchaîner les intitulés « au
  // cas où » navigue, vide les cases, et les clics suivants portent sur une
  // sélection vide : le filet défaisait le travail du clic utile.
  const intitules = [
    /t[ée]l[ée]charger\s+les\s+dce\s+s[ée]lectionn[ée]s/i,
    /t[ée]l[ée]charger\s+le\s+dce/i,
    /t[ée]l[ée]charger\s+le\s+dossier/i,
    /t[ée]l[ée]charger/i,
  ];
  let declenche = false;
  for (const motif of intitules) {
    const bouton = page
      .getByRole("button", { name: motif })
      .or(page.getByRole("link", { name: motif }))
      .first();
    if ((await bouton.count()) === 0) continue;
    if (nombreLots > 0) {
      const coches = await page.locator('input[type="checkbox"][name="lots"]:checked').count();
      if (coches === 0) {
        for (let i = 0; i < nombreLots; i += 1) await lots.nth(i).check().catch(() => {});
      }
    }
    dire(`Déclenchement du téléchargement (${motif.source}).`);
    await bouton.click();
    declenche = true;
    break;
  }
  if (!declenche && nombreLots > 0) {
    dire("Aucun intitulé reconnu : soumission du formulaire de sélection.");
    await page.locator('input[type="submit"], button[type="submit"]').last().click();
    declenche = true;
  }
  if (!declenche) {
    return { ok: false, echec: "Aucun contrôle de téléchargement sur la page.", page: await decrire(page) };
  }

  const telechargement = await attendreFichier(150);
  if (!telechargement) {
    return {
      ok: false,
      echec: "Le téléchargement n'a pas été déclenché par la plateforme.",
      page: await decrire(page),
    };
  }

  const nom = telechargement.suggestedFilename() || "dce.zip";
  const chemin = await telechargement.path();
  dire(`Dossier obtenu : ${nom}`);
  const versement = await canal.verser(chemin, nom);
  if (!versement.ok) return { ok: false, echec: versement.raison ?? "Versement refusé.", fichier: nom };

  return { ok: true, fichier: nom };
}
