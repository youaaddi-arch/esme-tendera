import { NextResponse } from "next/server";

import { autoriserMaintenance } from "@/lib/maintenance-auth";
import { prisma } from "@/lib/db";
import { ingestDocuments } from "@/lib/dce/ingest";
import { conclure, lireReponse, poserCaptcha, prendreDemande } from "@/lib/dce/retrait";

export const maxDuration = 60;

/**
 * Protocole de l'ouvrier qui retire les dossiers.
 *
 * Un seul fichier plutôt que cinq, et c'est un choix. Ces appels ne sont pas
 * cinq ressources indépendantes : ils forment une conversation, toujours dans
 * le même ordre — prendre une demande, poser l'image, attendre la réponse,
 * verser le fichier, conclure. Les éparpiller obligerait à relire cinq
 * fichiers pour comprendre un enchaînement, et à les tenir d'accord entre eux.
 *
 * L'autorisation est celle de la maintenance : un jeton, parce qu'il n'y a
 * personne derrière un ouvrier. Une session d'administrateur passe aussi, ce
 * qui permet d'éprouver le protocole à la main.
 *
 *     POST /api/retrait        { "action": "prendre", "ouvrier": "actions-1234" }
 *     POST /api/retrait        { "action": "captcha", "id": "...", "image": "data:image/png;base64,..." }
 *     GET  /api/retrait?id=... → l'état, et la réponse dès qu'elle est saisie
 *     POST /api/retrait        { "action": "conclure", "id": "...", "ok": false, "echec": "..." }
 *     POST /api/retrait  (multipart : id, fichier) → verse le dossier et conclut
 *
 * Le versement du dossier passe par un envoi multipart, et c'est là que se
 * trouve la limite de cette architecture : une fonction Vercel n'accepte
 * qu'environ 4,5 Mo de corps de requête. Un dossier de consultation volumineux
 * — et beaucoup le sont — ne passera pas par ici. Il faudra alors que
 * l'ouvrier dépose le fichier directement dans le stockage d'objets et n'en
 * transmette que l'adresse. C'est dit dans le message d'erreur plutôt que
 * découvert sur un dossier qu'on croyait récupéré.
 */

/** Limite de corps d'une fonction Vercel, avec une marge pour l'enveloppe. */
const TAILLE_MAX = 4 * 1024 * 1024;

export async function POST(request: Request) {
  const autorisation = await autoriserMaintenance(request);
  if (!autorisation.ok) return autorisation.reponse;

  const typeContenu = request.headers.get("content-type") ?? "";

  // --- Versement du dossier ------------------------------------------------
  if (typeContenu.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ erreur: "Formulaire illisible." }, { status: 400 });

    const id = String(form.get("id") ?? "").trim();
    const fichier = form.get("fichier");
    if (!id || !(fichier instanceof File)) {
      return NextResponse.json({ erreur: "« id » et « fichier » sont obligatoires." }, { status: 400 });
    }
    if (fichier.size > TAILLE_MAX) {
      return NextResponse.json(
        {
          erreur:
            `Dossier de ${Math.round(fichier.size / 1024 / 1024)} Mo : au-delà de ce qu'une fonction ` +
            "Vercel accepte en corps de requête. L'ouvrier doit le déposer dans le stockage d'objets " +
            "et n'en transmettre que l'adresse ; en attendant, le dossier s'importe à la main.",
        },
        { status: 413 },
      );
    }

    const demande = await prisma.dceRetrait.findUnique({
      where: { id },
      select: { tenderId: true, demandeParId: true },
    });
    if (!demande) return NextResponse.json({ erreur: "Demande inconnue." }, { status: 404 });

    // L'ingestion se fait au nom de qui a demandé le retrait : c'est la
    // personne qui a posé le GO, et c'est elle qui répond du dossier versé.
    // Faute de mieux, le premier administrateur, pour ne pas perdre la trace.
    let userId = demande.demandeParId;
    if (!userId) {
      const secours = await prisma.user.findFirst({
        where: { role: "ADMINISTRATEUR" },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      userId = secours?.id ?? null;
    }
    if (!userId) {
      return NextResponse.json({ erreur: "Aucun utilisateur à qui attribuer l'import." }, { status: 409 });
    }

    const buffer = Buffer.from(await fichier.arrayBuffer());
    const rapport = await ingestDocuments(
      demande.tenderId,
      [{ fileName: fichier.name || "dce.zip", buffer }],
      { userId },
    );

    // Une archive qui ne livre aucune pièce lisible n'est pas un succès : on
    // conclut à l'échec plutôt que de marquer l'affaire « récupéré » avec un
    // dossier vide, ce qui ferait croire à une lecture possible.
    if (rapport.stored.length === 0) {
      const issue = await conclure(id, {
        ok: false,
        echec:
          `Archive reçue (${rapport.total} entrée(s)) mais aucune pièce exploitable : ` +
          `${rapport.unreadable.length} illisible(s), ${rapport.duplicates.length} doublon(s).`,
      });
      return NextResponse.json({ etat: issue.etat, rapport }, { status: 422 });
    }

    const issue = await conclure(id, { ok: true, fichier: fichier.name || "dce.zip" });
    return NextResponse.json({ etat: issue.etat, rapport });
  }

  // --- Conversation --------------------------------------------------------
  const corps = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof corps?.action === "string" ? corps.action : null;

  if (action === "prendre") {
    const ouvrier = typeof corps?.ouvrier === "string" && corps.ouvrier.trim() ? corps.ouvrier.trim() : null;
    if (!ouvrier) {
      return NextResponse.json({ erreur: "« ouvrier » est obligatoire : il sert à la reprise." }, { status: 400 });
    }
    const demande = await prendreDemande(ouvrier);
    return NextResponse.json({ demande });
  }

  if (action === "captcha") {
    const id = typeof corps?.id === "string" ? corps.id : "";
    const image = typeof corps?.image === "string" ? corps.image : "";
    const issue = await poserCaptcha(id, image);
    return issue.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ erreur: issue.raison }, { status: 400 });
  }

  if (action === "conclure") {
    const id = typeof corps?.id === "string" ? corps.id : "";
    if (!id) return NextResponse.json({ erreur: "« id » est obligatoire." }, { status: 400 });
    const issue = await conclure(id, {
      ok: corps?.ok === true,
      echec: typeof corps?.echec === "string" ? corps.echec : null,
      journal: typeof corps?.journal === "string" ? corps.journal.slice(0, 20_000) : null,
      fichier: typeof corps?.fichier === "string" ? corps.fichier : null,
    });
    return NextResponse.json({ etat: issue.etat });
  }

  return NextResponse.json(
    { erreur: "« action » doit valoir prendre, captcha ou conclure.", recu: action },
    { status: 400 },
  );
}

/** L'ouvrier interroge l'état, et reçoit la réponse dès qu'elle est saisie. */
export async function GET(request: Request) {
  const autorisation = await autoriserMaintenance(request);
  if (!autorisation.ok) return autorisation.reponse;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    // Sans identifiant : l'état de la file, utile pour savoir s'il y a lieu
    // de réveiller un ouvrier.
    const parEtat = await prisma.dceRetrait.groupBy({ by: ["etat"], _count: { _all: true } });
    return NextResponse.json({
      file: Object.fromEntries(parEtat.map((ligne) => [ligne.etat, ligne._count._all])),
    });
  }

  const etat = await lireReponse(id);
  return NextResponse.json(etat);
}
