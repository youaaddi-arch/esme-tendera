/**
 * Ouvrier qui retire les dossiers de consultation.
 *
 * Il fait le va-et-vient entre la plateforme d'ESME TENDERA, qui sait quels
 * dossiers sont attendus, et les profils d'acheteur, qui les détiennent. Il
 * existe comme processus séparé pour une raison matérielle : retirer un
 * dossier demande un navigateur maintenu en vie pendant qu'une personne lit
 * une épreuve anti-robot, et une fonction Vercel est bornée à la minute.
 *
 * Son dialogue avec la plateforme est celui de /api/retrait. Il prend une
 * demande, navigue, transmet l'image de l'épreuve, attend la saisie, verse le
 * fichier, conclut. La navigation est partagée avec le script de ligne de
 * commande : voir scripts/lib/retrait-navigation.mjs.
 *
 * Ce qu'il ne fait jamais, et qui est tenu par le module de navigation : il ne
 * dépose aucune offre, et il ne franchit aucune protection seul.
 *
 *     TENDERA_URL=https://… TENDERA_JETON=… node scripts/ouvrier-retrait.mjs
 *
 * Il traite au plus --demandes demandes puis s'arrête, pour ne pas dépasser
 * la durée d'une exécution planifiée.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { retirerDossier } from "./lib/retrait-navigation.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

function argument(nom, defaut = null) {
  const i = process.argv.indexOf(`--${nom}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
}

const BASE = (process.env.TENDERA_URL ?? "").replace(/\/+$/, "");
const JETON = process.env.TENDERA_JETON;
const OUVRIER = process.env.OUVRIER ?? `ouvrier-${process.pid}-${Date.now().toString(36)}`;
const MAX_DEMANDES = Number(argument("demandes", "2"));

/** Attente maximale d'une saisie humaine, par épreuve. */
const ATTENTE_SAISIE_MINUTES = Number(argument("attente", "8"));

if (!BASE || !JETON) {
  console.error("TENDERA_URL et TENDERA_JETON sont obligatoires, et viennent des secrets du dépôt.");
  process.exit(1);
}

async function appel(chemin, options = {}) {
  const reponse = await fetch(`${BASE}${chemin}`, {
    ...options,
    headers: { Authorization: `Bearer ${JETON}`, ...(options.headers ?? {}) },
  });
  const texte = await reponse.text();
  let corps = null;
  try {
    corps = texte ? JSON.parse(texte) : null;
  } catch {
    corps = { brut: texte.slice(0, 300) };
  }
  return { statut: reponse.status, ok: reponse.ok, corps };
}

/**
 * Le canal : ce que la navigation sait faire du monde extérieur.
 *
 * Les appels échoués ne sont pas fatals ici, sauf le versement. Transmettre
 * une image ou lire une réponse peut rater une fois sans que le retrait soit
 * perdu, alors qu'un versement raté signifie que le dossier n'est pas arrivé
 * — et il ne faut surtout pas conclure au succès dans ce cas.
 */
function canalPlateforme(id, journal) {
  return {
    journaliser(texte) {
      journal.push(texte);
      console.log(texte);
    },

    async poserCaptcha(dataUri) {
      const r = await appel("/api/retrait", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "captcha", id, image: dataUri }),
      });
      return r.ok ? { ok: true } : { ok: false, raison: r.corps?.erreur ?? `HTTP ${r.statut}` };
    },

    /** Interroge la plateforme jusqu'à la saisie, ou jusqu'au renoncement. */
    async lireReponse() {
      const limite = Date.now() + ATTENTE_SAISIE_MINUTES * 60_000;
      while (Date.now() < limite) {
        const r = await appel(`/api/retrait?id=${encodeURIComponent(id)}`);
        if (r.ok && r.corps?.reponse) return String(r.corps.reponse);
        if (r.ok && r.corps?.abandonner) return null;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      // L'ouvrier s'arrête, mais la demande reste en attente : une prise
      // périmée est reprise par le suivant, avec une image fraîche.
      return null;
    },

    async verser(chemin, nom) {
      const contenu = await readFile(chemin);
      const form = new FormData();
      form.set("id", id);
      form.set("fichier", new Blob([contenu]), nom);
      const r = await appel("/api/retrait", { method: "POST", body: form });
      if (r.ok) return { ok: true };
      return {
        ok: false,
        raison:
          r.corps?.erreur ??
          `Le versement a échoué (HTTP ${r.statut}). Le dossier n'est pas dans l'affaire.`,
      };
    },
  };
}

async function main() {
  console.log(`Ouvrier ${OUVRIER} — plateforme ${BASE}`);

  const navigateur = await chromium.launch();
  try {
    for (let n = 0; n < MAX_DEMANDES; n += 1) {
      const prise = await appel("/api/retrait", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prendre", ouvrier: OUVRIER }),
      });
      if (!prise.ok) {
        console.error(`Impossible de prendre une demande : ${prise.corps?.erreur ?? prise.statut}`);
        process.exitCode = 1;
        return;
      }
      const demande = prise.corps?.demande;
      if (!demande) {
        console.log("Aucune demande en attente.");
        return;
      }

      console.log(`\n→ ${demande.reference} (tentative ${demande.tentatives + 1}) : ${demande.url}`);
      const journal = [];
      const contexte = await navigateur.newContext({
        locale: "fr-FR",
        acceptDownloads: true,
        // Identifiable : on ne se fait pas passer pour un visiteur ordinaire.
        userAgent: "ESME-TENDERA/0.1 (retrait de dossier de consultation)",
      });

      let issue;
      try {
        issue = await retirerDossier({
          contexte,
          url: demande.url,
          canal: canalPlateforme(demande.id, journal),
        });
      } catch (error) {
        issue = { ok: false, echec: `Erreur de navigation : ${error?.message ?? error}` };
      } finally {
        await contexte.close();
      }

      if (issue.page) journal.push(`État de la page : ${JSON.stringify(issue.page)}`);

      // Le versement conclut déjà côté plateforme quand il réussit : on ne
      // conclut ici que les échecs, pour ne pas écraser un succès.
      if (!issue.ok) {
        await appel("/api/retrait", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "conclure",
            id: demande.id,
            ok: false,
            echec: issue.echec ?? "Échec non précisé.",
            journal: journal.join("\n"),
          }),
        });
        console.error(`✗ ${demande.reference} : ${issue.echec}`);
      } else {
        console.log(`✓ ${demande.reference} : dossier versé (${issue.fichier}).`);
      }
    }
  } finally {
    await navigateur.close();
  }
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});
