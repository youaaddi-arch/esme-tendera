"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSession } from "@/lib/auth";
import { assertCan, PermissionError } from "@/lib/rbac";
import { createManualTender } from "@/lib/tender-manuel";
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
    const brut = parsed.amountMaxEur?.trim()
      ? Number.parseFloat(parsed.amountMaxEur.replace(/\s/g, "").replace(",", "."))
      : null;

    // Les règles de la création manuelle vivent dans `createManualTender`,
    // parce que la reprise d'un tri fait ailleurs y mène aussi.
    const tender = await createManualTender({
      title: parsed.title,
      buyer: parsed.buyer,
      consultationRef: parsed.consultationRef,
      objectSummary: parsed.objectSummary,
      procedure: parsed.procedure,
      deadlineAt: parsed.deadlineAt ? new Date(parsed.deadlineAt) : null,
      publishedAt: parsed.publishedAt ? new Date(parsed.publishedAt) : null,
      sourceUrl: parsed.sourceUrl,
      dceSourceUrl: parsed.dceSourceUrl,
      region: parsed.region,
      cpvCodes: (parsed.cpvCodes ?? "").split(/[\s,;]+/).map((code) => code.trim()).filter(Boolean),
      amountKind: parsed.amountKind,
      amountMaxEur: Number.isFinite(brut as number) ? brut : null,
      userId: session.id,
    });
    createdId = tender.id;

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
