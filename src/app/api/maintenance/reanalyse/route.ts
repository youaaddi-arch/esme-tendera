import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { autoriserMaintenance } from "@/lib/maintenance-auth";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { boampParIdweb, tedParNumeros } from "@/lib/veille/reprise";
import { clefIdentifiant } from "@/lib/veille/liens";
import type { NormalizedNotice } from "@/lib/veille/types";

export const maxDuration = 60;

/**
 * Ré-analyse des avis déjà intégrés.
 *
 * Les affaires ont été créées par des versions antérieures de l'extraction,
 * dont deux défauts mesurés : l'adresse du dossier de consultation n'était
 * jamais lue — zéro sur soixante et onze avis réels, alors que cent
 * trente-trois champs la portaient — et les montants étaient étiquetés
 * « montant global » quels qu'ils soient, y compris lorsqu'ils venaient du
 * champ « valeur totale estimée », voire d'un lot isolé.
 *
 * Réparer l'extraction ne répare pas les fiches : elles portent le résultat
 * du jour où elles ont été créées. Cette route les repasse.
 *
 * L'avis n'est pas conservé en base — seul son identifiant l'est — donc la
 * ré-analyse le **redemande à la source**. C'est plus lent qu'une relecture
 * locale, mais c'est aussi la seule façon de récupérer une information qu'on
 * n'avait jamais extraite : on ne relit pas ce qu'on n'a pas gardé.
 *
 *     POST /api/maintenance/reanalyse?taille=20
 *     POST /api/maintenance/reanalyse?taille=20&appliquer=1
 *     POST /api/maintenance/reanalyse?taille=20&appliquer=1&forcer=1
 */

/** Champs que l'analyseur d'avis possède, et qu'il peut donc corriger. */
const CHAMPS = [
  "buyer", "title", "objectSummary", "deadlineAt", "publishedAt",
  "amountKind", "amountMinEur", "amountMaxEur", "amountNote",
  "dceSourceUrl", "depotUrl", "procedure", "region", "executionPlace",
] as const;

function comparable(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return "";
  if (valeur instanceof Date) return valeur.toISOString();
  if (typeof valeur === "object" && "toString" in (valeur as object)) return String(valeur);
  return String(valeur);
}

