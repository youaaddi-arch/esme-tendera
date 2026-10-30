import "server-only";

import type { Prisma, ResponseDocType } from "@prisma/client";

import { prisma } from "../db";
import { recordAudit } from "../audit";
import { notify } from "../notifications";
import { EXPECTED_RESPONSE_KINDS } from "../dce/classify";
import { buildMemoire, extractImposedOutline, type MemoireSection } from "./memoire";

/**
 * Création de l'espace de préparation d'une réponse.
 *
 * Déclenché par un GO. Produit, à partir du DCE analysé :
 *
 *   - la checklist des pièces attendues au dossier ;
 *   - le planning et les tâches, calés sur la date limite de dépôt ;
 *   - le plan et le premier jet du mémoire technique ;
 *   - les documents administratifs à compléter ;
 *   - la structure de l'offre financière, reprise du BPU ou du DQE ;
 *   - la liste des informations manquantes.
 *
 * L'opération est rejouable : elle complète l'existant sans écraser le travail
 * déjà fait (une tâche déplacée reste déplacée, un mémoire édité n'est pas
 * remplacé mais versionné).
 */
export async function buildResponseWorkspace(
  tenderId: string,
  userId: string,
): Promise<{ checklist: number; tasks: number; sections: number; gaps: number; pricingLines: number }> {
  const tender = await prisma.tender.findUniqueOrThrow({
    where: { id: tenderId },
    include: {
      analysis: true,
      requirements: true,
      documents: { where: { scope: "DCE" }, select: { id: true, kind: true, fileName: true, extractedPages: true } },
      matchResult: {
        include: {
          matches: { orderBy: { score: "desc" }, take: 8, include: { training: true } },
        },
      },
    },
  });

  // --- Cadre de mémoire imposé -------------------------------------------
  const frameworkDoc = tender.documents.find((document) => document.kind === "CADRE_MEMOIRE");
  let imposedOutline: string[] | null = null;
  if (frameworkDoc) {
    const pages = (frameworkDoc.extractedPages ?? []) as { page: number; text: string }[];
    imposedOutline = extractImposedOutline(pages.map((page) => page.text).join("\n"));
  }

  const criteres = ((tender.analysis?.criteres ?? []) as { label: string; weight: number | null }[]) ?? [];

  const { sections, gaps, frameworkNote } = buildMemoire({
    tenderTitle: tender.title,
    buyer: tender.buyer,
    objet: tender.analysis?.objet ?? tender.objectSummary ?? null,
    besoin: tender.analysis?.besoin ?? null,
    publics: tender.analysis?.publics ?? [],
    stagiaires: tender.analysis?.stagiaires ?? null,
    sessions: tender.analysis?.sessions ?? null,
    volumeHoraire: tender.analysis?.volumeHoraire ?? null,
    modalites: tender.analysis?.modalites ?? [],
    lieux: tender.analysis?.lieux ?? [],
    certifications: tender.analysis?.certifications ?? [],
    criteres,
    imposedOutline,
    trainings: (tender.matchResult?.matches ?? []).map((match) => match.training),
    institution: "ESME Executive Education",
  });

  const allGaps = [...gaps];
  if (!tender.analysis?.basedOnDocuments) {
    allGaps.unshift(
      "Aucune pièce du DCE n'a été analysée : le mémoire est construit sur le seul avis. Importez le dossier et relancez l'analyse.",
    );
  }

  // --- Mémoire technique --------------------------------------------------
  const existingMemoire = await prisma.responseDocument.findFirst({
    where: { tenderId, type: "MEMOIRE_TECHNIQUE" },
  });

  if (existingMemoire) {
    // Le mémoire existe déjà : on archive la version courante avant de
    // proposer la nouvelle trame, pour ne rien perdre du travail du rédacteur.
    await prisma.documentVersion.create({
      data: {
        documentId: existingMemoire.id,
        version: existingMemoire.version,
        content: existingMemoire.content as Prisma.InputJsonValue,
        label: "Version avant régénération du plan",
        authorId: userId,
      },
    });
    await prisma.responseDocument.update({
      where: { id: existingMemoire.id },
      data: {
        content: { frameworkNote, sections } as unknown as Prisma.InputJsonValue,
        gaps: allGaps,
        version: existingMemoire.version + 1,
        imposedFrameworkDocId: frameworkDoc?.id ?? null,
      },
    });
  } else {
    await prisma.responseDocument.create({
      data: {
        tenderId,
        type: "MEMOIRE_TECHNIQUE",
        title: `Mémoire technique — ${tender.reference}`,
        status: "BROUILLON",
        content: { frameworkNote, sections } as unknown as Prisma.InputJsonValue,
        gaps: allGaps,
        imposedFrameworkDocId: frameworkDoc?.id ?? null,
      },
    });
  }

  // --- Documents administratifs à compléter -------------------------------
  const adminDocs: { type: ResponseDocType; title: string }[] = [
    { type: "DC1", title: "DC1 — Lettre de candidature" },
    { type: "DC2", title: "DC2 — Déclaration du candidat" },
    { type: "ACTE_ENGAGEMENT", title: "Acte d'engagement" },
  ];
  // Le DC4 n'est utile qu'en cas de sous-traitance ou de coopération IONIS.
  const needsDc4 =
    tender.documents.some((document) => document.kind === "DC4") ||
    (tender.matchResult?.matches ?? []).some((match) => match.training.origin === "IONIS" && match.score >= 50);
  if (needsDc4) {
    adminDocs.push({ type: "DC4", title: "DC4 — Déclaration de sous-traitance" });
  }

  for (const document of adminDocs) {
    const exists = await prisma.responseDocument.findFirst({ where: { tenderId, type: document.type } });
    if (exists) continue;
    await prisma.responseDocument.create({
      data: {
        tenderId,
        type: document.type,
        title: document.title,
        status: "BROUILLON",
        content: {
          note:
            "Formulaire à compléter. TENDERA prérenseigne l'identification de l'établissement ; les engagements, montants et signatures restent à la charge d'un responsable habilité.",
          fields: adminFields(document.type, tender.buyer, tender.reference),
        } as unknown as Prisma.InputJsonValue,
        gaps: [
          "Aucune signature n'est apposée automatiquement : le document doit être signé par une personne habilitée.",
        ],
      },
    });
  }

  // --- Offre financière ----------------------------------------------------
  const pricingLines = await buildPricingSkeleton(tenderId, tender.documents);

  const financeDoc = await prisma.responseDocument.findFirst({ where: { tenderId, type: "OFFRE_FINANCIERE" } });
  if (!financeDoc) {
    await prisma.responseDocument.create({
      data: {
        tenderId,
        type: "OFFRE_FINANCIERE",
        title: `Offre financière — ${tender.reference}`,
        status: "BROUILLON",
        content: {
          note:
            "Structure reprise des pièces de prix du DCE quand elles sont lisibles. Aucun tarif n'est pré-rempli : le catalogue ESME ne publie pas de prix, et TENDERA n'en invente aucun.",
        } as unknown as Prisma.InputJsonValue,
        gaps: [
          "Tarifs à renseigner : coûts pédagogiques, coûts formateurs, frais annexes, puis marge et prix proposé.",
        ],
      },
    });
  }

  // --- Checklist documentaire ---------------------------------------------
  let checklistCount = 0;
  const existingChecklist = await prisma.checklistItem.findMany({
    where: { tenderId },
    select: { label: true },
  });
  const known = new Set(existingChecklist.map((item) => item.label.toLowerCase()));

  const checklistEntries: { label: string; category: string; mandatory: boolean; detail?: string }[] = [
    ...EXPECTED_RESPONSE_KINDS.map((entry) => ({
      label: entry.label,
      category: entry.kind === "CADRE_MEMOIRE" ? "technique" : entry.kind === "BPU" ? "financier" : "administratif",
      mandatory: entry.mandatory,
    })),
  ];

  // Les exigences obligatoires du RC qui désignent une pièce deviennent des
  // lignes de checklist : ce sont elles qui font rejeter une offre.
  for (const requirement of tender.requirements.filter((item) => item.level === "OBLIGATOIRE")) {
    checklistEntries.push({
      label: requirement.label.slice(0, 160),
      category: requirement.category ?? "administratif",
      mandatory: true,
      detail: "Exigence relevée dans le DCE.",
    });
  }

  for (const [index, entry] of checklistEntries.entries()) {
    if (known.has(entry.label.toLowerCase())) continue;
    await prisma.checklistItem.create({
      data: {
        tenderId,
        label: entry.label,
        detail: entry.detail ?? null,
        category: entry.category,
        mandatory: entry.mandatory,
        status: "MANQUANT",
        position: index,
      },
    });
    checklistCount += 1;
  }

  // --- Tâches et planning ---------------------------------------------------
  const taskCount = await buildTaskPlan(tenderId, tender.deadlineAt);

  await recordAudit({
    action: "reponse.workspace",
    entity: "Tender",
    entityId: tenderId,
    tenderId,
    userId,
    summary: `Espace de réponse généré : ${sections.length} sections de mémoire, ${checklistCount} pièce(s) au dossier, ${taskCount} tâche(s).`,
    payload: { cadreImpose: Boolean(imposedOutline), lacunes: allGaps.length },
  });

  if (allGaps.length > 0) {
    await notify({
      kind: "DOCUMENT_MANQUANT",
      title: `${allGaps.length} information(s) à compléter — ${tender.reference}`,
      body: allGaps.slice(0, 3).join(" · "),
      tenderId,
    });
  }

  return {
    checklist: checklistCount,
    tasks: taskCount,
    sections: sections.length,
    gaps: allGaps.length,
    pricingLines,
  };
}

