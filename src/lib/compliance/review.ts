import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { recordAudit } from "../audit";
import { notify } from "../notifications";

/**
 * Contrôle d'un dossier de réponse.
 *
 * Trois notes distinctes, qui ne disent pas la même chose :
 *
 *   - **complétude** : le dossier contient-il tout ce qui est demandé ?
 *   - **qualité**    : ce qui est écrit répond-il vraiment aux critères ?
 *   - **conformité** : reste-t-il une exigence impérative non satisfaite ?
 *
 * La conformité est tenue à part parce qu'elle ne se moyenne pas. Un dossier
 * complet à 95 % et excellent sur le fond est rejeté s'il manque une pièce
 * éliminatoire. Les manquements de cette nature remontent en alertes
 * bloquantes, visibles quel que soit le niveau des deux autres notes.
 *
 * Ces notes sont une aide à la décision. Elles n'ont aucune valeur juridique
 * et ne garantissent ni la recevabilité ni la réussite de l'offre.
 */

export type Blocker = {
  severite: "bloquant" | "majeur";
  sujet: string;
  detail: string;
  documentCible: string | null;
};

export type Correction = {
  probleme: string;
  risque: string;
  correction: string;
  documentCible: string | null;
  applique: boolean;
};

export type ReviewBreakdown = { rubrique: string; note: number; commentaire: string };

