import "server-only";

import type { DocumentScope, Prisma } from "@prisma/client";

import { prisma } from "../db";
import { recordAudit } from "../audit";
import { notify } from "../notifications";
import { saveFile, sha256, storagePathFor } from "../storage";
import { analyzeDce, type AnalyzedDocument } from "./analyze";
import { classifyDocument } from "./classify";
import { expandArchive, extractText, isArchive, joinPages } from "./extract";

/**
 * Import et analyse des pièces d'un dossier de consultation.
 *
 * Déroulé : un fichier déposé est stocké, son texte extrait, son type
 * identifié, et son contenu découpé en fragments indexés pour la recherche.
 * Une archive ZIP est dépliée et chaque pièce traitée séparément.
 *
 * L'analyse de synthèse n'est lancée qu'ensuite, sur l'ensemble des pièces
 * lisibles : une analyse ne porte jamais sur un dossier qu'on n'a pas lu.
 */

export type IngestedFile = { fileName: string; buffer: Buffer; mimeType?: string | null };

export type IngestReport = {
  stored: { fileName: string; kind: string; confidence: number; pages: number; status: string; error?: string }[];
  duplicates: string[];
  unreadable: { fileName: string; reason: string }[];
  total: number;
};

export async function ingestDocuments(
  tenderId: string,
  files: IngestedFile[],
  options: { userId: string; scope?: DocumentScope },
): Promise<IngestReport> {
  const scope = options.scope ?? "DCE";
  const report: IngestReport = { stored: [], duplicates: [], unreadable: [], total: 0 };

  // Les archives sont dépliées d'abord : on raisonne ensuite sur des pièces.
  const flattened: IngestedFile[] = [];
  for (const file of files) {
    if (isArchive(file.fileName)) {
      try {
        const entries = await expandArchive(file.buffer);
        for (const entry of entries) {
          flattened.push({ fileName: entry.fileName, buffer: entry.buffer });
        }
      } catch (error) {
        report.unreadable.push({
          fileName: file.fileName,
          reason: `Archive illisible : ${(error as Error).message}`,
        });
      }
    } else {
      flattened.push(file);
    }
  }

  report.total = flattened.length;

  for (const file of flattened) {
    const digest = sha256(file.buffer);

    const existing = await prisma.document.findFirst({
      where: { tenderId, sha256: digest },
      select: { id: true, fileName: true },
    });
    if (existing) {
      report.duplicates.push(file.fileName);
      continue;
    }

    const extraction = await extractText(file.fileName, file.buffer);
    const text = joinPages(extraction.pages);
    const classification = classifyDocument(file.fileName, text);

    const storagePath = storagePathFor(tenderId, digest, file.fileName);
    await saveFile(storagePath, file.buffer);

    const document = await prisma.document.create({
      data: {
        tenderId,
        scope,
        kind: classification.kind,
        kindConfidence: classification.confidence,
        fileName: file.fileName,
        mimeType: file.mimeType ?? null,
        sizeBytes: file.buffer.byteLength,
        storagePath,
        sha256: digest,
        fromArchive: files.find((candidate) => isArchive(candidate.fileName))?.fileName ?? null,
        extractedPages: extraction.pages as unknown as Prisma.InputJsonValue,
        pageCount: extraction.pageCount,
        extractionStatus: extraction.status,
        extractionError: extraction.error ?? null,
      },
    });

    if (extraction.status === "termine") {
      await indexChunks(document.id, extraction.pages);
    } else {
      report.unreadable.push({ fileName: file.fileName, reason: extraction.error ?? "Format non pris en charge." });
    }

    report.stored.push({
      fileName: file.fileName,
      kind: classification.kind,
      confidence: classification.confidence,
      pages: extraction.pageCount,
      status: extraction.status,
      error: extraction.error,
    });
  }

  if (report.stored.length > 0 && scope === "DCE") {
    await prisma.tender.update({
      where: { id: tenderId },
      data: { dceStatus: "IMPORTE_MANUELLEMENT", dceFailureReason: null },
    });
  }

  await recordAudit({
    action: "dce.import",
    entity: "Tender",
    entityId: tenderId,
    tenderId,
    userId: options.userId,
    summary: `${report.stored.length} pièce(s) importée(s), ${report.duplicates.length} doublon(s), ${report.unreadable.length} illisible(s).`,
    payload: report as unknown as Prisma.InputJsonValue,
  });

  return report;
}

/**
 * Découpe un document en fragments pour la recherche.
 *
 * Les fragments suivent les pages, et une page longue est coupée en blocs d'un
 * millier de caractères — assez pour garder le contexte d'un paragraphe, assez
 * court pour que la citation reste précise.
 */
async function indexChunks(documentId: string, pages: { page: number; text: string }[]): Promise<void> {
  const { tokenize } = await import("../matching/text");
  const chunks: Prisma.DocumentChunkCreateManyInput[] = [];
  let ordinal = 0;

  for (const page of pages) {
    if (!page.text.trim()) continue;
    const blocks = splitIntoBlocks(page.text, 1000);
    for (const block of blocks) {
      chunks.push({
        documentId,
        ordinal: ordinal++,
        page: page.page,
        content: block,
        tokens: [...new Set(tokenize(block))].slice(0, 120),
      });
    }
  }

  if (chunks.length > 0) {
    await prisma.documentChunk.createMany({ data: chunks });
  }
}

function splitIntoBlocks(text: string, size: number): string[] {
  const blocks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let current = "";
  for (const sentence of sentences) {
    if (current.length + sentence.length > size && current.length > 0) {
      blocks.push(current.trim());
      current = "";
    }
    current += `${sentence} `;
  }
  if (current.trim()) blocks.push(current.trim());
  return blocks.length > 0 ? blocks : [text.slice(0, size)];
}

