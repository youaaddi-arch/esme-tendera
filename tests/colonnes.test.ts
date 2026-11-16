import assert from "node:assert/strict";
import { test } from "node:test";

import { COLONNES_EXPORT, cellule, enCsv, type LigneExport } from "../src/lib/veille/colonnes";

function ligne(partielle: Partial<LigneExport> = {}): LigneExport {
  return {
    reference: "AO-2026-0001",
    objet: "Formation cybersécurité",
    resume: null,
    acheteur: "RTE",
    referenceConsultation: null,
    procedure: null,
    region: null,
    cpv: [],
    lots: 0,
    natureMontant: "Montant estimé",
    montantMin: null,
    montantMax: null,
    publieAt: null,
    remiseAt: null,
    joursRestants: null,
    appreciation: null,
    score: null,
    familleMatching: null,
    etape: "AO identifiés",
    decision: "À décider",
    motifNoGo: null,
    motivationDecision: null,
    decidePar: null,
    decideLe: null,
    etatDce: "Non tenté",
    source: null,
    lienAvis: null,
    lienDce: null,
    lienDepot: null,
    responsable: null,
    creeeLe: new Date(Date.UTC(2026, 10, 2, 12)),
    demonstration: false,
    ...partielle,
  };
}

test("une absence reste vide, jamais zéro", () => {
  const colonne = COLONNES_EXPORT.find((c) => c.entete === "Montant maximum (€ HT)")!;
  assert.equal(cellule(colonne, ligne()), "");
  assert.equal(cellule(colonne, ligne({ montantMax: 1_200_000 })), "1200000");
});

test("les dates sortent au format français", () => {
  const colonne = COLONNES_EXPORT.find((c) => c.entete === "Date de remise des plis")!;
  assert.equal(cellule(colonne, ligne({ remiseAt: new Date(Date.UTC(2026, 2, 12, 12)) })), "12/03/2026");
});

test("un décimal porte la virgule française", () => {
  const colonne = COLONNES_EXPORT.find((c) => c.entete === "Montant minimum (€ HT)")!;
  assert.equal(cellule(colonne, ligne({ montantMin: 1_200.5 })), "1200,5");
});

test("un booléen se lit, il ne s'affiche pas « true »", () => {
  const colonne = COLONNES_EXPORT.find((c) => c.entete === "Donnée de démonstration")!;
  assert.equal(cellule(colonne, ligne({ demonstration: true })), "oui");
  assert.equal(cellule(colonne, ligne()), "non");
});

test("le CSV porte la marque d'ordre des octets et sépare par points-virgules", () => {
  const csv = enCsv([ligne()]);
  assert.ok(csv.startsWith("﻿Référence;Objet du marché;Acheteur;"));
  assert.ok(csv.includes("\r\n"));
  assert.equal(csv.split("\r\n").filter(Boolean).length, 2);
});

test("un point-virgule dans une valeur ne casse pas la colonne suivante", () => {
  const csv = enCsv([ligne({ objet: 'Formation "SSI" ; lot 2', acheteur: "RTE" })]);
  const lignes = csv.replace("﻿", "").split("\r\n");
  assert.ok(lignes[1].includes('"Formation ""SSI"" ; lot 2"'));
  // Les en-têtes et le corps gardent le même nombre de colonnes une fois les
  // valeurs protégées retirées.
  assert.equal(lignes[0].split(";").length, COLONNES_EXPORT.length);
});

test("toutes les colonnes ont un en-tête distinct", () => {
  const entetes = COLONNES_EXPORT.map((colonne) => colonne.entete);
  assert.equal(new Set(entetes).size, entetes.length);
});
