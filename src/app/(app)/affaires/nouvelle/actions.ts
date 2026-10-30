"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { assertCan, PermissionError } from "@/lib/rbac";
import { recomputeMatching } from "@/lib/matching/service";
import { nextManualReference } from "@/lib/tenders";
import type { ActionState } from "@/app/(app)/affaires/[id]/actions";

const schema = z.object({
  title: z.string().trim().min(5, "L'intitulé doit faire au moins 5 caractères."),
  buyer: z.string().trim().min(2, "Le nom de l'acheteur est requis."),
  consultationRef: z.string().trim().optional(),
  objectSummary: z.string().trim().optional(),
  procedure: z.string().trim().optional(),
  deadlineAt: z.string().optional(),
  publishedAt: z.string().optional(),
  sourceUrl: z.string().trim().optional(),
  dceSourceUrl: z.string().trim().optional(),
  region: z.string().trim().optional(),
  cpvCodes: z.string().optional(),
  amountKind: z.enum(["ESTIME", "MAXIMUM", "PAR_LOT", "GLOBAL", "NON_COMMUNIQUE"]),
  amountMaxEur: z.string().optional(),
});

/**
 * Création manuelle d'une affaire.
 *
 * Toujours disponible, y compris quand aucun connecteur de veille n'est
 * joignable : c'est la voie de secours pour traiter une consultation repérée
 * à la main.
 */
export async function createTenderAction(formData: FormData): Promise<ActionState> {
  let createdId: string | null = null;
  try {
    const session = await requireSession();
    assertCan(session.role, "tender.create");

    const parsed = schema.parse(Object.fromEntries(formData));
    const reference = await nextManualReference();
    const amount = parsed.amountMaxEur?.trim()
      ? Number.parseFloat(parsed.amountMaxEur.replace(/\s/g, "").replace(",", "."))
      : null;

    const connector = await prisma.sourceConnector.findUnique({ where: { key: "import-manuel" } });

    const tender = await prisma.tender.create({
      data: {
        reference,
        title: parsed.title,
        buyer: parsed.buyer,
        consultationRef: parsed.consultationRef || null,
        objectSummary: parsed.objectSummary || null,
        procedure: parsed.procedure || null,
        deadlineAt: parsed.deadlineAt ? new Date(parsed.deadlineAt) : null,
        publishedAt: parsed.publishedAt ? new Date(parsed.publishedAt) : null,
        sourceUrl: parsed.sourceUrl || null,
        dceSourceUrl: parsed.dceSourceUrl || null,
        region: parsed.region || null,
        cpvCodes: (parsed.cpvCodes ?? "").split(/[\s,;]+/).map((code) => code.trim()).filter(Boolean),
        amountKind: parsed.amountKind,
        amountMaxEur: Number.isFinite(amount) ? amount : null,
        sourceConnectorId: connector?.id ?? null,
        ownerId: session.id,
        stage: "AO_IDENTIFIES",
      },
    });
    createdId = tender.id;

    await recordAudit({
      action: "tender.create",
      entity: "Tender",
      entityId: tender.id,
      tenderId: tender.id,
      userId: session.id,
      summary: `Affaire ${reference} créée manuellement.`,
    });

    await recomputeMatching(tender.id, { userId: session.id, reason: "création manuelle" });
    revalidatePath("/pipeline");
    revalidatePath("/affaires");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, message: error.issues.map((issue) => issue.message).join(" ") };
    }
    if (error instanceof PermissionError) {
      return { ok: false, message: "Votre rôle ne permet pas de créer une affaire." };
    }
    if (error instanceof Error && error.message === "NON_AUTHENTIFIE") {
      return { ok: false, message: "Session expirée. Reconnectez-vous." };
    }
    console.error("[affaire] création", error);
    return { ok: false, message: "La création a échoué. Consultez le journal du serveur." };
  }

  // La redirection lève volontairement : elle est hors du bloc try.
  redirect(`/affaires/${createdId}?onglet=dce`);
}
