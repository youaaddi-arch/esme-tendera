import "server-only";

/**
 * Conduite d'un retrait de dossier de consultation.
 *
 * Un retrait met en jeu trois acteurs qui ne sont pas au même endroit :
 *
 *   l'application, qui crée la demande quand un GO est enregistré ;
 *   un ouvrier extérieur, qui ouvre un navigateur et navigue ;
 *   une personne, qui lit l'épreuve anti-robot quand il y en a une.
 *
 * Aucun des trois ne peut tenir l'état des deux autres. L'ouvrier est un
 * processus qui peut mourir, la personne peut s'absenter vingt minutes, et
 * l'application ne peut pas garder un navigateur ouvert — Vercel borne ses
 * fonctions à la minute. L'état vit donc en base, et chaque fonction d'ici
 * est une transition que n'importe lequel des trois peut déclencher.
 *
 * Ce module ne navigue pas lui-même et n'ouvre aucun navigateur : il tient le
 * registre. La navigation est dans `scripts/retrait-dce-captcha.mjs`.
 */
import type { PrismaClient } from "@prisma/client";

import { prisma } from "../db";
import { recordAudit } from "../audit";
import { notify } from "../notifications";

/**
 * Au-delà de ce délai, une demande prise par un ouvrier est reprise.
 *
 * Un ouvrier qui meurt en cours de route — un runner interrompu, une
 * exécution annulée — laisserait sa demande « en cours » pour toujours. On ne
 * peut pas distinguer un ouvrier mort d'un ouvrier lent, alors on tranche par
 * le temps : la navigation prend des secondes, l'attente d'une réponse
 * humaine des minutes, et ce plafond couvre largement les deux.
 */
const PRISE_PERIMEE_MINUTES = 40;

/** Au-delà, personne n'a répondu : la demande est abandonnée, pas réessayée. */
const ATTENTE_CAPTCHA_MINUTES = 30;

/** Nombre de passages à l'épreuve avant de renoncer. */
const TENTATIVES_MAX = 3;

type Client = PrismaClient | typeof prisma;

/**
 * Demande le retrait du dossier d'une affaire.
 *
 * Sans adresse de retrait, il n'y a rien à demander : l'avis ne publiait pas
 * de lien vers le dossier, et c'est une information, pas un échec. On ne crée
 * pas de demande vouée à échouer pour la forme.
 *
 * Une demande déjà en cours n'est pas doublée. Deux ouvriers sur la même
 * consultation consommeraient deux épreuves anti-robot, donc deux fois la
 * patience de quelqu'un, pour un seul dossier.
 */
export async function demanderRetrait(
  tenderId: string,
  options: { userId?: string | null; db?: Client } = {},
): Promise<{ cree: boolean; raison?: string; id?: string }> {
  const db = options.db ?? prisma;

  const tender = await db.tender.findUnique({
    where: { id: tenderId },
    select: { id: true, reference: true, dceStatus: true, dceSourceUrl: true },
  });
  if (!tender) return { cree: false, raison: "Affaire inconnue." };
  if (!tender.dceSourceUrl) {
    return { cree: false, raison: "L'avis ne publie pas d'adresse de retrait du dossier." };
  }
  if (tender.dceStatus === "RECUPERE" || tender.dceStatus === "IMPORTE_MANUELLEMENT") {
    return { cree: false, raison: "Le dossier est déjà présent sur l'affaire." };
  }

  const enCours = await db.dceRetrait.findFirst({
    where: { tenderId, etat: { in: ["EN_ATTENTE", "EN_COURS", "ATTENTE_CAPTCHA"] } },
    select: { id: true },
  });
  if (enCours) return { cree: false, raison: "Un retrait est déjà en cours.", id: enCours.id };

  const demande = await db.dceRetrait.create({
    data: { tenderId, url: tender.dceSourceUrl, demandeParId: options.userId ?? null },
    select: { id: true },
  });

  await recordAudit({
    action: "dce.retrait.demande",
    entity: "DceRetrait",
    entityId: demande.id,
    tenderId,
    userId: options.userId ?? undefined,
    summary: "Retrait du dossier demandé.",
  });

  return { cree: true, id: demande.id };
}

/**
 * Attribue une demande à un ouvrier.
 *
 * La reprise des demandes périmées se fait ici plutôt que par une tâche
 * dédiée : c'est le seul moment où quelqu'un regarde la file, et une demande
 * oubliée n'a d'importance que lorsqu'un ouvrier est disponible pour elle.
 */
