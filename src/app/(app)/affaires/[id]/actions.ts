"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { GoNoGoStatus, NoGoReason, RequirementStatus } from "@prisma/client";
import { z } from "zod";

import { requireSession } from "@/lib/auth";
import { recordAudit, diffFields } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { analyzeTenderDce, ingestDocuments } from "@/lib/dce/ingest";
import { notify } from "@/lib/notifications";
import { assertCan, PermissionError } from "@/lib/rbac";
import { recomputeMatching } from "@/lib/matching/service";
import { buildResponseWorkspace } from "@/lib/docs/workspace";
import { runQualityReview } from "@/lib/compliance/review";
import { EDITABLE_TENDER_FIELDS, spawnLotTender, TenderRuleError } from "@/lib/tenders";

export type ActionState = { ok: boolean; message: string } | null;

/** Enveloppe commune : traduit les erreurs techniques en messages lisibles. */
async function guard<T>(permission: Parameters<typeof assertCan>[1], run: (session: Awaited<ReturnType<typeof requireSession>>) => Promise<T>): Promise<T> {
  const session = await requireSession();
  assertCan(session.role, permission);
  return run(session);
}

function toState(error: unknown): ActionState {
  if (error instanceof TenderRuleError) return { ok: false, message: error.message };
  if (error instanceof PermissionError) {
    return { ok: false, message: "Votre rôle ne permet pas cette action." };
  }
  if (error instanceof z.ZodError) {
    return { ok: false, message: error.issues.map((issue) => issue.message).join(" ") };
  }
  if (error instanceof Error && error.message === "NON_AUTHENTIFIE") {
    return { ok: false, message: "Session expirée. Reconnectez-vous." };
  }
  console.error("[affaire] action", error);
  return { ok: false, message: "L'action a échoué. Consultez le journal du serveur." };
}

function refresh(tenderId: string) {
  revalidatePath(`/affaires/${tenderId}`);
  revalidatePath("/pipeline");
  revalidatePath("/affaires");
  revalidatePath("/");
}

// ---------------------------------------------------------------------------
// Onglet 1 — informations générales
// ---------------------------------------------------------------------------

const tenderSchema = z.object({
  title: z.string().trim().min(5, "L'intitulé doit faire au moins 5 caractères."),
  buyer: z.string().trim().min(2, "Le nom de l'acheteur est requis."),
  buyerSiret: z.string().trim().max(20).optional(),
  consultationRef: z.string().trim().max(120).optional(),
  objectSummary: z.string().trim().max(5000).optional(),
  procedure: z.string().trim().max(200).optional(),
  lotLabel: z.string().trim().max(120).optional(),
  contractDuration: z.string().trim().max(200).optional(),
  renewals: z.string().trim().max(200).optional(),
  executionPlace: z.string().trim().max(300).optional(),
  region: z.string().trim().max(120).optional(),
  department: z.string().trim().max(120).optional(),
  responseTerms: z.string().trim().max(2000).optional(),
  amountNote: z.string().trim().max(500).optional(),
  sourceUrl: z.string().trim().max(600).optional(),
  dceSourceUrl: z.string().trim().max(600).optional(),
  deadlineAt: z.string().optional(),
  publishedAt: z.string().optional(),
  amountKind: z.enum(["ESTIME", "MAXIMUM", "PAR_LOT", "GLOBAL", "NON_COMMUNIQUE"]),
  amountMinEur: z.string().optional(),
  amountMaxEur: z.string().optional(),
  ownerId: z.string().optional(),
  cpvCodes: z.string().optional(),
});

