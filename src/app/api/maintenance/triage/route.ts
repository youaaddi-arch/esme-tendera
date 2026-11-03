import { NextResponse } from "next/server";

import { autoriserMaintenance } from "@/lib/maintenance-auth";
import { prisma } from "@/lib/db";
import { recordDecision } from "@/lib/decisions";
import { clefIdentifiant, identifiantDepuisLien } from "@/lib/veille/liens";
import { proximite, SEUIL_CERTITUDE, type Ligne } from "@/lib/veille/reprise";
import type { NoGoReason } from "@prisma/client";

export const maxDuration = 60;

/**
 * Reprise d'un tri GO / NO GO fait ailleurs.
 *
 * Le premier tri d'une cellule d'appels d'offres se fait souvent dans un
 * tableur, avant que la plateforme n'existe ou pendant qu'on l'adopte. Le
 * reporter à la main, ligne par ligne, est long et fautif ; ne pas le reporter
 * du tout revient à perdre le travail.
 *
 * Cette route le reporte, en obéissant aux mêmes règles que la fiche — mêmes
 * règles parce que c'est le même `recordDecision`, pas une copie.
 *
 * Trois refus qui méritent d'être dits, parce qu'ils expliquent pourquoi
 * certaines lignes ne passeront pas :
 *
 *  - une ligne qu'on ne rapproche pas d'une affaire **avec certitude** est
 *    signalée, jamais appliquée au plus ressemblant. Poser un GO sur la
 *    mauvaise consultation ouvre une réponse à un marché qu'on n'a pas
 *    choisi ; poser un NO GO sur la mauvaise la fait disparaître ;
 *  - un NO GO sans motif est refusé, comme sur la fiche ;
 *  - un GO sur une consultation allotie exige ses lots. La route les cherche
 *    dans le texte de la colonne « lots » du tableau, et refuse si elle n'en
 *    reconnaît aucun — plutôt que de poser un GO sur tous les lots, ce que
 *    personne n'a décidé.
 *
 *     POST /api/maintenance/triage
 *     { "lignes": [ { acheteur, objet, limite, decision, remarques, lien, lots } ],
 *       "motifNoGo": "HORS_PERIMETRE", "simuler": true }
 */

/** Ce que le tableau peut porter en plus, pour viser les lots d'un GO. */
type LigneTriage = Ligne & { lots?: string };

