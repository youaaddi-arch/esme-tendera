/**
 * Retrait d'un dossier de consultation avec l'épreuve anti-robot résolue par
 * un humain.
 *
 * Pourquoi ce script existe, et pourquoi il n'est pas un contournement.
 *
 * Certaines plateformes n'offrent le dossier qu'au terme d'une épreuve
 * anti-robot — sur AW Solutions, c'est le « retrait anonyme » prévu par
 * l'arrêté du 14/12/2009. Cette épreuve a un but : s'assurer qu'une personne
 * est dans la boucle. La lire à la place de la personne, par reconnaissance
 * de caractères ou par un service de résolution, c'est se faire passer pour
 * elle, et c'est exclu.
 *
 * Ici la personne est là. Le script ouvre la page, enregistre l'image, et
 * **attend**. Quelqu'un la lit et écrit la réponse dans un fichier ; le script
 * la saisit et poursuit. Le dispositif obtient exactement ce qu'il demande :
 * un humain qui a vu l'image. Ce qui est automatisé, c'est la navigation
 * autour — ouvrir la bonne page, suivre le bon lien, ranger le fichier.
 *
 * La contrepartie, qui doit être dite : le retrait anonyme n'inscrit pas
 * l'établissement sur la liste des retraits de la consultation. C'est cette
 * inscription qui déclenche l'envoi des avis rectificatifs. Un dossier obtenu
 * par cette voie est donc un dossier dont on ne saura pas qu'il a changé. À
 * préférer seulement quand la voie identifiée est fermée.
 *
 * La session doit rester ouverte entre l'affichage de l'image et la réponse :
 * le navigateur reste donc en vie, et c'est pourquoi ce script ne peut tourner
 * ni sur Vercel, dont les fonctions sont bornées à la minute, ni dans une
 * tâche planifiée qui ne sait attendre personne.
 *
 *     node scripts/retrait-dce-captcha.mjs --url "<adresse DCE de l'avis>" --sortie <dossier>
 *
 * Le script écrit <sortie>/captcha.png puis attend <sortie>/reponse.txt.
 */
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