export async function updateTenderAction(tenderId: string, formData: FormData): Promise<ActionState> {
  try {
    return await guard("tender.edit", async (session) => {
      const raw = Object.fromEntries(formData) as Record<string, string>;
      const parsed = tenderSchema.parse(raw);

      const before = await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } });

      const amount = (value?: string) => {
        if (!value || value.trim() === "") return null;
        const parsedValue = Number.parseFloat(value.replace(/\s/g, "").replace(",", "."));
        return Number.isFinite(parsedValue) ? parsedValue : null;
      };
      const date = (value?: string) => (value && value.trim() ? new Date(value) : null);

      const data = {
        ...Object.fromEntries(
          EDITABLE_TENDER_FIELDS.map((field) => [field, (parsed as Record<string, string | undefined>)[field] || null]),
        ),
        deadlineAt: date(parsed.deadlineAt),
        publishedAt: date(parsed.publishedAt),
        amountKind: parsed.amountKind,
        amountMinEur: amount(parsed.amountMinEur),
        amountMaxEur: amount(parsed.amountMaxEur),
        ownerId: parsed.ownerId && parsed.ownerId !== "" ? parsed.ownerId : null,
        cpvCodes: (parsed.cpvCodes ?? "")
          .split(/[,;\s]+/)
          .map((code) => code.trim())
          .filter(Boolean),
      };

      await prisma.tender.update({ where: { id: tenderId }, data });

      const changes = diffFields(before as unknown as Record<string, unknown>, data as Record<string, unknown>);
      await recordAudit({
        action: "tender.update",
        entity: "Tender",
        entityId: tenderId,
        tenderId,
        userId: session.id,
        summary: `Fiche modifiée : ${Object.keys(changes).join(", ") || "aucun changement"}.`,
        payload: changes,
      });

      // L'objet ou les lots ont pu changer : le matching n'est plus à jour.
      if (changes.title || changes.objectSummary) {
        await recomputeMatching(tenderId, { userId: session.id, reason: "fiche modifiée" });
      }

      refresh(tenderId);
      return { ok: true, message: "Fiche enregistrée." };
    });
  } catch (error) {
    return toState(error);
  }
}

// ---------------------------------------------------------------------------
// Onglet 2 — lots
// ---------------------------------------------------------------------------

export async function createLotAction(tenderId: string, formData: FormData): Promise<ActionState> {
  try {
    return await guard("tender.edit", async (session) => {
      const number = String(formData.get("number") ?? "").trim();
      const title = String(formData.get("title") ?? "").trim();
      if (!number || !title) {
        return { ok: false, message: "Le numéro et l'intitulé du lot sont requis." };
      }
      await prisma.lot.create({
        data: {
          tenderId,
          number,
          title,
          description: String(formData.get("description") ?? "").trim() || null,
        },
      });
      await recordAudit({
        action: "lot.create", entity: "Tender", entityId: tenderId, tenderId,
        userId: session.id, summary: `Lot ${number} ajouté : ${title}.`,
      });
      refresh(tenderId);
      return { ok: true, message: `Lot ${number} ajouté.` };
    });
  } catch (error) {
    return toState(error);
  }
}

export async function spawnLotAction(tenderId: string, lotId: string): Promise<ActionState> {
  try {
    return await guard("tender.create", async (session) => {
      const created = await spawnLotTender(lotId, session.id);
      await recomputeMatching(created.id, { userId: session.id, reason: "création lot" });
      refresh(tenderId);
      return { ok: true, message: `Affaire ${created.reference} créée pour ce lot.` };
    });
  } catch (error) {
    return toState(error);
  }
}

// ---------------------------------------------------------------------------
// Onglet 3 — DCE
// ---------------------------------------------------------------------------

export async function uploadDceAction(tenderId: string, formData: FormData): Promise<ActionState> {
  try {
    return await guard("dce.upload", async (session) => {
      const entries = formData.getAll("fichiers").filter((entry): entry is File => entry instanceof File);
      const files = entries.filter((file) => file.size > 0);
      if (files.length === 0) return { ok: false, message: "Aucun fichier sélectionné." };

      const payload = await Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          buffer: Buffer.from(await file.arrayBuffer()),
          mimeType: file.type || null,
        })),
      );

      const report = await ingestDocuments(tenderId, payload, { userId: session.id });

      const parts = [`${report.stored.length} pièce(s) importée(s)`];
      if (report.duplicates.length) parts.push(`${report.duplicates.length} doublon(s) ignoré(s)`);
      if (report.unreadable.length) {
        parts.push(`${report.unreadable.length} pièce(s) non analysable(s) : ${report.unreadable[0].reason}`);
      }

      refresh(tenderId);
      return { ok: true, message: `${parts.join(". ")}.` };
    });
  } catch (error) {
    return toState(error);
  }
}