function adminFields(type: string, buyer: string, reference: string): Record<string, string> {
  const base = {
    "Identification du candidat": "ESME — 38 rue Molière, 94200 Ivry-sur-Seine",
    "SIRET": "[À COMPLÉTER depuis la base de connaissances]",
    "Numéro de déclaration d'activité": "[À COMPLÉTER]",
    "Acheteur": buyer,
    "Référence de la consultation": reference,
  };
  if (type === "ACTE_ENGAGEMENT") {
    return {
      ...base,
      "Montant de l'offre": "[À COMPLÉTER après validation de l'offre financière]",
      "Délai d'exécution": "[À COMPLÉTER d'après le CCAP]",
      "Signature": "[Non apposée — signature manuelle par une personne habilitée]",
    };
  }
  if (type === "DC4") {
    return {
      ...base,
      "Sous-traitant / co-traitant": "[À COMPLÉTER — accord formel requis avant toute mention]",
      "Nature des prestations sous-traitées": "[À COMPLÉTER]",
      "Montant des prestations sous-traitées": "[À COMPLÉTER]",
    };
  }
  return base;
}

/**
 * Structure de l'offre financière.
 *
 * Lue depuis le BPU, le DQE ou la DPGF quand ils sont au format classeur : les
 * libellés de ligne et les unités sont repris tels quels, les prix restent
 * vides. Un bordereau d'acheteur dicte la forme de la réponse ; la reprendre
 * exactement évite une offre jugée non conforme.
 */