export async function POST(request: Request) {
  const autorisation = await autoriserMaintenance(request);
  if (!autorisation.ok) return autorisation.reponse;
  const { par } = autorisation;

  const url = new URL(request.url);
  const taille = Math.min(Math.max(Number(url.searchParams.get("taille") ?? 20) || 20, 1), 40);
  const appliquer = url.searchParams.get("appliquer") === "1";
  /**
   * Par défaut, une affaire modifiée à la main est épargnée.
   *
   * Quelqu'un qui a corrigé un montant ou une date sur la fiche a regardé
   * l'avis ; l'écraser avec une relecture automatique défait son travail sans
   * le dire. Ces affaires sont signalées, et « forcer » les inclut quand on
   * veut vraiment tout reprendre.
   */
  const forcer = url.searchParams.get("forcer") === "1";

  const candidates = await prisma.tender.findMany({
    where: {
      sourceNoticeId: { not: null },
      sourceConnector: { key: { in: ["boamp", "ted"] } },
      // Une affaire déjà ré-analysée porte la provenance de son montant.
      OR: [{ depotUrl: null }, { amountNote: null }],
    },
    orderBy: { createdAt: "asc" },
    take: taille,
    select: {
      id: true, reference: true, sourceNoticeId: true,
      sourceConnector: { select: { key: true } },
      ...Object.fromEntries(CHAMPS.map((c) => [c, true])),
    } as Prisma.TenderSelect,
  });

  // Les avis TED se demandent en une seule requête.
  const numerosTed = candidates
    .filter((t) => (t as { sourceConnector?: { key: string } }).sourceConnector?.key === "ted")
    .map((t) => clefIdentifiant(String((t as { sourceNoticeId: string }).sourceNoticeId)));
  const avisTed = numerosTed.length > 0 ? await tedParNumeros(numerosTed) : [];
  const tedParClef = new Map(avisTed.map((a) => [clefIdentifiant(a.sourceNoticeId), a]));

  const rapport: {
    reference: string;
    source: string;
    etat: "corrigee" | "inchangee" | "introuvable" | "epargnee";
    changements: { champ: string; avant: string; apres: string }[];
  }[] = [];
  let corrigees = 0;

  for (const brute of candidates) {
    const t = brute as unknown as Record<string, unknown> & {
      id: string; reference: string; sourceNoticeId: string;
      sourceConnector: { key: string } | null;
    };
    const source = t.sourceConnector?.key ?? "?";

    // Modifiée à la main ? On regarde la trace plutôt que de deviner.
    if (!forcer) {
      const edition = await prisma.auditEvent.findFirst({
        where: { tenderId: t.id, action: "tender.edit" },
        select: { id: true },
      });
      if (edition) {
        rapport.push({ reference: t.reference, source, etat: "epargnee", changements: [] });
        continue;
      }
    }

    let avis: NormalizedNotice | null = null;
    if (source === "ted") avis = tedParClef.get(clefIdentifiant(t.sourceNoticeId)) ?? null;
    else avis = await boampParIdweb(t.sourceNoticeId);

    if (!avis) {
      rapport.push({ reference: t.reference, source, etat: "introuvable", changements: [] });
      continue;
    }

    const neuf: Record<string, unknown> = {
      buyer: avis.buyer,
      title: avis.title,
      objectSummary: avis.objectSummary ?? null,
      deadlineAt: avis.deadlineAt ?? null,
      publishedAt: avis.publishedAt ?? null,
      amountKind: avis.amountKind,
      amountMinEur: avis.amountMinEur ?? null,
      amountMaxEur: avis.amountMaxEur ?? null,
      amountNote: avis.amountNote ?? null,
      dceSourceUrl: avis.dceUrl ?? null,
      depotUrl: avis.depotUrl ?? null,
      procedure: avis.procedure ?? null,
      region: avis.region ?? null,
      executionPlace: avis.executionPlace ?? null,
    };

    // Une information perdue ne remplace pas une information tenue : si la
    // source ne publie plus un champ qu'on avait, on garde l'ancien.
    const changements: { champ: string; avant: string; apres: string }[] = [];
    const data: Record<string, unknown> = {};
    for (const champ of CHAMPS) {
      const avant = comparable(t[champ]);
      const apres = comparable(neuf[champ]);
      if (apres === "" && avant !== "") continue;
      if (avant === apres) continue;
      changements.push({ champ, avant: avant.slice(0, 60), apres: apres.slice(0, 60) });
      data[champ] = neuf[champ];
    }

    if (changements.length === 0) {
      rapport.push({ reference: t.reference, source, etat: "inchangee", changements: [] });
      continue;
    }

    if (appliquer) {
      await prisma.tender.update({ where: { id: t.id }, data });
      await recordAudit({
        action: "tender.reanalyse",
        entity: "Tender",
        entityId: t.id,
        tenderId: t.id,
        userId: par.userId ?? undefined,
        actor: par.acteur,
        summary: `Avis ré-analysé : ${changements.map((c) => c.champ).join(", ")}.`,
        payload: { changements },
      });
      corrigees += 1;
    }
    rapport.push({ reference: t.reference, source, etat: "corrigee", changements });
  }

  const restantes = await prisma.tender.count({
    where: {
      sourceNoticeId: { not: null },
      sourceConnector: { key: { in: ["boamp", "ted"] } },
      OR: [{ depotUrl: null }, { amountNote: null }],
    },
  });

  return NextResponse.json({
    simulation: !appliquer,
    par: par.acteur,
    examinees: candidates.length,
    corrigees,
    restantes,
    termine: candidates.length === 0,
    rapport,
  });
}