export async function markDceUnavailableAction(tenderId: string, formData: FormData): Promise<ActionState> {
  try {
    return await guard("dce.upload", async (session) => {
      const reason = String(formData.get("reason") ?? "").trim();
      await prisma.tender.update({
        where: { id: tenderId },
        data: {
          dceStatus: "NON_RECUPERE",
          dceFailureReason: reason || "Récupération automatique impossible : accès nominatif requis sur le profil d'acheteur.",
        },
      });
      await notify({
        kind: "DCE_NON_RECUPERE",
        severity: "IMPORTANT",
        title: "DCE non récupéré",
        body: reason || "Téléchargez le dossier depuis la consultation, puis importez-le.",
        tenderId,
      });
      await recordAudit({
        action: "dce.nonRecupere", entity: "Tender", entityId: tenderId, tenderId,
        userId: session.id, summary: "DCE marqué comme non récupéré.",
      });
      refresh(tenderId);
      return { ok: true, message: "DCE marqué comme non récupéré." };
    });
  } catch (error) {
    return toState(error);
  }
}

export async function deleteDocumentAction(tenderId: string, documentId: string): Promise<ActionState> {
  try {
    return await guard("dce.upload", async (session) => {
      const document = await prisma.document.findUnique({ where: { id: documentId } });
      if (!document || document.tenderId !== tenderId) {
        return { ok: false, message: "Pièce introuvable." };
      }
      if (document.storagePath) {
        const { deleteStoredFile } = await import("@/lib/storage");
        await deleteStoredFile(document.storagePath);
      }
      await prisma.document.delete({ where: { id: documentId } });
      await recordAudit({
        action: "dce.suppression", entity: "Tender", entityId: tenderId, tenderId,
        userId: session.id, summary: `Pièce supprimée : ${document.fileName}.`,
      });
      refresh(tenderId);
      return { ok: true, message: `${document.fileName} supprimée.` };
    });
  } catch (error) {
    return toState(error);
  }
}

export async function reclassifyDocumentAction(
  tenderId: string,
  documentId: string,
  kind: string,
): Promise<ActionState> {
  try {
    return await guard("dce.upload", async (session) => {
      await prisma.document.update({
        where: { id: documentId },
        // Une correction humaine vaut certitude : la confiance passe à 1.
        data: { kind: kind as never, kindConfidence: 1 },
      });
      await recordAudit({
        action: "dce.reclassement", entity: "Document", entityId: documentId, tenderId,
        userId: session.id, summary: `Type de pièce corrigé en ${kind}.`,
      });
      refresh(tenderId);
      return { ok: true, message: "Type de pièce corrigé." };
    });
  } catch (error) {
    return toState(error);
  }
}

// ---------------------------------------------------------------------------
// Onglet 4 — analyse
// ---------------------------------------------------------------------------

export async function analyzeDceAction(tenderId: string): Promise<ActionState> {
  try {
    return await guard("dce.analyze", async (session) => {
      const result = await analyzeTenderDce(tenderId, { userId: session.id });
      if (result.analysed === 0) {
        return {
          ok: false,
          message:
            "Aucune pièce exploitable : importez le DCE (PDF avec couche texte, DOCX ou XLSX) avant de lancer l'analyse.",
        };
      }
      await recomputeMatching(tenderId, { userId: session.id, reason: "analyse DCE" });
      refresh(tenderId);
      return {
        ok: true,
        message: `${result.analysed} pièce(s) analysée(s), ${result.requirements} exigence(s) détectée(s). Matching recalculé.`,
      };
    });
  } catch (error) {
    return toState(error);
  }
}

