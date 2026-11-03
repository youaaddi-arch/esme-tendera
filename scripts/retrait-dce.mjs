/**
 * Retrait d'un dossier de consultation, à la main, depuis un terminal.
 *
 * Sert à éprouver une plateforme avant de la confier à l'ouvrier, et à
 * récupérer un dossier précis sans passer par la file. La navigation est
 * exactement celle de l'ouvrier — même module, donc même comportement.
 *
 * L'épreuve anti-robot est résolue par une personne, et c'est délibéré. Cette
 * épreuve a un but : s'assurer qu'un humain est dans la boucle. La lire à la
 * place de la personne, par reconnaissance de caractères ou par un service de
 * résolution, serait se faire passer pour elle. Ici le script enregistre
 * l'image et attend qu'on écrive la réponse dans un fichier.
 *
 * Deux contreparties, qu'il vaut mieux savoir avant qu'après. Le retrait
 * anonyme n'inscrit pas l'établissement sur la liste des retraits, et c'est
 * cette inscription qui déclenche l'envoi des avis rectificatifs : un dossier
 * obtenu ainsi est un dossier dont on ne saura pas qu'il a changé. Et la
 * session doit vivre entre l'affichage de l'image et la réponse, ce qui exclut
 * Vercel comme toute tâche qui ne sait attendre personne.
 *
 *     node scripts/retrait-dce.mjs --url "<adresse DCE de l'avis>" --sortie <dossier>
 *
 * Le script écrit <sortie>/captcha.png puis attend <sortie>/reponse.txt.
 */
import { mkdir, writeFile, readFile, unlink, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { retirerDossier } from "./lib/retrait-navigation.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

function argument(nom, defaut = null) {
  const i = process.argv.indexOf(`--${nom}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
}

async function main() {
  const cible = argument("url");
  const SORTIE = argument("sortie", "retrait-dce");
  const minutes = Number(argument("attente", "20"));
  if (!cible) {
    console.error("--url <adresse DCE> est obligatoire. Elle figure dans l'avis de la consultation.");
    process.exitCode = 1;
    return;
  }
  await mkdir(SORTIE, { recursive: true });

  const navigateur = await chromium.launch();
  const contexte = await navigateur.newContext({
    locale: "fr-FR",
    acceptDownloads: true,
    // Identifiable : on ne se fait pas passer pour un visiteur ordinaire.
    userAgent: "ESME-TENDERA/0.1 (retrait de dossier de consultation)",
  });

  const journal = [];

  /** Le canal : ici, un dossier de fichiers et la patience de quelqu'un. */
  const canal = {
    journaliser(texte) {
      journal.push(texte);
      console.log(texte);
    },

    async poserCaptcha(dataUri) {
      const base64 = dataUri.replace(/^data:image\/\w+;base64,/, "");
      await writeFile(`${SORTIE}/captcha.png`, Buffer.from(base64, "base64"));
      console.log(`Image enregistrée : ${SORTIE}/captcha.png`);
      console.log(`J'attends la réponse dans ${SORTIE}/reponse.txt (${minutes} min)…`);
      return { ok: true };
    },

    async lireReponse() {
      const chemin = `${SORTIE}/reponse.txt`;
      const limite = Date.now() + minutes * 60_000;
      while (Date.now() < limite) {
        try {
          const brut = (await readFile(chemin, "utf8")).trim();
          if (brut) {
            await unlink(chemin).catch(() => {});
            console.log(`Réponse reçue (${brut.length} caractères).`);
            return brut;
          }
        } catch {
          // Pas encore de fichier : c'est le cas normal.
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      return null;
    },

    async verser(chemin, nom) {
      await copyFile(chemin, `${SORTIE}/${nom}`);
      await writeFile(`${SORTIE}/fichier.txt`, nom, "utf8");
      return { ok: true };
    },
  };

  try {
    const issue = await retirerDossier({ contexte, url: cible, canal });
    await writeFile(`${SORTIE}/journal.txt`, journal.join("\n"), "utf8");

    if (issue.page) {
      await writeFile(`${SORTIE}/page.json`, JSON.stringify(issue.page, null, 2), "utf8");
      console.log(JSON.stringify(issue.page, null, 2));
    }

    if (!issue.ok) {
      console.error(`\nÉchec : ${issue.echec}`);
      process.exitCode = 5;
      return;
    }
    console.log(`\nDOSSIER RÉCUPÉRÉ : ${SORTIE}/${issue.fichier}`);
  } finally {
    await contexte.close();
    await navigateur.close();
  }
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});
