/**
 * Parcours de bout en bout, dans un vrai navigateur.
 *
 * Vérifie la chaîne complète sur une affaire : import du DCE, analyse des
 * pièces, matching, décision GO, génération de l'espace de réponse, contrôle
 * qualité, export Word, et exécution d'un connecteur de veille.
 *
 * Prérequis : base initialisée (npm run db:seed) et serveur démarré sur
 * http://127.0.0.1:3000 (npm run build && npm run start).
 *
 *     node tests/e2e.mjs
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Playwright est fourni par l'environnement d'exécution plutôt que par les
// dépendances du projet : on le charge par son chemin, réglable au besoin.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.TENDERA_PLAYWRIGHT ?? "playwright");

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.TENDERA_E2E_URL ?? "http://127.0.0.1:3000";
const EMAIL = process.env.TENDERA_E2E_EMAIL ?? "admin@esme.fr";
const PASSWORD = process.env.TENDERA_E2E_PASSWORD ?? "Tendera2026!";

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30_000);

  try {
    // --- Connexion ------------------------------------------------------
    console.log("\nConnexion");
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE}/`, { timeout: 20_000 });
    check("session ouverte", page.url() === `${BASE}/`);
    check("tableau de bord affiché", await page.locator("h1", { hasText: "Tableau de bord" }).isVisible());

    // --- Pipeline -------------------------------------------------------
    console.log("\nPipeline");
    await page.goto(`${BASE}/pipeline`);
    const columns = await page.locator("section[aria-label]").count();
    check("onze colonnes de pipeline", columns >= 11, `colonnes trouvées : ${columns}`);
    const cards = await page.locator("article").count();
    check("cartes affichées", cards > 0, `cartes : ${cards}`);

    // --- Ouverture d'une affaire ----------------------------------------
    console.log("\nFiche consultation");
    await page.locator("article h3").first().click();
    await page.waitForURL(/\/affaires\//);
    const tenderUrl = page.url().split("?")[0];
    check("fiche ouverte", /\/affaires\/[a-z0-9]+/.test(tenderUrl));

    for (const tab of ["infos", "lots", "dce", "analyse", "matching", "decision", "reponse", "controle", "suivi", "historique"]) {
      await page.goto(`${tenderUrl}?onglet=${tab}`);
      const ok = await page.locator("nav[aria-label='Sections de la fiche']").isVisible();
      check(`onglet « ${tab} » affiché`, ok);
    }

    // --- Import du DCE ---------------------------------------------------
    console.log("\nImport et analyse du DCE");
    await page.goto(`${tenderUrl}?onglet=dce`);
    await page.setInputFiles('input[type="file"][name="fichiers"]', [
      resolve(HERE, "fixtures/RC.txt"),
      resolve(HERE, "fixtures/CCTP.docx"),
      resolve(HERE, "fixtures/BPU_formation.csv"),
    ]);
    await page.getByRole("button", { name: /Importer et classer/ }).click();
    await page.waitForSelector("text=/pièce\\(s\\) importée\\(s\\)/", { timeout: 60_000 });
    check("pièces importées", true);

    await page.goto(`${tenderUrl}?onglet=dce`);
    const rcRow = await page.locator("tr", { hasText: "RC.txt" }).count();
    const cctpRow = await page.locator("tr", { hasText: "CCTP.docx" }).count();
    check("RC.txt présent dans la liste des pièces", rcRow > 0);
    check("CCTP.docx présent dans la liste des pièces", cctpRow > 0);

    // --- Analyse ---------------------------------------------------------
    await page.goto(`${tenderUrl}?onglet=analyse`);
    const analyseButton = page.getByRole("button", { name: /Lancer l'analyse|Relancer l'analyse/ }).first();
    await analyseButton.click();
    await page.waitForSelector("text=/exigence\\(s\\) détectée\\(s\\)|pièce\\(s\\) analysée\\(s\\)/", { timeout: 90_000 });
    check("analyse exécutée", true);

    await page.goto(`${tenderUrl}?onglet=analyse`);
    const body = await page.locator("body").innerText();
    check("objet du marché extrait", /montée en compétences|montee en competences/i.test(body));
    check("critère « valeur technique » relevé", /valeur technique/i.test(body));
    check("pondération 60 % relevée", /60\s?%/.test(body));
    check("certification Qualiopi relevée", /qualiopi/i.test(body));
    check("exigences obligatoires détectées", /Exigence obligatoire/i.test(body));
    check("limites de l'analyse affichées", /valeur juridique/i.test(body));

    // --- Matching --------------------------------------------------------
    console.log("\nMatching");
    await page.goto(`${tenderUrl}?onglet=matching`);
    const recompute = page.getByRole("button", { name: /Recalculer|Lancer le matching/ }).first();
    if (await recompute.count()) {
      await recompute.click();
      await page.waitForTimeout(4000);
    }
    await page.goto(`${tenderUrl}?onglet=matching`);
    const matchBody = await page.locator("body").innerText();
    check("score global affiché", /Score global/i.test(matchBody));
    check("priorité 1 — catalogue ESME", /catalogue ESME/i.test(matchBody));
    check("priorité 2 — formations voisines", /formations voisines/i.test(matchBody));
    check("priorité 3 — Groupe IONIS", /Groupe IONIS/i.test(matchBody));
    check(
      "avertissement sur la portée des scores",
      /pas la probabilité de remporter|probabilité de remporter/i.test(matchBody),
    );

    // --- Décision GO ------------------------------------------------------
    console.log("\nDécision Go / No Go");
    await page.goto(`${tenderUrl}?onglet=decision`);
    await page.selectOption('select[name="status"]', "GO");
    await page.fill('textarea[name="rationale"]', "Test automatisé : adéquation suffisante avec le catalogue.");
    await page.getByRole("button", { name: /Enregistrer la décision/ }).click();
    await page.waitForSelector("text=/GO enregistré/", { timeout: 60_000 });
    check("décision GO enregistrée et espace de réponse créé", true);

    // --- Espace de réponse -------------------------------------------------
    console.log("\nEspace de réponse");
    await page.goto(`${tenderUrl}?onglet=reponse`);
    const reponseBody = await page.locator("body").innerText();
    check("mémoire technique généré", /Mémoire technique/i.test(reponseBody));
    check("checklist du dossier présente", /Checklist du dossier/i.test(reponseBody));
    check("planning de préparation présent", /Planning de préparation/i.test(reponseBody));
    check("informations à compléter signalées", /à compléter|à fournir/i.test(reponseBody));
    check("offre financière reprise du BPU", /Offre financière/i.test(reponseBody));

    // --- Éditeur de document ------------------------------------------------
    console.log("\nÉditeur de document");
    await page.locator('a[href*="/documents/"]').first().click();
    await page.waitForURL(/\/documents\//);
    const editorBody = await page.locator("body").innerText();
    check("éditeur ouvert", /section\(s\)/i.test(editorBody));
    const textareas = await page.locator("textarea").count();
    check("sections éditables", textareas > 0, `zones de texte : ${textareas}`);

    const docUrl = page.url();
    const docId = docUrl.split("/documents/")[1].split("?")[0];
    const exportResponse = await page.request.get(
      `${BASE}/api/documents/reponse/${docId}/export?format=docx`,
    );
    check("export Word disponible", exportResponse.ok(), `HTTP ${exportResponse.status()}`);
    const exportBuffer = await exportResponse.body();
    // Un .docx est une archive ZIP : elle commence par « PK ».
    check("export Word valide", exportBuffer[0] === 0x50 && exportBuffer[1] === 0x4b);

    const markdownResponse = await page.request.get(
      `${BASE}/api/documents/reponse/${docId}/export?format=md`,
    );
    const markdown = await markdownResponse.text();
    check("export Markdown lisible", markdown.includes("#"));
    check(
      "les lacunes ne disparaissent pas à l'export",
      markdown.includes("[À COMPLÉTER]") || markdown.includes("À compléter"),
    );

    // --- Contrôle qualité ---------------------------------------------------
    console.log("\nContrôle du dossier");
    await page.goto(`${tenderUrl}?onglet=controle`);
    await page.getByRole("button", { name: /Analyser le dossier|Relancer/ }).first().click();
    await page.waitForSelector("text=/complétude|Complétude/", { timeout: 90_000 });
    await page.goto(`${tenderUrl}?onglet=controle`);
    const controlBody = await page.locator("body").innerText();
    check("score de complétude affiché", /Complétude/i.test(controlBody));
    check("score de qualité affiché", /Qualité/i.test(controlBody));
    check("score de conformité affiché", /Conformité/i.test(controlBody));
    check("alertes bloquantes identifiées", /bloquante/i.test(controlBody));
    check("corrections proposées", /Corrections proposées/i.test(controlBody));
    check("portée des notes rappelée", /valeur juridique/i.test(controlBody));

    // --- Garde-fou sur le dépôt ---------------------------------------------
    console.log("\nGarde-fou du dépôt");
    await page.goto(`${tenderUrl}?onglet=suivi`);
    await page.fill('input[name="platform"]', "PLACE");
    await page.fill('input[name="submittedAt"]', "2026-12-01T10:00");
    await page.getByRole("button", { name: /Enregistrer le dépôt/ }).click();
    await page.waitForSelector("text=/Cochez la confirmation/", { timeout: 30_000 });
    check("dépôt refusé sans confirmation explicite", true);

    // --- Veille --------------------------------------------------------------
    console.log("\nVeille");
    await page.goto(`${BASE}/veille`);
    const veilleBody = await page.locator("body").innerText();
    check("connecteurs listés", /BOAMP/i.test(veilleBody));
    check("état des connecteurs affiché", /Opérationnel|Indisponible|À implémenter/i.test(veilleBody));
    check(
      "exigences d'activation affichées",
      /Pour l'activer|compte opérateur économique|clé d'API/i.test(veilleBody),
    );

    const runButton = page.getByRole("button", { name: /Lancer la veille maintenant/ }).first();
    if (await runButton.count()) {
      await runButton.click();
      await page.waitForSelector("text=/avis récupérés|injoignable|Erreur|non implémenté/", { timeout: 120_000 });
      const runResult = await page.locator("body").innerText();
      check(
        "la veille rend un résultat explicite (succès ou échec motivé)",
        /avis récupérés|injoignable|Erreur du connecteur|non implémenté/.test(runResult),
      );
      check(
        "aucune affaire fictive créée en cas d'échec",
        !/affaires créées/.test(runResult) || /0 affaires créées/.test(runResult) || /avis récupérés/.test(runResult),
      );
    }

    // --- Référentiel ----------------------------------------------------------
    console.log("\nRéférentiel");
    await page.goto(`${BASE}/catalogue`);
    const catalogueBody = await page.locator("body").innerText();
    check("catalogue ESME chargé", /formations du catalogue ESME/i.test(catalogueBody));
    check("source du référentiel citée", /ESME-EE_Catalogue_2027\.pdf/.test(catalogueBody));
    await page.locator("tbody tr td a").first().click();
    await page.waitForURL(/\/catalogue\//);
    const ficheBody = await page.locator("body").innerText();
    check("fiche formation détaillée", /Objectifs pédagogiques|Objectif général/i.test(ficheBody));

    // --- Journal d'audit -------------------------------------------------------
    console.log("\nJournal d'audit");
    await page.goto(`${BASE}/admin/journal`);
    const journalBody = await page.locator("body").innerText();
    check("journal alimenté", /événement\(s\) enregistré\(s\)/i.test(journalBody));
    check("actions tracées", /decision\.record|dce\.analyse|matching\.recompute/.test(journalBody));
  } catch (error) {
    failed += 1;
    console.log(`\n  ERREUR : ${error.message}`);
    await page.screenshot({ path: "/tmp/tendera-e2e-erreur.png" }).catch(() => {});
  } finally {
    await browser.close();
  }

  console.log(`\n${passed} vérification(s) réussie(s), ${failed} échec(s).`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