export async function updateRequirementAction(
  tenderId: string,
  requirementId: string,
  status: RequirementStatus,
  note: string,
): Promise<ActionState> {
  try {
    return await guard("tender.edit", async (session) => {
      await prisma.requirement.update({
        where: { id: requirementId },
        data: { status, reviewNote: note || null, reviewedBy: session.name, reviewedAt: new Date() },
      });
      await recordAudit({
        action: "exigence.statut", entity: "Requirement", entityId: requirementId, tenderId,
        userId: session.id, summary: `Exigence passée à « ${status} ».`,
      });
      refresh(tenderId);
      return { ok: true, message: "Exigence mise à jour." };
    });
  } catch (error) {
    return toState(error);
  }
}

// ---------------------------------------------------------------------------
// Onglet 5 — matching
// ---------------------------------------------------------------------------

export async function recomputeMatchingAction(tenderId: string): Promise<ActionState> {
  try {
    return await guard("matching.run", async (session) => {
      const outcome = await recomputeMatching(tenderId, { userId: session.id, reason: "force manuelle" });
      refresh(tenderId);
      if (!outcome) return { ok: false, message: "Le score a été ajusté manuellement : levez l'ajustement pour recalculer." };
      return {
        ok: true,
        message: `Scores recalculés — ESME ${outcome.scoreCatalogue}, voisines ${outcome.scoreVoisines}, IONIS ${outcome.scoreIonis}, global ${outcome.scoreGlobal}.`,
      };
    });
  } catch (error) {
    return toState(error);
  }
}

export async function overrideMatchingAction(tenderId: string, formData: FormData): Promise<ActionState> {
  try {
    return await guard("matching.override", async (session) => {
      const number = (key: string) => {
        const value = Number.parseFloat(String(formData.get(key) ?? ""));
        return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
      };
      const catalogue = number("scoreCatalogue");
      const voisines = number("scoreVoisines");
      const ionis = number("scoreIonis");
      const note = String(formData.get("overrideNote") ?? "").trim();
      if (catalogue === null || voisines === null || ionis === null) {
        return { ok: false, message: "Les trois scores doivent être des nombres entre 0 et 100." };
      }
      if (!note) {
        return { ok: false, message: "Justifiez l'ajustement : il reste au journal d'audit." };
      }

      const existing = await prisma.matchResult.findUnique({ where: { tenderId } });
      const weights = (existing?.weights as { catalogue: number; voisines: number; ionis: number } | null) ?? {
        catalogue: 60, voisines: 25, ionis: 15,
      };
      const global = Math.round(
        (catalogue * weights.catalogue + voisines * weights.voisines + ionis * weights.ionis) / 100,
      );

      await prisma.matchResult.update({
        where: { tenderId },
        data: {
          scoreCatalogue: catalogue, scoreVoisines: voisines, scoreIonis: ionis,
          scoreGlobal: global, manualOverride: true, overrideNote: note,
          engine: "ajustement manuel",
        },
      });

      await recordAudit({
        action: "matching.override", entity: "Tender", entityId: tenderId, tenderId,
        userId: session.id,
        summary: `Scores ajustés manuellement : ${catalogue} / ${voisines} / ${ionis} (global ${global}).`,
        payload: { justification: note },
      });

      refresh(tenderId);
      return { ok: true, message: "Scores ajustés. L'ajustement et sa justification sont au journal." };
    });
  } catch (error) {
    return toState(error);
  }
}

export async function clearOverrideAction(tenderId: string): Promise<ActionState> {
  try {
    return await guard("matching.override", async (session) => {
      await prisma.matchResult.update({ where: { tenderId }, data: { manualOverride: false, overrideNote: null } });
      await recomputeMatching(tenderId, { userId: session.id, reason: "force levée d'ajustement" });
      refresh(tenderId);
      return { ok: true, message: "Ajustement levé, scores recalculés." };
    });
  } catch (error) {
    return toState(error);
  }
}

