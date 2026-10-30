"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { z } from "zod";

import { hashPassword, requireSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { recomputeActiveMatchings } from "@/lib/matching/service";
import { assertCan, PermissionError } from "@/lib/rbac";
import { normalizeWeights, setSetting } from "@/lib/settings";
import type { ActionState } from "@/app/(app)/affaires/[id]/actions";

function fail(error: unknown): ActionState {
  if (error instanceof z.ZodError) {
    return { ok: false, message: error.issues.map((issue) => issue.message).join(" ") };
  }
  if (error instanceof PermissionError) {
    return { ok: false, message: "Action réservée à l'administration." };
  }
  if (error instanceof Error && error.message === "NON_AUTHENTIFIE") {
    return { ok: false, message: "Session expirée. Reconnectez-vous." };
  }
  console.error("[admin] action", error);
  return { ok: false, message: "L'action a échoué. Consultez le journal du serveur." };
}

// ---------------------------------------------------------------------------
// Marque
// ---------------------------------------------------------------------------

/**
 * Nom et éléments de marque.
 *
 * Le cahier des charges demande de pouvoir changer le nom du produit depuis
 * l'administration : ces valeurs sont lues partout dans l'interface plutôt
 * qu'écrites en dur.
 */
export async function updateBrandAction(formData: FormData): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session.role, "admin.settings");

    const parsed = z
      .object({
        productName: z.string().trim().min(2, "Le nom du produit est requis."),
        signature: z.string().trim().max(160),
        institution: z.string().trim().min(2),
        group: z.string().trim().max(120),
        logoLight: z.string().trim().min(1),
        logoDark: z.string().trim().min(1),
      })
      .parse(Object.fromEntries(formData));

    await setSetting("brand", parsed, session.id);
    await recordAudit({
      action: "admin.marque",
      entity: "Setting",
      entityId: "brand",
      userId: session.id,
      summary: `Marque mise à jour : ${parsed.productName}.`,
    });

    revalidatePath("/", "layout");
    return { ok: true, message: "Marque enregistrée. Le nom est repris dans toute l'interface." };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Pondérations du matching
// ---------------------------------------------------------------------------

export async function updateScoringAction(formData: FormData): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session.role, "admin.settings");

    const number = (key: string) => {
      const value = Number.parseFloat(String(formData.get(key) ?? ""));
      return Number.isFinite(value) && value >= 0 ? value : null;
    };
    const catalogue = number("catalogue");
    const voisines = number("voisines");
    const ionis = number("ionis");

    if (catalogue === null || voisines === null || ionis === null) {
      return { ok: false, message: "Les trois pondérations doivent être des nombres positifs." };
    }
    if (catalogue + voisines + ionis === 0) {
      return { ok: false, message: "Au moins une pondération doit être non nulle." };
    }

    const weights = normalizeWeights({ catalogue, voisines, ionis });
    await setSetting("scoring", weights, session.id);

    // Les scores globaux des affaires en cours changent : on les recalcule.
    const recomputed = await recomputeActiveMatchings(session.id);

    await recordAudit({
      action: "admin.ponderation",
      entity: "Setting",
      entityId: "scoring",
      userId: session.id,
      summary: `Pondération : catalogue ${Math.round(weights.catalogue)} %, voisines ${Math.round(weights.voisines)} %, IONIS ${Math.round(weights.ionis)} %.`,
      payload: weights,
    });

    revalidatePath("/admin");
    revalidatePath("/pipeline");
    return {
      ok: true,
      message: `Pondération enregistrée. ${recomputed} affaire(s) active(s) recalculée(s).`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function updateRemindersAction(formData: FormData): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session.role, "admin.settings");

    const daysBefore = String(formData.get("daysBefore") ?? "")
      .split(/[\s,;]+/)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => b - a);
    const highRelevanceScore = Number.parseInt(String(formData.get("highRelevanceScore") ?? "70"), 10);

    if (daysBefore.length === 0) {
      return { ok: false, message: "Indiquez au moins un jalon de rappel, par exemple : 15 7 3 1 0." };
    }

    await setSetting(
      "reminders",
      {
        daysBefore,
        highRelevanceScore: Number.isFinite(highRelevanceScore) ? Math.max(0, Math.min(100, highRelevanceScore)) : 70,
      },
      session.id,
    );

    revalidatePath("/admin");
    return { ok: true, message: "Rappels enregistrés." };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Utilisateurs
// ---------------------------------------------------------------------------

export async function createUserAction(formData: FormData): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session.role, "admin.users");

    const parsed = z
      .object({
        email: z.string().trim().toLowerCase().email("Adresse électronique invalide."),
        name: z.string().trim().min(2, "Le nom est requis."),
        role: z.string(),
        jobTitle: z.string().trim().optional(),
        password: z.string().min(10, "Le mot de passe doit faire au moins 10 caractères."),
      })
      .parse(Object.fromEntries(formData));

    const existing = await prisma.user.findUnique({ where: { email: parsed.email } });
    if (existing) return { ok: false, message: "Un compte existe déjà avec cette adresse." };

    const user = await prisma.user.create({
      data: {
        email: parsed.email,
        name: parsed.name,
        role: parsed.role as Role,
        jobTitle: parsed.jobTitle || null,
        passwordHash: await hashPassword(parsed.password),
      },
    });

    await recordAudit({
      action: "admin.utilisateur.create",
      entity: "User",
      entityId: user.id,
      userId: session.id,
      summary: `Compte créé : ${user.email} (${user.role}).`,
    });

    revalidatePath("/admin");
    return { ok: true, message: `Compte ${user.email} créé. Communiquez le mot de passe par un canal sûr.` };
  } catch (error) {
    return fail(error);
  }
}

