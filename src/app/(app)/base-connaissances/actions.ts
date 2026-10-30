"use server";

import { revalidatePath } from "next/cache";
import type { KnowledgeCategory, Prisma } from "@prisma/client";

import { requireSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { classifyDocument } from "@/lib/dce/classify";
import { extractText, expandArchive, isArchive, joinPages } from "@/lib/dce/extract";
import { assertCan, PermissionError } from "@/lib/rbac";
import { saveFile, sha256, storagePathFor } from "@/lib/storage";
import type { ActionState } from "@/app/(app)/affaires/[id]/actions";

function fail(error: unknown): ActionState {
  if (error instanceof PermissionError) {
    return { ok: false, message: "Votre rôle ne permet pas de modifier la base de connaissances." };
  }
  if (error instanceof Error && error.message === "NON_AUTHENTIFIE") {
    return { ok: false, message: "Session expirée. Reconnectez-vous." };
  }
  console.error("[connaissances] action", error);
  return { ok: false, message: "L'action a échoué. Consultez le journal du serveur." };
}

/**
 * Dépôt d'un document dans la base de connaissances.
 *
 * Le texte est extrait et indexé en fragments : c'est ce qui permet, plus
 * tard, de retrouver un passage et d'en citer la source dans un mémoire.
 */
export async function uploadKnowledgeAction(formData: FormData): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session.role, "knowledge.edit");

    const category = String(formData.get("category") ?? "") as KnowledgeCategory;
    const tags = String(formData.get("tags") ?? "").split(/[,;]+/).map((tag) => tag.trim()).filter(Boolean);
    const validUntil = String(formData.get("validUntil") ?? "").trim();
    const confidential = formData.get("confidential") === "on";

    const entries = formData.getAll("fichiers").filter((entry): entry is File => entry instanceof File);
    const files = entries.filter((file) => file.size > 0);
    if (files.length === 0) return { ok: false, message: "Aucun fichier sélectionné." };

    let stored = 0;
    let skipped = 0;

    const flattened: { fileName: string; buffer: Buffer; mimeType: string | null }[] = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      if (isArchive(file.name)) {
        for (const entry of await expandArchive(buffer)) {
          flattened.push({ fileName: entry.fileName, buffer: entry.buffer, mimeType: null });
        }
      } else {
        flattened.push({ fileName: file.name, buffer, mimeType: file.type || null });
      }
    }

    for (const file of flattened) {
      const digest = sha256(file.buffer);
      const existing = await prisma.document.findFirst({
        where: { sha256: digest, scope: "CONNAISSANCE" },
        select: { id: true },
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      const extraction = await extractText(file.fileName, file.buffer);
      const text = joinPages(extraction.pages);
      const classification = classifyDocument(file.fileName, text);
      const storagePath = storagePathFor("connaissances", digest, file.fileName);
      await saveFile(storagePath, file.buffer);

      const document = await prisma.document.create({
        data: {
          scope: "CONNAISSANCE",
          kind: classification.kind,
          kindConfidence: classification.confidence,
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.buffer.byteLength,
          storagePath,
          sha256: digest,
          extractedPages: extraction.pages as unknown as Prisma.InputJsonValue,
          pageCount: extraction.pageCount,
          extractionStatus: extraction.status,
          extractionError: extraction.error ?? null,
          knowledgeEntry: {
            create: {
              category,
              title: file.fileName.replace(/\.[^.]+$/, ""),
              summary: text.slice(0, 400).replace(/\s+/g, " ").trim() || null,
              tags,
              validUntil: validUntil ? new Date(validUntil) : null,
              confidential,
            },
          },
        },
      });

      if (extraction.status === "termine") {
        const { tokenize } = await import("@/lib/matching/text");
        const chunks: Prisma.DocumentChunkCreateManyInput[] = [];
        let ordinal = 0;
        for (const page of extraction.pages) {
          if (!page.text.trim()) continue;
          for (let offset = 0; offset < page.text.length; offset += 1000) {
            const content = page.text.slice(offset, offset + 1000);
            chunks.push({
              documentId: document.id,
              ordinal: ordinal++,
              page: page.page,
              content,
              tokens: [...new Set(tokenize(content))].slice(0, 120),
            });
          }
        }
        if (chunks.length > 0) await prisma.documentChunk.createMany({ data: chunks });
      }

      stored += 1;
    }

    await recordAudit({
      action: "connaissances.import",
      entity: "KnowledgeEntry",
      entityId: "base",
      userId: session.id,
      summary: `${stored} document(s) ajouté(s) à la base de connaissances, ${skipped} doublon(s) ignoré(s).`,
    });

    revalidatePath("/base-connaissances");
    return {
      ok: true,
      message: `${stored} document(s) ajouté(s)${skipped > 0 ? `, ${skipped} doublon(s) ignoré(s)` : ""}.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function validateKnowledgeAction(entryId: string): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session.role, "knowledge.edit");
    await prisma.knowledgeEntry.update({
      where: { id: entryId },
      data: { validated: true, validatedBy: session.name, validatedAt: new Date() },
    });
    revalidatePath("/base-connaissances");
    return { ok: true, message: "Connaissance validée." };
  } catch (error) {
    return fail(error);
  }
}

export async function markObsoleteAction(entryId: string): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session.role, "knowledge.edit");
    const entry = await prisma.knowledgeEntry.update({ where: { id: entryId }, data: { obsolete: true } });
    await recordAudit({
      action: "connaissances.obsolete",
      entity: "KnowledgeEntry",
      entityId: entry.id,
      userId: session.id,
      summary: `« ${entry.title} » marqué obsolète.`,
    });
    revalidatePath("/base-connaissances");
    return { ok: true, message: "Document marqué comme obsolète : il ne sera plus proposé à la rédaction." };
  } catch (error) {
    return fail(error);
  }
}