export async function prendreDemande(
  ouvrier: string,
  options: { db?: Client } = {},
): Promise<{ id: string; tenderId: string; reference: string; url: string; tentatives: number } | null> {
  const db = options.db ?? prisma;
  const maintenant = new Date();

  await db.dceRetrait.updateMany({
    where: {
      etat: { in: ["EN_COURS", "ATTENTE_CAPTCHA"] },
      priseAt: { lt: new Date(maintenant.getTime() - PRISE_PERIMEE_MINUTES * 60_000) },
    },
    data: { etat: "EN_ATTENTE", ouvrier: null, priseAt: null, captchaImage: null, captchaDemandeAt: null },
  });

  const candidate = await db.dceRetrait.findFirst({
    where: { etat: "EN_ATTENTE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, tenderId: true, url: true, tentatives: true, tender: { select: { reference: true } } },
  });
  if (!candidate) return null;

  // La prise est conditionnée à l'état lu : deux ouvriers qui regardent la
  // file en même temps ne peuvent pas emporter la même demande.
  const prise = await db.dceRetrait.updateMany({
    where: { id: candidate.id, etat: "EN_ATTENTE" },
    data: { etat: "EN_COURS", ouvrier, priseAt: maintenant },
  });
  if (prise.count === 0) return null;

  return {
    id: candidate.id,
    tenderId: candidate.tenderId,
    reference: candidate.tender.reference,
    url: candidate.url,
    tentatives: candidate.tentatives,
  };
}

/** L'ouvrier dépose l'image de l'épreuve et passe la main. */
export async function poserCaptcha(
  id: string,
  imageDataUri: string,
  options: { db?: Client } = {},
): Promise<{ ok: boolean; raison?: string }> {
  const db = options.db ?? prisma;

  if (!/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(imageDataUri)) {
    return { ok: false, raison: "L'image doit être un data URI d'image en base64." };
  }
  // Une épreuve anti-robot pèse quelques dizaines de kilo-octets ; au-delà,
  // c'est autre chose qu'on nous donne, et la base n'est pas un entrepôt.
  if (imageDataUri.length > 400_000) {
    return { ok: false, raison: "Image trop lourde pour une épreuve anti-robot (400 ko maximum)." };
  }

  const demande = await db.dceRetrait.findUnique({
    where: { id },
    select: { etat: true, tenderId: true, tentatives: true, tender: { select: { reference: true, title: true } } },
  });
  if (!demande) return { ok: false, raison: "Demande inconnue." };
  // Deux états acceptent une image : l'ouvrier vient de prendre la demande, ou
  // il en est à son deuxième essai parce que la saisie précédente a été
  // refusée par la plateforme.
  //
  // N'accepter que « en cours » interdisait le second essai, puisque la
  // première image fait justement passer en « attente de saisie ». La règle
  // des trois tentatives existait, et rien ne pouvait l'atteindre — défaut
  // trouvé en éprouvant la boucle avec une réponse volontairement fausse.
  if (demande.etat !== "EN_COURS" && demande.etat !== "ATTENTE_CAPTCHA") {
    return {
      ok: false,
      raison:
        demande.etat === "ABANDONNE"
          ? "La demande a été abandonnée : le délai de saisie était dépassé."
          : `La demande n'est pas en cours (${demande.etat}).`,
    };
  }

  await db.dceRetrait.update({
    where: { id },
    data: {
      etat: "ATTENTE_CAPTCHA",
      captchaImage: imageDataUri,
      captchaDemandeAt: new Date(),
      reponse: null,
      reponduAt: null,
      reponduById: null,
      tentatives: { increment: 1 },
    },
  });

  // Sans alerte, la page « patientez » attendrait quelqu'un qui ne sait pas
  // qu'on l'attend.
  await notify({
    kind: "DCE_DISPONIBLE",
    severity: "IMPORTANT",
    title: `Saisie attendue — ${demande.tender.reference}`,
    body:
      "Le retrait du dossier demande une vérification anti-robot. " +
      "Ouvrez l'affaire, onglet DCE, pour lire l'image et saisir le texte.",
    tenderId: demande.tenderId,
  });

  return { ok: true };
}

/** Ce que l'ouvrier attend : la réponse, ou l'ordre d'abandonner. */
export async function lireReponse(
  id: string,
  options: { db?: Client } = {},
): Promise<{ etat: string; reponse: string | null; abandonner: boolean }> {
  const db = options.db ?? prisma;
  const demande = await db.dceRetrait.findUnique({
    where: { id },
    select: { etat: true, reponse: true, captchaDemandeAt: true },
  });
  if (!demande) return { etat: "INCONNUE", reponse: null, abandonner: true };

  const trop =
    demande.etat === "ATTENTE_CAPTCHA" &&
    demande.captchaDemandeAt !== null &&
    Date.now() - demande.captchaDemandeAt.getTime() > ATTENTE_CAPTCHA_MINUTES * 60_000;

  if (trop) {
    await db.dceRetrait.update({
      where: { id },
      data: { etat: "ABANDONNE", echec: "Personne n'a saisi la vérification dans le délai." },
    });
    return { etat: "ABANDONNE", reponse: null, abandonner: true };
  }

  return {
    etat: demande.etat,
    reponse: demande.reponse,
    abandonner: demande.etat === "ABANDONNE" || demande.etat === "ECHOUE",
  };
}

/** Une personne a lu l'image et saisi le texte. */
export async function repondreCaptcha(
  id: string,
  reponse: string,
  userId: string,
  options: { db?: Client } = {},
): Promise<{ ok: boolean; raison?: string }> {
  const db = options.db ?? prisma;
  const texte = reponse.trim();
  if (!texte) return { ok: false, raison: "Saisissez le texte de l'image." };
  if (texte.length > 40) return { ok: false, raison: "Réponse trop longue pour une vérification." };

  const demande = await db.dceRetrait.findUnique({
    where: { id },
    select: { etat: true, tenderId: true },
  });
  if (!demande) return { ok: false, raison: "Demande inconnue." };
  if (demande.etat !== "ATTENTE_CAPTCHA") {
    return {
      ok: false,
      raison:
        demande.etat === "ABANDONNE"
          ? "Le délai est dépassé : le retrait a été abandonné. Relancez-le."
          : `Aucune saisie attendue pour l'instant (${demande.etat}).`,
    };
  }

  await db.dceRetrait.update({
    where: { id },
    data: { reponse: texte, reponduAt: new Date(), reponduById: userId },
  });

  await recordAudit({
    action: "dce.retrait.captcha",
    entity: "DceRetrait",
    entityId: id,
    tenderId: demande.tenderId,
    userId,
    summary: "Vérification anti-robot saisie par un utilisateur.",
  });

  return { ok: true };
}

/**
 * L'ouvrier rend son verdict.
 *
 * Un échec ne renvoie pas la demande en file indéfiniment : au-delà de trois
 * passages, l'obstacle n'est pas la malchance, et insister ne ferait que
 * redemander une saisie à quelqu'un pour le même résultat.
 */
export async function conclure(
  id: string,
  issue: { ok: boolean; echec?: string | null; journal?: string | null; fichier?: string | null },
  options: { db?: Client } = {},
): Promise<{ etat: string }> {
  const db = options.db ?? prisma;
  const demande = await db.dceRetrait.findUnique({
    where: { id },
    select: { tenderId: true, tentatives: true, tender: { select: { reference: true } } },
  });
  if (!demande) return { etat: "INCONNUE" };

  if (issue.ok) {
    await db.dceRetrait.update({
      where: { id },
      data: {
        etat: "REUSSI",
        echec: null,
        fichier: issue.fichier ?? null,
        journal: issue.journal ?? null,
        captchaImage: null,
      },
    });
    await db.tender.update({
      where: { id: demande.tenderId },
      data: { dceStatus: "RECUPERE", dceFailureReason: null },
    });
    await recordAudit({
      action: "dce.retrait.reussi",
      entity: "DceRetrait",
      entityId: id,
      tenderId: demande.tenderId,
      actor: "ouvrier",
      summary: issue.fichier ? `Dossier récupéré : ${issue.fichier}.` : "Dossier récupéré.",
    });
    return { etat: "REUSSI" };
  }

  const reessayer = demande.tentatives < TENTATIVES_MAX;
  await db.dceRetrait.update({
    where: { id },
    data: {
      etat: reessayer ? "EN_ATTENTE" : "ECHOUE",
      ouvrier: null,
      priseAt: null,
      captchaImage: null,
      captchaDemandeAt: null,
      reponse: null,
      echec: issue.echec ?? "Échec non précisé.",
      journal: issue.journal ?? null,
    },
  });

  if (!reessayer) {
    await db.tender.update({
      where: { id: demande.tenderId },
      data: { dceStatus: "NON_RECUPERE", dceFailureReason: issue.echec ?? "Retrait automatique en échec." },
    });
    await notify({
      kind: "DCE_NON_RECUPERE",
      severity: "IMPORTANT",
      title: `Dossier non récupéré — ${demande.tender.reference}`,
      body:
        `${issue.echec ?? "Échec du retrait."} ` +
        "Le dossier reste à importer à la main depuis l'onglet DCE.",
      tenderId: demande.tenderId,
    });
  }

  await recordAudit({
    action: reessayer ? "dce.retrait.echec" : "dce.retrait.abandon",
    entity: "DceRetrait",
    entityId: id,
    tenderId: demande.tenderId,
    actor: "ouvrier",
    summary: `${issue.echec ?? "Échec"} (tentative ${demande.tentatives}/${TENTATIVES_MAX}).`,
  });

  return { etat: reessayer ? "EN_ATTENTE" : "ECHOUE" };
}

/** La demande vivante d'une affaire, pour l'affichage. */
export async function retraitEnCours(tenderId: string, options: { db?: Client } = {}) {
  const db = options.db ?? prisma;
  return db.dceRetrait.findFirst({
    where: { tenderId, etat: { in: ["EN_ATTENTE", "EN_COURS", "ATTENTE_CAPTCHA"] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, etat: true, captchaImage: true, captchaDemandeAt: true,
      tentatives: true, createdAt: true, echec: true,
    },
  });
}