// ---------------------------------------------------------------------------
// Go / No Go
// ---------------------------------------------------------------------------

export async function recordDecisionAction(tenderId: string, formData: FormData): Promise<ActionState> {
  try {
    return await guard("decision.record", async (session) => {
      const status = String(formData.get("status") ?? "") as GoNoGoStatus;
      const rationale = String(formData.get("rationale") ?? "").trim();
      const reason = String(formData.get("reason") ?? "").trim() as NoGoReason | "";

      if (!["GO", "NO_GO", "A_DECIDER"].includes(status)) {
        return { ok: false, message: "Décision invalide." };
      }
      if (status === "NO_GO" && !reason) {
        return { ok: false, message: "Un NO GO doit porter un motif." };
      }
      if (!rationale) {
        return { ok: false, message: "Motivez la décision : elle engage l'équipe et reste au journal." };
      }

      await prisma.decision.updateMany({ where: { tenderId, superseded: false }, data: { superseded: true } });
      await prisma.decision.create({
        data: {
          tenderId, status, rationale,
          reason: status === "NO_GO" ? (reason as NoGoReason) : null,
          decidedById: session.id,
        },
      });

      // Le GO ouvre l'espace de préparation ; le NO GO classe l'affaire.
      const stage = status === "GO" ? "PREPARATION" : status === "NO_GO" ? "REJETE_NON_POURSUIVI" : "GO_NO_GO";
      await prisma.tender.update({ where: { id: tenderId }, data: { goNoGo: status, stage } });

      if (status === "GO") {
        await buildResponseWorkspace(tenderId, session.id);
      }

      await recordAudit({
        action: "decision.record", entity: "Tender", entityId: tenderId, tenderId,
        userId: session.id,
        summary: `Décision ${status}${reason ? ` (${reason})` : ""}.`,
        payload: { motivation: rationale },
      });

      refresh(tenderId);
      return {
        ok: true,
        message:
          status === "GO"
            ? "GO enregistré. L'espace de préparation de la réponse a été créé."
            : status === "NO_GO"
              ? "NO GO enregistré. L'affaire est classée ; elle reste rouvrable."
              : "Décision remise à « à décider ».",
      };
    });
  } catch (error) {
    return toState(error);
  }
}

// ---------------------------------------------------------------------------
// Préparation de la réponse
// ---------------------------------------------------------------------------

export async function buildWorkspaceAction(tenderId: string): Promise<ActionState> {
  try {
    return await guard("response.edit", async (session) => {
      const result = await buildResponseWorkspace(tenderId, session.id);
      refresh(tenderId);
      return {
        ok: true,
        message: `Espace de réponse généré : ${result.checklist} pièce(s) au dossier, ${result.tasks} tâche(s), mémoire technique en ${result.sections} sections.`,
      };
    });
  } catch (error) {
    return toState(error);
  }
}

export async function updateTaskAction(tenderId: string, taskId: string, formData: FormData): Promise<ActionState> {
  try {
    return await guard("response.edit", async (session) => {
      const status = String(formData.get("status") ?? "");
      const assigneeId = String(formData.get("assigneeId") ?? "");
      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: status as never,
          assigneeId: assigneeId || null,
        },
      });
      await recordAudit({
        action: "tache.update", entity: "Task", entityId: taskId, tenderId,
        userId: session.id, summary: `Tâche mise à jour (${status}).`,
      });
      refresh(tenderId);
      return { ok: true, message: "Tâche mise à jour." };
    });
  } catch (error) {
    return toState(error);
  }
}

export async function updateChecklistAction(
  tenderId: string,
  itemId: string,
  status: RequirementStatus,
): Promise<ActionState> {
  try {
    return await guard("response.edit", async (session) => {
      await prisma.checklistItem.update({ where: { id: itemId }, data: { status } });
      await recordAudit({
        action: "checklist.update", entity: "ChecklistItem", entityId: itemId, tenderId,
        userId: session.id, summary: `Pièce du dossier passée à « ${status} ».`,
      });
      refresh(tenderId);
      return { ok: true, message: "Checklist mise à jour." };
    });
  } catch (error) {
    return toState(error);
  }
}

