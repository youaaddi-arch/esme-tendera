"use server";

import { revalidatePath } from "next/cache";
import type { Prisma, ResponseDocStatus } from "@prisma/client";

import { requireSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { assertCan, PermissionError } from "@/lib/rbac";
import type { ActionState } from "@/app/(app)/affaires/[id]/actions";

/** Section telle que manipulée par l'éditeur. */
export type EditableSection = {
  id: string;
  heading: string;
  body: string;
  origin: string;
  weight: number | null;
  todo: string[];
};

function fail(error: unknown): ActionState {
  if (error instanceof PermissionError) {
    return { ok: false, message: "Votre rôle ne permet pas de modifier ce document." };
  }
  if (error instanceof Error && error.message === "NON_AUTHENTIFIE") {
    return { ok: false, message: "Session expirée. Reconnectez-vous." };
  }
  console.error("[document] action", error);
  return { ok: false, message: "L'action a échoué. Consultez le journal du serveur." };
}

/**
 * Enregistre le contenu édité.
 *
 * Chaque enregistrement archive la version précédente avant d'écrire la
 * nouvelle : l'historique d'un document de réponse fait partie du dossier.
 */
export async function saveDocumentAction(
  documentId: string,
  sections: EditableSection[],
  label?: string,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session.role, "response.edit");

    const document = await prisma.responseDocument.findUniqueOrThrow({ where: { id: documentId } });
    const previous = (document.content ?? {}) as { frameworkNote?: string; sections?: EditableSection[] };

    await prisma.documentVersion.create({
      data: {
        documentId,
        version: document.version,
        content: document.content as Prisma.InputJsonValue,
        label: label ?? null,
        authorId: session.id,
      },
    });

    // Les marqueurs « [À COMPLÉTER] » restants sont recalculés à chaque
    // enregistrement : c'est l'indicateur de ce qu'il reste à faire.
    const gaps = sections
      .filter((section) => section.body.includes("[À COMPLÉTER]"))
      .map((section) => `Section « ${section.heading} » : information à compléter.`);

    await prisma.responseDocument.update({
      where: { id: documentId },
      data: {
        content: { ...previous, sections } as unknown as Prisma.InputJsonValue,
        gaps,
        version: document.version + 1,
      },
    });

    await recordAudit({
      action: "document.save",
      entity: "ResponseDocument",
      entityId: documentId,
      tenderId: document.tenderId,
      userId: session.id,
      summary: `« ${document.title} » enregistré en version ${document.version + 1}.`,
      payload: { sections: sections.length, lacunes: gaps.length },
    });

    revalidatePath(`/affaires/${document.tenderId}/documents/${documentId}`);
    revalidatePath(`/affaires/${document.tenderId}`);
    return {
      ok: true,
      message: `Enregistré en version ${document.version + 1}${gaps.length > 0 ? ` — ${gaps.length} section(s) encore à compléter.` : "."}`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function setDocumentStatusAction(
  documentId: string,
  status: ResponseDocStatus,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    // Seul un valideur peut marquer « validé » ; les autres statuts relèvent
    // de la rédaction courante.
    assertCan(session.role, status === "VALIDE" ? "response.validate" : "response.edit");

    const document = await prisma.responseDocument.findUniqueOrThrow({ where: { id: documentId } });

    if (status === "VALIDE" && document.gaps.length > 0) {
      return {
        ok: false,
        message: `Validation impossible : ${document.gaps.length} information(s) restent à compléter dans ce document.`,
      };
    }

    await prisma.responseDocument.update({ where: { id: documentId }, data: { status } });

    if (status === "EN_RELECTURE") {
      await notify({
        kind: "VALIDATION_ATTENDUE",
        title: `Relecture demandée — ${document.title}`,
        tenderId: document.tenderId,
      });
    }

    await recordAudit({
      action: "document.statut",
      entity: "ResponseDocument",
      entityId: documentId,
      tenderId: document.tenderId,
      userId: session.id,
      summary: `« ${document.title} » passé au statut ${status}.`,
    });

    revalidatePath(`/affaires/${document.tenderId}/documents/${documentId}`);
    revalidatePath(`/affaires/${document.tenderId}`);
    return { ok: true, message: "Statut mis à jour." };
  } catch (error) {
    return fail(error);
  }
}

export async function addCommentAction(documentId: string, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session.role, "response.comment");

    const body = String(formData.get("body") ?? "").trim();
    if (!body) return { ok: false, message: "Le commentaire est vide." };

    const document = await prisma.responseDocument.findUniqueOrThrow({ where: { id: documentId } });

    await prisma.documentComment.create({
      data: {
        documentId,
        sectionId: String(formData.get("sectionId") ?? "") || null,
        authorId: session.id,
        body,
        suggestion: String(formData.get("suggestion") ?? "").trim() || null,
      },
    });

    await recordAudit({
      action: "document.commentaire",
      entity: "ResponseDocument",
      entityId: documentId,
      tenderId: document.tenderId,
      userId: session.id,
      summary: `Commentaire ajouté sur « ${document.title} ».`,
    });

    revalidatePath(`/affaires/${document.tenderId}/documents/${documentId}`);
    return { ok: true, message: "Commentaire ajouté." };
  } catch (error) {
    return fail(error);
  }
}

export async function resolveCommentAction(commentId: string): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session.role, "response.edit");
    const comment = await prisma.documentComment.update({
      where: { id: commentId },
      data: { resolved: true },
      include: { document: { select: { tenderId: true, id: true } } },
    });
    revalidatePath(`/affaires/${comment.document.tenderId}/documents/${comment.document.id}`);
    return { ok: true, message: "Commentaire résolu." };
  } catch (error) {
    return fail(error);
  }
}

/** Restaure une version archivée. La version courante est elle-même archivée. */
export async function restoreVersionAction(documentId: string, versionId: string): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session.role, "response.edit");

    const [document, version] = await Promise.all([
      prisma.responseDocument.findUniqueOrThrow({ where: { id: documentId } }),
      prisma.documentVersion.findUniqueOrThrow({ where: { id: versionId } }),
    ]);

    await prisma.documentVersion.create({
      data: {
        documentId,
        version: document.version,
        content: document.content as Prisma.InputJsonValue,
        label: `Version remplacée par la restauration de la v${version.version}`,
        authorId: session.id,
      },
    });

    await prisma.responseDocument.update({
      where: { id: documentId },
      data: { content: version.content as Prisma.InputJsonValue, version: document.version + 1 },
    });

    await recordAudit({
      action: "document.restauration",
      entity: "ResponseDocument",
      entityId: documentId,
      tenderId: document.tenderId,
      userId: session.id,
      summary: `Version ${version.version} restaurée dans « ${document.title} ».`,
    });

    revalidatePath(`/affaires/${document.tenderId}/documents/${documentId}`);
    return { ok: true, message: `Version ${version.version} restaurée.` };
  } catch (error) {
    return fail(error);
  }
}