export async function updateUserRoleAction(userId: string, role: string): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session.role, "admin.users");

    if (userId === session.id && role !== "ADMINISTRATEUR") {
      return {
        ok: false,
        message: "Vous ne pouvez pas retirer votre propre rôle d'administrateur : un autre compte devrait le faire.",
      };
    }

    const user = await prisma.user.update({ where: { id: userId }, data: { role: role as Role } });
    await recordAudit({
      action: "admin.utilisateur.role",
      entity: "User",
      entityId: userId,
      userId: session.id,
      summary: `Rôle de ${user.email} changé en ${role}.`,
    });

    revalidatePath("/admin");
    return { ok: true, message: "Rôle mis à jour." };
  } catch (error) {
    return fail(error);
  }
}

export async function toggleUserActiveAction(userId: string, active: boolean): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session.role, "admin.users");

    if (userId === session.id && !active) {
      return { ok: false, message: "Vous ne pouvez pas désactiver votre propre compte." };
    }

    const user = await prisma.user.update({ where: { id: userId }, data: { active } });
    await recordAudit({
      action: "admin.utilisateur.actif",
      entity: "User",
      entityId: userId,
      userId: session.id,
      summary: `Compte ${user.email} ${active ? "réactivé" : "désactivé"}.`,
    });

    revalidatePath("/admin");
    return { ok: true, message: `Compte ${active ? "réactivé" : "désactivé"}.` };
  } catch (error) {
    return fail(error);
  }
}

export async function resetPasswordAction(userId: string, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireSession();
    const password = String(formData.get("password") ?? "");
    // Chacun peut changer son propre mot de passe ; changer celui d'un autre
    // relève de l'administration.
    if (userId !== session.id) assertCan(session.role, "admin.users");

    if (password.length < 10) {
      return { ok: false, message: "Le mot de passe doit faire au moins 10 caractères." };
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(password) },
    });

    await recordAudit({
      action: "admin.motdepasse",
      entity: "User",
      entityId: userId,
      userId: session.id,
      summary: `Mot de passe de ${user.email} réinitialisé.`,
    });

    revalidatePath("/admin");
    return { ok: true, message: "Mot de passe mis à jour." };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Référentiel
// ---------------------------------------------------------------------------

export async function archiveTrainingAction(trainingId: string, archived: boolean): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session.role, "catalogue.edit");

    const training = await prisma.training.update({
      where: { id: trainingId },
      data: { archived, version: { increment: 1 } },
    });

    const recomputed = await recomputeActiveMatchings(session.id);

    await recordAudit({
      action: "catalogue.archive",
      entity: "Training",
      entityId: trainingId,
      userId: session.id,
      summary: `${training.code} ${archived ? "archivée" : "réactivée"}.`,
    });

    revalidatePath("/admin/catalogue");
    revalidatePath("/catalogue");
    return {
      ok: true,
      message: `${training.code} ${archived ? "archivée" : "réactivée"}. ${recomputed} affaire(s) recalculée(s).`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function updateTrainingAction(trainingId: string, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session.role, "catalogue.edit");

    const lines = (key: string) =>
      String(formData.get(key) ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

    const training = await prisma.training.update({
      where: { id: trainingId },
      data: {
        title: String(formData.get("title") ?? "").trim() || undefined,
        objective: String(formData.get("objective") ?? "").trim() || null,
        audience: String(formData.get("audience") ?? "").trim() || null,
        duration: String(formData.get("duration") ?? "").trim() || null,
        modality: String(formData.get("modality") ?? "").trim() || null,
        certification: String(formData.get("certification") ?? "").trim() || null,
        skills: lines("skills"),
        relatedSkills: lines("relatedSkills"),
        keywords: String(formData.get("keywords") ?? "")
          .split(/[,;\n]+/)
          .map((keyword) => keyword.trim().toLowerCase())
          .filter(Boolean),
        version: { increment: 1 },
      },
    });

    const recomputed = await recomputeActiveMatchings(session.id);

    await recordAudit({
      action: "catalogue.update",
      entity: "Training",
      entityId: trainingId,
      userId: session.id,
      summary: `${training.code} modifiée (version ${training.version}).`,
    });

    revalidatePath("/admin/catalogue");
    revalidatePath("/catalogue");
    return { ok: true, message: `Fiche enregistrée en version ${training.version}. ${recomputed} affaire(s) recalculée(s).` };
  } catch (error) {
    return fail(error);
  }
}

/** Recalcule le matching de toutes les affaires actives, sans changer le catalogue. */
export async function recomputeAllAction(): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session.role, "matching.run");
    const count = await recomputeActiveMatchings(session.id);
    revalidatePath("/pipeline");
    return { ok: true, message: `${count} affaire(s) active(s) recalculée(s).` };
  } catch (error) {
    return fail(error);
  }
}