function argument(nom, defaut = null) {
  const i = process.argv.indexOf(`--${nom}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
}

/** Attend que quelqu'un écrive la réponse, ou renonce. */
async function attendreReponse(chemin, minutes) {
  const limite = Date.now() + minutes * 60_000;
  while (Date.now() < limite) {
    try {
      const brut = (await readFile(chemin, "utf8")).trim();
      if (brut) {
        await unlink(chemin).catch(() => {});
        return brut;
      }
    } catch {
      // Pas encore de fichier : c'est le cas normal.
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

async function decrire(page) {
  return page.evaluate(() => {
    const vu = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return {
      url: location.href,
      champs: [...document.querySelectorAll("input, select, textarea")].filter(vu).map((el) => ({
        type: el.getAttribute("type") || el.tagName.toLowerCase(),
        name: el.getAttribute("name"),
        id: el.id || null,
        label: (el.labels?.[0]?.innerText || el.getAttribute("placeholder") || "").trim().slice(0, 60),
      })),
      actions: [...document.querySelectorAll("button, a, input[type=submit]")]
        .filter(vu)
        .map((el) => ({ texte: (el.innerText || el.value || "").trim().slice(0, 60), href: el.getAttribute("href") }))
        .filter((a) => a.texte)
        .slice(0, 25),
    };
  });
}

async function main() {
  const cible = argument("url");
  const SORTIE = argument("sortie", "retrait-dce");
  const minutes = Number(argument("attente", "20"));
  if (!cible) {
    console.error("--url <adresse DCE> est obligatoire.");
    process.exitCode = 1;
    return;
  }
  await mkdir(SORTIE, { recursive: true });

  const navigateur = await chromium.launch();
  const contexte = await navigateur.newContext({
    locale: "fr-FR",
    acceptDownloads: true,
    userAgent: "ESME-TENDERA/0.1 (retrait de DCE pour le compte titulaire)",
  });
  const page = await contexte.newPage();

  try {
    await page.goto(cible, { waitUntil: "networkidle", timeout: 90_000 });
    console.log(`Page du dossier : ${page.url()}`);

    // La voie anonyme est nommée par la page elle-même.
    const lien = page.getByRole("link", { name: /mode\s+anonyme/i }).first();
    if ((await lien.count()) > 0) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle", timeout: 90_000 }).catch(() => {}),
        lien.click(),
      ]);
      await page.waitForTimeout(2500);
      console.log(`Retrait anonyme : ${page.url()}`);
    }

    for (let tour = 1; tour <= 3; tour += 1) {
      const image = page.locator('img[alt*="aptcha" i], img[src*="captcha" i]').first();
      if ((await image.count()) === 0) {
        console.log("Aucune image de captcha sur cette page.");
        break;
      }

      // L'image seule, pas la page : c'est ce qu'on donne à lire.
      await image.screenshot({ path: `${SORTIE}/captcha.png` });
      await page.screenshot({ path: `${SORTIE}/page.png`, fullPage: true });
      console.log(`\nTENTATIVE ${tour} — image enregistrée : ${SORTIE}/captcha.png`);
      console.log(`J'attends la réponse dans ${SORTIE}/reponse.txt (${minutes} min)…`);

      const reponse = await attendreReponse(`${SORTIE}/reponse.txt`, minutes);
      if (!reponse) {
        console.error("Personne n'a répondu dans le délai. La session est abandonnée.");
        process.exitCode = 6;
        return;
      }
      console.log(`Réponse reçue (${reponse.length} caractères). Envoi…`);

      const champ = page.locator('input[name="captchaVal"], #texteCaptcha').first();
      await champ.fill(reponse);

      const attente = page.waitForEvent("download", { timeout: 60_000 }).catch(() => null);
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle", timeout: 60_000 }).catch(() => {}),
        page.locator('input[type="submit"], button[type="submit"]').first().click(),
      ]);
      let telechargement = await attente;
      await page.waitForTimeout(2500);

      // Le dossier peut arriver après un pas de plus : certaines plateformes
      // affichent d'abord la liste des pièces.
      if (!telechargement) {
        const vue = await decrire(page);
        await writeFile(`${SORTIE}/apres-captcha.json`, JSON.stringify(vue, null, 2), "utf8");
        await page.screenshot({ path: `${SORTIE}/apres-captcha.png`, fullPage: true });
        console.log(JSON.stringify(vue, null, 2));

        // Une image de captcha encore là signale un refus : on redemande.
        const encore = page.locator('img[alt*="aptcha" i], img[src*="captcha" i]').first();
        if ((await encore.count()) > 0 && tour < 3) {
          console.log("Le captcha est toujours affiché : réponse probablement refusée, nouvelle image.");
          continue;
        }

        for (const motif of [
          /t[ée]l[ée]charger\s+le\s+dce/i,
          /t[ée]l[ée]charger\s+le\s+dossier/i,
          /t[ée]l[ée]charger/i,
          /valider/i,
        ]) {
          const bouton = page
            .getByRole("button", { name: motif })
            .or(page.getByRole("link", { name: motif }))
            .first();
          if ((await bouton.count()) === 0) continue;
          console.log(`Déclenchement : « ${(await bouton.innerText()).trim()} »`);
          const suite = page.waitForEvent("download", { timeout: 120_000 }).catch(() => null);
          await bouton.click();
          telechargement = await suite;
          if (telechargement) break;
        }
      }

      if (!telechargement) {
        console.error("Aucun téléchargement. L'état de la page est dans apres-captcha.json.");
        process.exitCode = 5;
        return;
      }

      const nom = telechargement.suggestedFilename() || "dce.zip";
      await telechargement.saveAs(`${SORTIE}/${nom}`);
      console.log(`\nDOSSIER RÉCUPÉRÉ : ${SORTIE}/${nom}`);
      await writeFile(`${SORTIE}/fichier.txt`, nom, "utf8");
      return;
    }
  } finally {
    await contexte.close();
    await navigateur.close();
  }
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});