async function buildPricingSkeleton(
  tenderId: string,
  documents: { id: string; kind: string; fileName: string; extractedPages: unknown }[],
): Promise<number> {
  const existing = await prisma.pricingLine.count({ where: { tenderId } });
  if (existing > 0) return existing;

  const priceDoc = documents.find((document) => ["BPU", "DQE", "DPGF"].includes(document.kind));
  if (!priceDoc) return 0;

  const pages = (priceDoc.extractedPages ?? []) as { page: number; text: string }[];
  const lines: { label: string; unit: string | null; quantity: number | null }[] = [];

  for (const page of pages) {
    for (const row of page.text.split("\n")) {
      const cells = row.split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""));
      const label = cells.find((cell) => cell.length > 6 && /[a-zà-ÿ]{4}/i.test(cell));
      if (!label) continue;
      // Les en-têtes de colonnes ne sont pas des lignes de prix.
      if (/^(d[ée]signation|libell[ée]|intitul[ée]|unit[ée]|quantit[ée]|prix|total)$/i.test(label)) continue;
      if (lines.some((line) => line.label === label)) continue;

      const unit = cells.find((cell) => /^(jour|j|heure|h|session|forfait|unit[ée]|participant|groupe)s?$/i.test(cell));
      const quantityCell = cells.find((cell) => /^\d+([.,]\d+)?$/.test(cell));
      lines.push({
        label: label.slice(0, 200),
        unit: unit ?? null,
        quantity: quantityCell ? Number.parseFloat(quantityCell.replace(",", ".")) : null,
      });
      if (lines.length >= 80) break;
    }
    if (lines.length >= 80) break;
  }

  if (lines.length === 0) return 0;

  await prisma.pricingLine.createMany({
    data: lines.map((line, index) => ({
      tenderId,
      label: line.label,
      unit: line.unit,
      quantity: line.quantity,
      priceOrigin: "bpu_acheteur",
      note: `Ligne reprise de ${priceDoc.fileName}. Prix à renseigner.`,
      position: index,
    })),
  });

  return lines.length;
}

