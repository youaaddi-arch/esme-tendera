import assert from "node:assert/strict";
import { test } from "node:test";

import {
  lireDate, lireDecision, lireLignes, lireMontant, normaliserEntete, reconnaitreEntetes,
  trouverEntetes, type Cellule,
} from "../src/lib/veille/tableau";

test("un intitulé se réduit à sa substance", () => {
  assert.equal(normaliserEntete("N° Consultation"), "n consultation");
  assert.equal(normaliserEntete("  Date de remise des plis  "), "date de remise des plis");
  assert.equal(normaliserEntete(null), "");
});

test("la colonne la plus spécifique l'emporte sur la plus générale", () => {
  const { colonnes, intitules } = reconnaitreEntetes([
    "Date de publication", "Date de remise des plis", "Lien", "Lien DCE", "Objet du marché", "Client",
  ]);
  assert.equal(colonnes.publieAt, 0);
  assert.equal(colonnes.remiseAt, 1);
  assert.equal(colonnes.lien, 2);
  assert.equal(colonnes.lienDce, 3);
  assert.equal(colonnes.objet, 4);
  assert.equal(colonnes.acheteur, 5);
  assert.equal(intitules.acheteur, "Client");
});

test("une colonne n'est jamais attribuée deux fois", () => {
  const { colonnes } = reconnaitreEntetes(["Objet", "Acheteur"]);
  assert.equal(colonnes.objet, 0);
  assert.equal(colonnes.acheteur, 1);
  assert.notEqual(colonnes.resume, 0);
});

test("les colonnes non reconnues sont signalées, pas devinées", () => {
  const { colonnes, inconnues } = reconnaitreEntetes(["Objet", "Acheteur", "Chargé du dossier"]);
  assert.equal(Object.keys(colonnes).length, 2);
  assert.deepEqual(inconnues, ["Chargé du dossier"]);
});

test("l'en-tête est trouvé sous un titre et une ligne vide", () => {
  const matrice: Cellule[][] = [
    ["Veille appels d'offres — novembre 2026"],
    [],
    ["Objet du marché", "Acheteur", "Date de remise des plis"],
    ["Formation cybersécurité", "RTE", "12/03/2026"],
  ];
  const trouve = trouverEntetes(matrice);
  assert.ok(trouve);
  assert.equal(trouve.index, 2);
  assert.equal(Object.keys(trouve.entetes.colonnes).length, 3);
});

test("un tableau sans en-tête reconnaissable n'est pas interprété", () => {
  assert.equal(trouverEntetes([["a", "b"], ["c", "d"]]), null);
});

test("les dates se lisent à la française", () => {
  assert.equal(lireDate("12/03/2026")?.toISOString().slice(0, 10), "2026-03-12");
  assert.equal(lireDate("3/12/26")?.toISOString().slice(0, 10), "2026-12-03");
  assert.equal(lireDate("2026-03-12")?.toISOString().slice(0, 10), "2026-03-12");
  assert.equal(lireDate("12 mars 2026")?.toISOString().slice(0, 10), "2026-03-12");
  assert.equal(lireDate("1er décembre 2026")?.toISOString().slice(0, 10), "2026-12-01");
  assert.equal(lireDate("12/03/2026 17h00")?.toISOString().slice(0, 16), "2026-03-12T17:00");
});

test("ce qui n'est pas une date n'en devient pas une", () => {
  assert.equal(lireDate("2026"), null);
  assert.equal(lireDate("31/02/2026"), null);
  assert.equal(lireDate("à confirmer"), null);
  assert.equal(lireDate(""), null);
  assert.equal(lireDate(null), null);
});

test("un numéro de série Excel se lit, une année seule ne se lit pas", () => {
  // 45000 = 2023-03-15 dans le calendrier d'Excel.
  assert.equal(lireDate(45_000)?.toISOString().slice(0, 10), "2023-03-15");
  assert.equal(lireDate(2026), null);
});

test("les montants se lisent avec leurs séparateurs français", () => {
  assert.equal(lireMontant("1 200 000 € HT")?.valeur, 1_200_000);
  assert.equal(lireMontant("1.200.000")?.valeur, 1_200_000);
  assert.equal(lireMontant("1 200,50 €")?.valeur, 1_200.5);
  assert.equal(lireMontant("150000")?.valeur, 150_000);
  assert.equal(lireMontant(80_000)?.valeur, 80_000);
});

test("les abréviations d'échelle sont lues et la lecture est rendue", () => {
  const k = lireMontant("80 k€");
  assert.equal(k?.valeur, 80_000);
  assert.ok(k?.interpretation?.includes("80"));
  assert.equal(lireMontant("1,2 M€")?.valeur, 1_200_000);
});

test("une fourchette n'est pas un montant", () => {
  assert.equal(lireMontant("50 000 à 80 000 €"), null);
  assert.equal(lireMontant("non communiqué"), null);
  assert.equal(lireMontant("NC"), null);
  assert.equal(lireMontant("?"), null);
  assert.equal(lireMontant(""), null);
});

test("« no go » n'est pas lu comme « go »", () => {
  assert.equal(lireDecision("NO GO"), "NO_GO");
  assert.equal(lireDecision("no-go"), "NO_GO");
  assert.equal(lireDecision("GO"), "GO");
  assert.equal(lireDecision("Go ✅"), "GO");
  assert.equal(lireDecision("à arbitrer"), "A_DECIDER");
  assert.equal(lireDecision(""), null);
  assert.equal(lireDecision("déposé"), null);
});

test("une ligne rend ce qu'elle porte, et le numéro que le tableur affiche", () => {
  const matrice: Cellule[][] = [
    ["Objet", "Client", "Date de remise des plis", "Montant", "Lien", "Go / No Go", "CPV"],
    [
      "Formation cybersécurité", "RTE", "12/03/2026", "80 k€",
      "voir https://www.boamp.fr/avis/detail/26-94667, consulté le 2/11",
      "GO", "80530000 80500000",
    ],
    [],
  ];
  const trouve = trouverEntetes(matrice);
  assert.ok(trouve);
  const lignes = lireLignes(matrice, trouve.entetes, trouve.index);
  assert.equal(lignes.length, 2);

  const ligne = lignes[0];
  assert.equal(ligne.ligne, 2);
  assert.equal(ligne.objet, "Formation cybersécurité");
  assert.equal(ligne.acheteur, "RTE");
  assert.equal(ligne.remiseAt?.toISOString().slice(0, 10), "2026-03-12");
  assert.equal(ligne.montant?.valeur, 80_000);
  assert.equal(ligne.lien, "https://www.boamp.fr/avis/detail/26-94667");
  assert.equal(ligne.decision, "GO");
  assert.deepEqual(ligne.cpv, ["80530000", "80500000"]);
  assert.equal(ligne.vide, false);
  assert.equal(lignes[1].vide, true);
});