export async function runQualityReview(tenderId: string, userId: string) {
  const tender = await prisma.tender.findUniqueOrThrow({
    where: { id: tenderId },
    include: {
      analysis: true,
      requirements: true,
      checklistItems: true,
      responseDocs: true,
      documents: { where: { scope: "DCE" }, select: { kind: true } },
    },
  });

  const blockers: Blocker[] = [];
  const corrections: Correction[] = [];
  const breakdown: ReviewBreakdown[] = [];

  // =========================================================================
  // 1. Complétude — le dossier est-il complet ?
  // =========================================================================
  const checklist = tender.checklistItems;
  const mandatory = checklist.filter((item) => item.mandatory);
  const satisfied = (status: string) => status === "CONFORME" || status === "NON_APPLICABLE";

  const mandatoryDone = mandatory.filter((item) => satisfied(item.status)).length;
  const optionalDone = checklist.filter((item) => !item.mandatory && satisfied(item.status)).length;
  const optionalTotal = checklist.length - mandatory.length;

  // Les pièces obligatoires pèsent 80 % de la note : c'est d'elles que dépend
  // la recevabilité du pli.
  const completeness =
    checklist.length === 0
      ? 0
      : Math.round(
          (mandatory.length > 0 ? (mandatoryDone / mandatory.length) * 80 : 80) +
            (optionalTotal > 0 ? (optionalDone / optionalTotal) * 20 : 20),
        );

  breakdown.push({
    rubrique: "Pièces obligatoires",
    note: mandatory.length > 0 ? Math.round((mandatoryDone / mandatory.length) * 100) : 0,
    commentaire: `${mandatoryDone} sur ${mandatory.length} pièce(s) obligatoire(s) au statut conforme.`,
  });

  for (const item of mandatory) {
    if (item.status === "MANQUANT") {
      blockers.push({
        severite: "bloquant",
        sujet: `Pièce obligatoire manquante : ${item.label}`,
        detail:
          "Une pièce obligatoire absente peut entraîner l'irrégularité de l'offre, quel que soit le niveau du reste du dossier.",
        documentCible: item.label,
      });
      corrections.push({
        probleme: `${item.label} est absent du dossier.`,
        risque: "Offre potentiellement irrégulière, donc écartée sans être notée.",
        correction: "Produire la pièce et la rattacher au dossier, puis repasser son statut à « conforme ».",
        documentCible: item.label,
        applique: false,
      });
    } else if (item.status === "NON_CONFORME") {
      blockers.push({
        severite: "bloquant",
        sujet: `Pièce non conforme : ${item.label}`,
        detail: item.note ?? "Pièce présente mais marquée non conforme par un relecteur.",
        documentCible: item.label,
      });
    } else if (item.status === "A_VERIFIER") {
      corrections.push({
        probleme: `${item.label} n'a pas été vérifié.`,
        risque: "Un défaut non détecté avant le dépôt ne peut plus être corrigé.",
        correction: "Faire vérifier la pièce par un relecteur et arrêter son statut.",
        documentCible: item.label,
        applique: false,
      });
    }
  }

  // =========================================================================
  // 2. Conformité — les exigences impératives sont-elles satisfaites ?
  // =========================================================================
  const mandatoryReqs = tender.requirements.filter((requirement) => requirement.level === "OBLIGATOIRE");
  const conformes = mandatoryReqs.filter((requirement) => satisfied(requirement.status)).length;
  const nonConformes = mandatoryReqs.filter((requirement) => requirement.status === "NON_CONFORME");
  const manquantes = mandatoryReqs.filter((requirement) => requirement.status === "MANQUANT");
  const aVerifier = mandatoryReqs.filter((requirement) => requirement.status === "A_VERIFIER");

  let compliance = mandatoryReqs.length === 0 ? 0 : Math.round((conformes / mandatoryReqs.length) * 100);
  // Une seule non-conformité avérée plafonne la note : la moyenne mentirait.
  if (nonConformes.length > 0 || manquantes.length > 0) compliance = Math.min(compliance, 40);

  for (const requirement of [...nonConformes, ...manquantes]) {
    blockers.push({
      severite: "bloquant",
      sujet: `Exigence impérative non satisfaite : ${requirement.label.slice(0, 120)}`,
      detail:
        requirement.sourceQuote ??
        "Exigence relevée dans le DCE comme obligatoire. Son non-respect est potentiellement éliminatoire.",
      documentCible: null,
    });
    corrections.push({
      probleme: requirement.label.slice(0, 160),
      risque: "Non-respect d'une exigence impérative : risque d'irrégularité de l'offre.",
      correction: "Traiter l'exigence dans le mémoire ou la pièce concernée, puis repasser son statut à « conforme ».",
      documentCible: null,
      applique: false,
    });
  }

  breakdown.push({
    rubrique: "Exigences impératives",
    note: compliance,
    commentaire:
      mandatoryReqs.length === 0
        ? "Aucune exigence obligatoire n'a été détectée : lancez l'analyse du DCE."
        : `${conformes} conforme(s), ${nonConformes.length} non conforme(s), ${manquantes.length} manquante(s), ${aVerifier.length} à vérifier.`,
  });

  if (mandatoryReqs.length === 0) {
    corrections.push({
      probleme: "Aucune exigence impérative n'est enregistrée pour cette affaire.",
      risque: "Le contrôle de conformité ne porte alors sur rien : il ne prouve pas que le dossier est conforme.",
      correction: "Importer le DCE et lancer l'analyse, ou saisir les exigences à la main dans l'onglet Analyse.",
      documentCible: null,
      applique: false,
    });
  }

  // =========================================================================
  // 3. Qualité — le fond répond-il aux critères ?
  // =========================================================================
  const memoire = tender.responseDocs.find((document) => document.type === "MEMOIRE_TECHNIQUE");
  const qualityParts: { rubrique: string; note: number; commentaire: string }[] = [];

  if (!memoire) {
    qualityParts.push({
      rubrique: "Mémoire technique",
      note: 0,
      commentaire: "Aucun mémoire technique n'a été créé pour cette affaire.",
    });
    blockers.push({
      severite: "bloquant",
      sujet: "Mémoire technique absent",
      detail: "Le mémoire technique porte l'essentiel de la note technique.",
      documentCible: "Mémoire technique",
    });
  } else {
    const content = (memoire.content ?? {}) as { sections?: { heading: string; body: string; weight: number | null }[] };
    const sections = content.sections ?? [];

    // Taux de rédaction : part des sections sans marqueur « à compléter ».
    const written = sections.filter(
      (section) => section.body.length > 150 && !section.body.includes("[À COMPLÉTER]"),
    ).length;
    const redaction = sections.length === 0 ? 0 : Math.round((written / sections.length) * 100);

    qualityParts.push({
      rubrique: "Avancement de la rédaction",
      note: redaction,
      commentaire: `${written} section(s) rédigée(s) sur ${sections.length}. Les autres portent encore des marqueurs « à compléter ».`,
    });

    // Couverture des critères notés : une section par critère, pondérée.
    const criteres = ((tender.analysis?.criteres ?? []) as { label: string; weight: number | null }[]) ?? [];
    if (criteres.length > 0) {
      let weighted = 0;
      let totalWeight = 0;
      for (const critere of criteres) {
        const weight = critere.weight ?? Math.round(100 / criteres.length);
        totalWeight += weight;
        const section = sections.find(
          (item) =>
            item.heading.toLowerCase().includes(critere.label.toLowerCase().slice(0, 14)) ||
            critere.label.toLowerCase().includes(item.heading.toLowerCase().slice(0, 14)),
        );
        if (!section) {
          corrections.push({
            probleme: `Aucune section du mémoire ne traite le critère « ${critere.label} » (${weight} %).`,
            risque: "Un critère noté non traité est noté zéro sur ce critère.",
            correction: "Ajouter une section dédiée à ce critère dans le mémoire technique.",
            documentCible: "Mémoire technique",
            applique: false,
          });
          continue;
        }
        const complete = section.body.length > 150 && !section.body.includes("[À COMPLÉTER]");
        weighted += complete ? weight : weight * 0.35;
      }
      const coverage = totalWeight > 0 ? Math.round((weighted / totalWeight) * 100) : 0;
      qualityParts.push({
        rubrique: "Couverture des critères d'attribution",
        note: coverage,
        commentaire: `Couverture pondérée des ${criteres.length} critère(s) relevés au règlement de consultation.`,
      });
    } else {
      qualityParts.push({
        rubrique: "Couverture des critères d'attribution",
        note: 0,
        commentaire: "Critères d'attribution inconnus : la couverture ne peut pas être évaluée.",
      });
    }

    // Personnalisation : le mémoire parle-t-il de cet acheteur, ou en général ?
    const fullText = sections.map((section) => section.body).join(" ").toLowerCase();
    const buyerWords = tender.buyer
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 4);
    const mentions = buyerWords.filter((word) => fullText.includes(word)).length;
    const personnalisation = buyerWords.length === 0 ? 50 : Math.min(100, Math.round((mentions / buyerWords.length) * 100));
    qualityParts.push({
      rubrique: "Personnalisation",
      note: personnalisation,
      commentaire:
        personnalisation < 40
          ? "Le mémoire mentionne peu l'acheteur et son contexte : c'est le premier reproche fait aux offres standardisées."
          : "Le mémoire reprend le contexte propre à l'acheteur.",
    });
    if (personnalisation < 40) {
      corrections.push({
        probleme: "Le mémoire est peu personnalisé.",
        risque: "Une offre perçue comme générique est pénalisée sur la valeur technique.",
        correction: "Reprendre le vocabulaire, les publics et les contraintes propres à l'acheteur dans les sections de fond.",
        documentCible: "Mémoire technique",
        applique: false,
      });
    }

    // Informations manquantes signalées à la génération.
    if (memoire.gaps.length > 0) {
      qualityParts.push({
        rubrique: "Informations à fournir",
        note: Math.max(0, 100 - memoire.gaps.length * 12),
        commentaire: `${memoire.gaps.length} information(s) signalée(s) comme à compléter : références, CV, chiffres institutionnels.`,
      });
      for (const gap of memoire.gaps.slice(0, 6)) {
        corrections.push({
          probleme: gap,
          risque: "Une information laissée en l'état sera lue comme une lacune par l'acheteur.",
          correction: "Compléter depuis la base de connaissances, sans jamais inventer de donnée.",
          documentCible: "Mémoire technique",
          applique: false,
        });
      }
    }
  }

  // Offre financière
  const pricingLines = await prisma.pricingLine.findMany({ where: { tenderId } });
  if (pricingLines.length > 0) {
    const priced = pricingLines.filter((line) => line.unitPrice !== null).length;
    const note = Math.round((priced / pricingLines.length) * 100);
    qualityParts.push({
      rubrique: "Offre financière",
      note,
      commentaire: `${priced} ligne(s) chiffrée(s) sur ${pricingLines.length}.`,
    });
    if (priced < pricingLines.length) {
      blockers.push({
        severite: priced === 0 ? "bloquant" : "majeur",
        sujet: `Offre financière incomplète : ${pricingLines.length - priced} ligne(s) sans prix`,
        detail: "Un bordereau incomplet rend l'offre inexploitable, voire irrégulière.",
        documentCible: "Offre financière",
      });
    }
  }

  const quality =
    qualityParts.length === 0
      ? 0
      : Math.round(qualityParts.reduce((sum, part) => sum + part.note, 0) / qualityParts.length);

  breakdown.push(...qualityParts);

  // --- Enregistrement -----------------------------------------------------
  const review = await prisma.qualityReview.create({
    data: {
      tenderId,
      engine: "deterministe",
      completeness,
      quality,
      compliance,
      blockers: blockers as unknown as Prisma.InputJsonValue,
      breakdown: breakdown as unknown as Prisma.InputJsonValue,
      corrections: corrections as unknown as Prisma.InputJsonValue,
      notes:
        "Contrôle automatique. Ces notes sont une aide à la décision : elles n'ont pas de valeur juridique et ne garantissent ni la recevabilité ni la réussite de l'offre.",
    },
  });

  if (blockers.some((blocker) => blocker.severite === "bloquant")) {
    await notify({
      kind: "DOCUMENT_MANQUANT",
      severity: "CRITIQUE",
      title: `${blockers.filter((item) => item.severite === "bloquant").length} alerte(s) bloquante(s) — ${tender.reference}`,
      body: blockers.find((blocker) => blocker.severite === "bloquant")?.sujet,
      tenderId,
    });
  }

  await recordAudit({
    action: "controle.qualite",
    entity: "Tender",
    entityId: tenderId,
    tenderId,
    userId,
    summary: `Contrôle : complétude ${completeness}, qualité ${quality}, conformité ${compliance}. ${blockers.length} alerte(s).`,
    payload: { completeness, quality, compliance, bloquants: blockers.length },
  });

  return review;
}
