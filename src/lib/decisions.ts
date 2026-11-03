import "server-only";

/**
 * Enregistrement d'une décision GO / NO GO.
 *
 * Extrait de l'action de la fiche parce que deux chemins y mènent désormais :
 * un chargé d'affaires qui tranche sur la fiche, et la reprise d'un tri fait
 * ailleurs — un tableur, le plus souvent. Les règles doivent être les mêmes
 * dans les deux cas, et une règle recopiée finit par exister en deux
 * versions : c'est arrivé au moteur de matching, dont la copie du script et
 * celle de l'application avaient divergé sans que personne le voie.
 *
 * Ce module ne vérifie aucune permission et ne rafraîchit aucune page : il
 * applique la décision et dit ce qu'il a fait. L'appelant reste responsable
 * de savoir qui décide.
 */
import type { GoNoGoStatus, NoGoReason } from "@prisma/client";

import { prisma } from "./db";
import { recordAudit } from "./audit";
import { buildResponseWorkspace } from "./docs/workspace";
import { demanderRetrait } from "./dce/retrait";

export type DecisionInput = {
  status: GoNoGoStatus;
  /** Motivation en clair : elle engage l'équipe et reste au journal. */
  rationale: string;
  reason?: NoGoReason | null;
  /** Lots visés par un GO. Obligatoires dès que la consultation est allotie. */
  lotIds?: string[];
  /**
   * Autorise un GO sur une consultation allotie sans désigner de lots.
   *
   * La règle existe pour une bonne raison : se positionner sans dire sur quoi
   * laisse une information manquante que la rédaction paiera, et c'est le lot
   * qui pilote ensuite le mémoire technique et le chiffrage.
   *
   * Mais la règle sert la décision, elle ne la remplace pas. Quand les lots
   * de l'avis n'ont pas d'intitulé exploitable, refuser le GO revient à
   * perdre la décision pour un détail de forme. Qui décide peut donc passer
   * outre — explicitement, jamais par défaut, et la motivation enregistrée
   * porte la mention, de sorte que celui qui rédigera sache qu'il reste un
   * choix à faire.
   */
  sansLots?: boolean;
  /**
   * Qui décide. Obligatoire, et non facultatif par commodité.
   *
   * Une décision engage l'établissement : elle ouvre une réponse ou elle
   * écarte un marché. Sans décideur, l'historique ne dit plus qui a tranché,
   * et la correction d'une erreur n'a plus d'interlocuteur. Une reprise
   * automatique n'y échappe pas : elle s'exécute au nom de celui qui l'a
   * lancée.
   */
  userId: string;
};

export type DecisionOutcome =
  | { ok: false; message: string }
  | {
      ok: true;
      message: string;
      lots: { id: string; number: string; title: string }[];
      /** Ce qu'il advient du retrait du dossier, s'il a été demandé. */
      retrait: string | null;
    };