/**
 * Planning de préparation.
 *
 * Les jalons sont calés à rebours de la date limite de dépôt : c'est elle qui
 * commande, pas la date de création de l'affaire. Sans date limite connue, les
 * tâches sont créées sans échéance plutôt qu'avec une date inventée.
 */
async function buildTaskPlan(tenderId: string, deadline: Date | null): Promise<number> {
  const existing = await prisma.task.count({ where: { tenderId } });
  if (existing > 0) return 0;

  const plan: { title: string; detail: string; daysBefore: number }[] = [
    { title: "Relire le RC et confirmer les pièces exigées", detail: "Vérifier la checklist documentaire contre le règlement de consultation.", daysBefore: 21 },
    { title: "Valider le plan du mémoire technique", detail: "Confirmer le respect du cadre imposé, ou l'alignement sur les critères d'attribution.", daysBefore: 18 },
    { title: "Réunir les pièces administratives", detail: "DC1, DC2, attestations fiscales et sociales, Qualiopi, assurance.", daysBefore: 15 },
    { title: "Rédiger la compréhension du besoin et l'ingénierie", detail: "Sections les plus notées : à traiter en premier.", daysBefore: 12 },
    { title: "Sélectionner les références et les CV formateurs", detail: "Depuis la base de connaissances. Aucune référence inventée.", daysBefore: 10 },
    { title: "Chiffrer l'offre financière", detail: "Compléter le bordereau de l'acheteur, vérifier les totaux et la marge.", daysBefore: 8 },
    { title: "Relecture croisée du mémoire", detail: "Relecteur distinct du rédacteur.", daysBefore: 5 },
    { title: "Lancer le contrôle de complétude et de qualité", detail: "Depuis l'onglet Contrôle de la fiche.", daysBefore: 4 },
    { title: "Corriger les points bloquants", detail: "Traiter en priorité les alertes de conformité.", daysBefore: 3 },
    { title: "Validation finale par le responsable appels d'offres", detail: "Vérification des pièces, des prix et des dates.", daysBefore: 2 },
    { title: "Déposer le pli et récupérer l'accusé de réception", detail: "Le dépôt est manuel sur la plateforme de l'acheteur.", daysBefore: 1 },
  ];

  await prisma.task.createMany({
    data: plan.map((task, index) => ({
      tenderId,
      title: task.title,
      detail: task.detail,
      status: "A_FAIRE" as const,
      position: index,
      dueAt: deadline ? new Date(deadline.getTime() - task.daysBefore * 86_400_000) : null,
    })),
  });

  return plan.length;
}

export type { MemoireSection };