function normaliser(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Lots visés, reconnus dans le texte de la colonne « lots » du tableau.
 *
 * Le tableau écrit les lots en prose — « 2 lots : Lot 1 Formation de
 * sensibilisation…, Lot 2 Formation à la maîtrise… ». On ne cherche donc pas
 * une égalité mais une présence : un lot de la base est visé si les mots
 * significatifs de son intitulé se retrouvent dans ce texte.
 *
 * Le seuil est volontairement haut. Un lot retenu à tort engage une réponse
 * sur un marché qu'on n'a pas choisi de servir, et c'est le genre d'erreur
 * qu'on ne découvre qu'au moment de chiffrer.
 */
function lotsVises(
  texte: string,
  lots: { id: string; number: string; title: string }[],
): { retenus: string[]; detail: string[] } {
  const prose = normaliser(texte);
  if (!prose) return { retenus: [], detail: [] };

  const retenus: string[] = [];
  const detail: string[] = [];
  for (const lot of lots) {
    const mots = normaliser(lot.title).split(" ").filter((m) => m.length >= 5);
    if (mots.length === 0) continue;
    const presents = mots.filter((m) => prose.includes(m)).length;
    const part = presents / mots.length;
    if (part >= 0.6) {
      retenus.push(lot.id);
      detail.push(`Lot ${lot.number} (${Math.round(part * 100)} %)`);
    }
  }
  return { retenus, detail };
}

type Corps = { lignes?: unknown; motifNoGo?: unknown; simuler?: unknown };

export async function POST(request: Request) {
  const autorisation = await autoriserMaintenance(request);
  if (!autorisation.ok) return autorisation.reponse;
  const { par } = autorisation;

  // Une décision exige un décideur, et un jeton ne désigne personne : cette
  // route n'accepte donc que la session d'un administrateur.
  if (!par.userId) {
    return NextResponse.json(
      {
        erreur:
          "Cette route exige une session d'administrateur : une décision doit être attribuable à " +
          "quelqu'un, et un jeton de maintenance ne désigne personne.",
      },
      { status: 403 },
    );
  }

  const corps = (await request.json().catch(() => null)) as Corps | null;
  const brutes = Array.isArray(corps?.lignes) ? corps.lignes : null;
  if (!brutes || brutes.length === 0) {
    return NextResponse.json({ erreur: "Fournissez « lignes »." }, { status: 400 });
  }
  if (brutes.length > 200) {
    return NextResponse.json({ erreur: "Au plus 200 lignes par appel." }, { status: 400 });
  }

  const motifNoGo = (typeof corps?.motifNoGo === "string" ? corps.motifNoGo : "") as NoGoReason | "";
  const simuler = corps?.simuler !== false;

  const lignes: LigneTriage[] = brutes.map((brute) => {
    const l = (brute ?? {}) as Record<string, unknown>;
    const texte = (cle: string) => (typeof l[cle] === "string" ? (l[cle] as string) : "");
    const lien = texte("lien");
    const depuisLien = identifiantDepuisLien(lien);
    return {
      acheteur: texte("acheteur"),
      objet: texte("objet"),
      decision: texte("decision"),
      limite: texte("limite"),
      remarques: texte("remarques"),
      lien,
      lots: texte("lots"),
      identifiant: depuisLien?.identifiant ?? null,
      source: depuisLien?.source ?? "INCONNU",
    };
  });

  // Seules les lignes tranchées nous concernent : « à arbitrer » et « à
  // vérifier » restent dans « AO identifiés », ce qui est leur place.
  const tranchees = lignes.filter((l) => {
    const d = l.decision.trim().toUpperCase();
    return d === "GO" || d.startsWith("NO GO") || d === "NO_GO";
  });
  if (tranchees.some((l) => l.decision.trim().toUpperCase() !== "GO") && !motifNoGo) {
    return NextResponse.json(
      { erreur: "« motifNoGo » est obligatoire dès qu'une ligne porte un NO GO." },
      { status: 400 },
    );
  }

  // Les affaires candidates : non archivées et non encore tranchées. Une
  // affaire déjà décidée n'est pas retouchée par une reprise — la décision la
  // plus récente est celle de quelqu'un qui a regardé la fiche.
  const affaires = await prisma.tender.findMany({
    where: { archived: false, goNoGo: "A_DECIDER" },
    select: {
      id: true, reference: true, buyer: true, title: true, objectSummary: true, deadlineAt: true,
      sourceNoticeId: true,
      lots: { orderBy: { number: "asc" }, select: { id: true, number: true, title: true } },
    },
  });

  /**
   * Les affaires indexées par l'identifiant de leur avis.
   *
   * C'est la correspondance exacte, et elle passe devant la ressemblance.
   * Mesuré : les fiches de PFC-Ouest et de RTE avaient été créées depuis les
   * identifiants TED lus dans les liens du tableau, et le triage les notait
   * ensuite à 36 % et 35 % en essayant de les redeviner par les mots — le
   * libellé d'acheteur du tableau ne ressemble pas à celui du JOUE, et l'avis
   * TED ne publie pas de date limite, donc rien ne venait confirmer. La
   * correspondance était en main et on la jetait.
   */
  const parIdentifiant = new Map(
    affaires
      .filter((a) => a.sourceNoticeId)
      .map((a) => [clefIdentifiant(a.sourceNoticeId as string), a]),
  );

  const rapport: {
    acheteur: string;
    decision: string;
    reference: string | null;
    proximite: number;
    lots: string[];
    applique: boolean;
    message: string;
  }[] = [];

  let appliquees = 0;

  for (const ligne of tranchees) {
    // L'identifiant d'abord : un avis désigné par son numéro ne se devine pas.
    const exacte = ligne.identifiant ? parIdentifiant.get(clefIdentifiant(ligne.identifiant)) : undefined;

    const classees = exacte
      ? [{ a: exacte, s: 1 }]
      : affaires.map((a) => ({ a, s: proximite(ligne, a) })).sort((x, y) => y.s - x.s);
    const meilleure = classees[0];

    if (!meilleure || meilleure.s < SEUIL_CERTITUDE) {
      rapport.push({
        acheteur: ligne.acheteur,
        decision: ligne.decision,
        reference: meilleure?.a.reference ?? null,
        proximite: Math.round((meilleure?.s ?? 0) * 100),
        lots: [],
        applique: false,
        message:
          "Aucune affaire rapprochée avec certitude : la décision n'est pas posée. " +
          "La poser au plus ressemblant ouvrirait ou classerait le mauvais marché.",
      });
      continue;
    }

    const cible = meilleure.a;
    const estGo = ligne.decision.trim().toUpperCase() === "GO";

    let lotIds: string[] = [];
    let detailLots: string[] = [];
    if (estGo && cible.lots.length > 0) {
      const vises = lotsVises(ligne.lots ?? "", cible.lots);
      lotIds = vises.retenus;
      detailLots = vises.detail;
      if (lotIds.length === 0) {
        rapport.push({
          acheteur: ligne.acheteur,
          decision: ligne.decision,
          reference: cible.reference,
          proximite: Math.round(meilleure.s * 100),
          lots: [],
          applique: false,
          message:
            `Affaire trouvée, mais aucun de ses ${cible.lots.length} lot(s) n'est reconnu dans la ` +
            "colonne « lots » du tableau. Un GO sur tous les lots n'a été décidé par personne : " +
            "à poser sur la fiche.\n" +
            // Les deux textes côte à côte : c'est ce qu'il faut sous les yeux
            // pour voir si le rapprochement est faisable ou si les lots de
            // l'avis n'ont simplement pas d'intitulé exploitable.
            `Lots de l'affaire : ${cible.lots.map((l) => `${l.number} « ${l.title || "(sans intitulé)"} »`).join(" ; ")}\n` +
            `Colonne « lots » du tableau : ${(ligne.lots ?? "").replace(/\s+/g, " ").slice(0, 300) || "(vide)"}`,
        });
        continue;
      }
    }

    // La remarque du tableau devient la motivation : c'est ce sur quoi la
    // décision s'appuyait, et la trace doit le montrer plutôt qu'une phrase
    // fabriquée après coup.
    const motivation =
      (ligne.remarques.trim() ||
        `Décision reportée du tri manuel du ${new Date().toLocaleDateString("fr-FR")}.`) +
      `\n\n[Reprise d'un tri hors plateforme, ligne « ${ligne.acheteur} — ${ligne.objet} ».]`;

    if (simuler) {
      rapport.push({
        acheteur: ligne.acheteur,
        decision: ligne.decision,
        reference: cible.reference,
        proximite: Math.round(meilleure.s * 100),
        lots: detailLots,
        applique: false,
        message: "Serait appliquée.",
      });
      continue;
    }

    const issue = await recordDecision(cible.id, {
      status: estGo ? "GO" : "NO_GO",
      rationale: motivation,
      reason: estGo ? null : (motifNoGo as NoGoReason),
      lotIds,
      userId: par.userId,
    });

    if (issue.ok) appliquees += 1;
    rapport.push({
      acheteur: ligne.acheteur,
      decision: ligne.decision,
      reference: cible.reference,
      proximite: Math.round(meilleure.s * 100),
      lots: detailLots,
      applique: issue.ok,
      message: issue.message,
    });
  }

  return NextResponse.json({
    simulation: simuler,
    par: par.acteur,
    lignesRecues: lignes.length,
    lignesTranchees: tranchees.length,
    appliquees,
    rapport,
  });
}