export async function recordDecision(
  tenderId: string,
  input: DecisionInput,
): Promise<DecisionOutcome> {
  const { status, userId } = input;
  const rationale = input.rationale.trim();
  const reason = input.reason ?? null;
  const selectedLotIds = input.lotIds ?? [];

  if (!["GO", "NO_GO", "A_DECIDER"].includes(status)) {
    return { ok: false, message: "Décision invalide." };
  }
  if (status === "NO_GO" && !reason) {
    return { ok: false, message: "Un NO GO doit porter un motif." };
  }
  if (!rationale) {
    return { ok: false, message: "Motivez la décision : elle engage l'équipe et reste au journal." };
  }
  // « Autre » ne dit rien à lui seul : c'est précisément le cas où le texte
  // libre porte toute l'information.
  if (status === "NO_GO" && reason === "AUTRE" && rationale.length < 15) {
    return { ok: false, message: "Motif « Autre » : précisez-le en toutes lettres dans la motivation." };
  }

  const lots = await prisma.lot.findMany({
    where: { tenderId },
    orderBy: { number: "asc" },
    select: { id: true, number: true, title: true },
  });

  // Un accord-cadre alloti ne se gagne pas en bloc : se positionner sans dire
  // sur quoi ne veut rien dire, et c'est le lot qui pilote ensuite le mémoire
  // technique et le chiffrage.
  const sansLots = input.sansLots === true;
  if (status === "GO" && lots.length > 0 && selectedLotIds.length === 0 && !sansLots) {
    return {
      ok: false,
      message: `Cette consultation comporte ${lots.length} lot(s) : indiquez celui ou ceux sur lesquels vous vous positionnez.`,
    };
  }

  const connus = new Set(lots.map((lot) => lot.id));
  const inconnus = selectedLotIds.filter((id) => !connus.has(id));
  if (inconnus.length > 0) {
    return { ok: false, message: "Un lot sélectionné n'appartient pas à cette consultation." };
  }

  const retenus = status === "GO" ? lots.filter((lot) => selectedLotIds.includes(lot.id)) : [];

  // La dérogation est inscrite dans la motivation, pas seulement dans un
  // champ : c'est le texte que lira celui qui rédige la réponse.
  const motivation =
    status === "GO" && sansLots && retenus.length === 0 && lots.length > 0
      ? `${rationale}\n\n[GO posé sans désigner de lot, sur décision explicite. Cette consultation ` +
        `comporte ${lots.length} lot(s) : les lots visés restent à préciser avant la rédaction.]`
      : rationale;

  await prisma.decision.updateMany({ where: { tenderId, superseded: false }, data: { superseded: true } });
  await prisma.decision.create({
    data: {
      tenderId,
      status,
      rationale: motivation,
      reason: status === "NO_GO" ? reason : null,
      lotIds: retenus.map((lot) => lot.id),
      lotLabels: retenus.map((lot) => `Lot ${lot.number} — ${lot.title}`),
      decidedById: userId,
    },
  });

  // Le GO ouvre l'espace de préparation ; le NO GO classe l'affaire.
  const stage = status === "GO" ? "PREPARATION" : status === "NO_GO" ? "REJETE_NON_POURSUIVI" : "GO_NO_GO";
  await prisma.tender.update({ where: { id: tenderId }, data: { goNoGo: status, stage } });

  // Le GO déclenche le retrait du dossier.
  //
  // C'est le moment où il devient utile : on ne retire pas les dossiers de
  // deux cents consultations par précaution, on retire celui du marché auquel
  // on a décidé de répondre. Et c'est le moment où il devient urgent, puisque
  // la rédaction commence.
  //
  // Un échec ne remet pas le GO en cause — la décision est prise, et le
  // dossier s'importe à la main si besoin.
  let retrait: string | null = null;
  if (status === "GO") {
    await buildResponseWorkspace(tenderId, userId);
    const issue = await demanderRetrait(tenderId, { userId });
    retrait = issue.cree
      ? " Le retrait du dossier est demandé."
      : issue.raison
        ? ` Retrait non demandé : ${issue.raison.toLowerCase()}`
        : null;
  }

  await recordAudit({
    action: "decision.record",
    entity: "Tender",
    entityId: tenderId,
    tenderId,
    userId,
    summary:
      `Décision ${status}${reason ? ` (${reason})` : ""}` +
      (retenus.length > 0 ? ` — lot(s) ${retenus.map((lot) => lot.number).join(", ")}` : "") +
      ".",
    payload: {
      motivation,
      lots: retenus.map((lot) => `Lot ${lot.number} — ${lot.title}`),
    },
  });

  return {
    ok: true,
    lots: retenus,
    retrait,
    message:
      status === "GO"
        ? (retenus.length > 0
            ? `GO enregistré sur ${retenus.length} lot(s). L'espace de préparation de la réponse a été créé.`
            : "GO enregistré. L'espace de préparation de la réponse a été créé.") + (retrait ?? "")
        : status === "NO_GO"
          ? "NO GO enregistré. L'affaire est classée ; elle reste rouvrable."
          : "Décision remise à « à décider ».",
  };
}