/**
 * Lance l'analyse de synthèse d'une affaire sur ses pièces déjà importées.
 *
 * Remplace l'analyse précédente, et réécrit les exigences détectées en
 * conservant les statuts déjà saisis par les utilisateurs — un relecteur qui a
 * coché « conforme » ne perd pas son travail parce qu'une pièce a été ajoutée.
 */
export async function analyzeTenderDce(
  tenderId: string,
  options: { userId: string },
): Promise<{ analysed: number; requirements: number }> {
  const documents = await prisma.document.findMany({
    where: { tenderId, scope: "DCE" },
    select: { id: true, fileName: true, kind: true, extractedPages: true, extractionStatus: true },
  });

  const analysable: AnalyzedDocument[] = documents
    .filter((document) => document.extractionStatus === "termine")
    .map((document) => ({
      id: document.id,
      fileName: document.fileName,
      kind: document.kind,
      pages: (document.extractedPages ?? []) as { page: number; text: string }[],
    }));

  const outcome = analyzeDce(analysable);

  await prisma.tenderAnalysis.upsert({
    where: { tenderId },
    create: {
      tenderId,
      engine: outcome.engine,
      basedOnDocuments: outcome.basedOnDocuments,
      documentCount: outcome.documentCount,
      objet: outcome.objet, besoin: outcome.besoin, publics: outcome.publics,
      stagiaires: outcome.stagiaires, sessions: outcome.sessions,
      volumeHoraire: outcome.volumeHoraire, modalites: outcome.modalites,
      lieux: outcome.lieux, moyensHumains: outcome.moyensHumains,
      certifications: outcome.certifications, exigencesAdmin: outcome.exigencesAdmin,
      criteres: outcome.criteres as unknown as Prisma.InputJsonValue,
      contraintesFinancieres: outcome.contraintesFinancieres, delais: outcome.delais,
      risques: outcome.risques, penalites: outcome.penalites, obligations: outcome.obligations,
      contradictions: outcome.contradictions as unknown as Prisma.InputJsonValue,
      pointsAClarifier: outcome.pointsAClarifier, incertitudes: outcome.incertitudes,
    },
    update: {
      engine: outcome.engine,
      basedOnDocuments: outcome.basedOnDocuments,
      documentCount: outcome.documentCount,
      objet: outcome.objet, besoin: outcome.besoin, publics: outcome.publics,
      stagiaires: outcome.stagiaires, sessions: outcome.sessions,
      volumeHoraire: outcome.volumeHoraire, modalites: outcome.modalites,
      lieux: outcome.lieux, moyensHumains: outcome.moyensHumains,
      certifications: outcome.certifications, exigencesAdmin: outcome.exigencesAdmin,
      criteres: outcome.criteres as unknown as Prisma.InputJsonValue,
      contraintesFinancieres: outcome.contraintesFinancieres, delais: outcome.delais,
      risques: outcome.risques, penalites: outcome.penalites, obligations: outcome.obligations,
      contradictions: outcome.contradictions as unknown as Prisma.InputJsonValue,
      pointsAClarifier: outcome.pointsAClarifier, incertitudes: outcome.incertitudes,
    },
  });

  // Statuts déjà arbitrés : on les reporte sur les exigences redétectées.
  const previous = await prisma.requirement.findMany({
    where: { tenderId },
    select: { label: true, status: true, reviewNote: true, reviewedBy: true, reviewedAt: true },
  });
  const previousByLabel = new Map(previous.map((item) => [item.label.toLowerCase(), item]));

  await prisma.requirement.deleteMany({ where: { tenderId } });
  if (outcome.requirements.length > 0) {
    await prisma.requirement.createMany({
      data: outcome.requirements.map((requirement) => {
        const kept = previousByLabel.get(requirement.label.toLowerCase());
        return {
          tenderId,
          level: requirement.level,
          status: kept?.status ?? "A_VERIFIER",
          label: requirement.label,
          detail: requirement.detail,
          category: requirement.category,
          weight: requirement.weight,
          sourceDocumentId: requirement.source?.documentId ?? null,
          sourcePage: requirement.source?.page ?? null,
          sourceQuote: requirement.quote,
          reviewNote: kept?.reviewNote ?? null,
          reviewedBy: kept?.reviewedBy ?? null,
          reviewedAt: kept?.reviewedAt ?? null,
        };
      }),
    });
  }

  // Citations : le lien entre une information de la synthèse et sa source.
  await prisma.citation.deleteMany({ where: { targetType: "analysis", targetId: tenderId } });
  if (outcome.citations.length > 0) {
    await prisma.citation.createMany({
      data: outcome.citations.map((citation) => ({
        documentId: citation.source.documentId,
        page: citation.source.page,
        quote: citation.quote,
        targetType: "analysis",
        targetId: tenderId,
      })),
    });
  }

  if (outcome.contradictions.length > 0) {
    await notify({
      kind: "DOCUMENT_MANQUANT",
      severity: "IMPORTANT",
      title: `Contradictions entre pièces détectées`,
      body: outcome.contradictions.map((item) => item.sujet).join(" ; "),
      tenderId,
    });
  }

  await recordAudit({
    action: "dce.analyse",
    entity: "Tender",
    entityId: tenderId,
    tenderId,
    userId: options.userId,
    summary: outcome.basedOnDocuments
      ? `Analyse de ${outcome.documentCount} pièce(s) : ${outcome.requirements.length} exigence(s) détectée(s).`
      : "Analyse impossible : aucune pièce exploitable.",
    payload: {
      moteur: outcome.engine,
      pieces: outcome.documentCount,
      exigences: outcome.requirements.length,
      contradictions: outcome.contradictions.length,
    },
  });

  return { analysed: outcome.documentCount, requirements: outcome.requirements.length };
}