// ---------------------------------------------------------------------------
// Contrôle de complétude et de qualité
// ---------------------------------------------------------------------------

export async function runQualityAction(tenderId: string): Promise<ActionState> {
  try {
    return await guard("quality.run", async (session) => {
      const review = await runQualityReview(tenderId, session.id);
      refresh(tenderId);
      const blockers = Array.isArray(review.blockers) ? review.blockers.length : 0;
      return {
        ok: true,
        message: `Contrôle effectué — complétude ${Math.round(review.completeness)}/100, qualité ${Math.round(review.quality)}/100, conformité ${Math.round(review.compliance)}/100${blockers > 0 ? `, ${blockers} alerte(s) bloquante(s)` : ""}.`,
      };
    });
  } catch (error) {
    return toState(error);
  }
}

// ---------------------------------------------------------------------------
// Dépôt, négociation, résultat
// ---------------------------------------------------------------------------

export async function confirmSubmissionAction(tenderId: string, formData: FormData): Promise<ActionState> {
  try {
    return await guard("submission.record", async (session) => {
      const platform = String(formData.get("platform") ?? "").trim();
      const submittedAt = String(formData.get("submittedAt") ?? "").trim();
      const acknowledgement = String(formData.get("acknowledgement") ?? "").trim();
      const confirmed = formData.get("confirmed") === "on";

      if (!confirmed) {
        return {
          ok: false,
          message:
            "Cochez la confirmation : TENDERA n'enregistre pas un dépôt sans attestation explicite. Le dépôt sur les plateformes n'est pas automatisé.",
        };
      }
      if (!platform || !submittedAt) {
        return { ok: false, message: "La plateforme et la date de dépôt sont requises." };
      }

      const documents = await prisma.responseDocument.findMany({
        where: { tenderId },
        select: { title: true, status: true },
      });

      await prisma.submission.upsert({
        where: { tenderId },
        create: {
          tenderId, confirmed: true, platform,
          submittedAt: new Date(submittedAt),
          submittedBy: session.name,
          platformRef: String(formData.get("platformRef") ?? "").trim() || null,
          acknowledgement: acknowledgement || null,
          observations: String(formData.get("observations") ?? "").trim() || null,
          documentList: documents.map((document) => `${document.title} (${document.status})`),
        },
        update: {
          confirmed: true, platform,
          submittedAt: new Date(submittedAt),
          submittedBy: session.name,
          platformRef: String(formData.get("platformRef") ?? "").trim() || null,
          acknowledgement: acknowledgement || null,
          observations: String(formData.get("observations") ?? "").trim() || null,
          documentList: documents.map((document) => `${document.title} (${document.status})`),
        },
      });

      await prisma.tender.update({
        where: { id: tenderId },
        data: { stage: "DEPOT_EFFECTUE", outcome: "EN_ATTENTE" },
      });

      await recordAudit({
        action: "depot.confirme", entity: "Tender", entityId: tenderId, tenderId,
        userId: session.id,
        summary: `Dépôt confirmé sur ${platform} le ${new Date(submittedAt).toLocaleString("fr-FR")}.`,
        payload: { accuseReception: acknowledgement || null },
      });

      refresh(tenderId);
      return { ok: true, message: "Dépôt enregistré." };
    });
  } catch (error) {
    return toState(error);
  }
}

export async function addNegotiationItemAction(tenderId: string, formData: FormData): Promise<ActionState> {
  try {
    return await guard("tender.edit", async (session) => {
      const title = String(formData.get("title") ?? "").trim();
      if (!title) return { ok: false, message: "L'intitulé est requis." };
      const dueAt = String(formData.get("dueAt") ?? "").trim();
      await prisma.negotiationItem.create({
        data: {
          tenderId,
          kind: (String(formData.get("kind") ?? "AUTRE") || "AUTRE") as never,
          title,
          detail: String(formData.get("detail") ?? "").trim() || null,
          dueAt: dueAt ? new Date(dueAt) : null,
          assigneeId: String(formData.get("assigneeId") ?? "") || null,
        },
      });
      if (await prisma.tender.count({ where: { id: tenderId, stage: "DEPOT_EFFECTUE" } })) {
        await prisma.tender.update({ where: { id: tenderId }, data: { stage: "NEGOCIATION" } });
      }
      await recordAudit({
        action: "negociation.ajout", entity: "Tender", entityId: tenderId, tenderId,
        userId: session.id, summary: `Élément de négociation ajouté : ${title}.`,
      });
      refresh(tenderId);
      return { ok: true, message: "Élément ajouté au suivi de négociation." };
    });
  } catch (error) {
    return toState(error);
  }
}

export async function recordResultAction(tenderId: string, formData: FormData): Promise<ActionState> {
  try {
    return await guard("result.record", async (session) => {
      const status = String(formData.get("status") ?? "") as
        | "EN_ATTENTE" | "ATTRIBUE" | "REJETE" | "ANNULE" | "SANS_SUITE" | "INFRUCTUEUX";
      const number = (key: string) => {
        const value = Number.parseFloat(String(formData.get(key) ?? "").replace(/\s/g, "").replace(",", "."));
        return Number.isFinite(value) ? value : null;
      };
      const text = (key: string) => String(formData.get(key) ?? "").trim() || null;
      const date = (key: string) => {
        const value = String(formData.get(key) ?? "").trim();
        return value ? new Date(value) : null;
      };

      const data = {
        status,
        awardedLot: text("awardedLot"),
        awardedAmountEur: number("awardedAmountEur"),
        notifiedAt: date("notifiedAt"),
        contractDuration: text("contractDuration"),
        startsAt: date("startsAt"),
        operationalOwner: text("operationalOwner"),
        rejectionReason: text("rejectionReason"),
        ranking: number("ranking"),
        technicalScore: number("technicalScore"),
        financialScore: number("financialScore"),
        globalScore: number("globalScore"),
        winner: text("winner"),
        winnerAmountEur: number("winnerAmountEur"),
        gapAnalysis: text("gapAnalysis"),
        lessons: String(formData.get("lessons") ?? "")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      };

      await prisma.tenderResult.upsert({
        where: { tenderId },
        create: { tenderId, ...data },
        update: data,
      });

      const stage =
        status === "ATTRIBUE" ? "MARCHE_ATTRIBUE"
        : status === "EN_ATTENTE" ? "ATTENTE_RESULTAT"
        : "REJETE_NON_POURSUIVI";
      await prisma.tender.update({ where: { id: tenderId }, data: { outcome: status, stage } });

      await notify({
        kind: "RESULTAT_PUBLIE",
        severity: status === "ATTRIBUE" ? "INFO" : "IMPORTANT",
        title: `Résultat enregistré — ${status}`,
        tenderId,
      });

      await recordAudit({
        action: "resultat.record", entity: "Tender", entityId: tenderId, tenderId,
        userId: session.id, summary: `Résultat enregistré : ${status}.`, payload: data,
      });

      refresh(tenderId);
      return { ok: true, message: "Résultat enregistré." };
    });
  } catch (error) {
    return toState(error);
  }
}

// ---------------------------------------------------------------------------
// Archivage
// ---------------------------------------------------------------------------

export async function archiveTenderAction(tenderId: string): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, "tender.archive");
  await prisma.tender.update({ where: { id: tenderId }, data: { archived: true } });
  await recordAudit({
    action: "tender.archive", entity: "Tender", entityId: tenderId, tenderId,
    userId: session.id, summary: "Affaire archivée.",
  });
  refresh(tenderId);
  redirect("/pipeline");
}
