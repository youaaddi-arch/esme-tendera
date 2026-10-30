import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { readStoredFile } from "@/lib/storage";

/**
 * Téléchargement d'une pièce.
 *
 * Les fichiers sont stockés hors du dossier public : ils ne sont accessibles
 * que par cette route, après vérification de la session et du rôle. Un
 * document de la base de connaissances marqué confidentiel exige en plus la
 * permission correspondante.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("Non authentifié", { status: 401 });

  const { id } = await context.params;
  const document = await prisma.document.findUnique({
    where: { id },
    include: { knowledgeEntry: { select: { confidential: true, allowedRoles: true } } },
  });

  if (!document || !document.storagePath) {
    return new NextResponse("Pièce introuvable", { status: 404 });
  }

  if (!can(session.role, document.scope === "CONNAISSANCE" ? "knowledge.read" : "tender.read")) {
    return new NextResponse("Accès refusé", { status: 403 });
  }

  const entry = document.knowledgeEntry;
  if (entry?.confidential) {
    const allowed =
      can(session.role, "knowledge.readConfidential") ||
      (entry.allowedRoles.length > 0 && entry.allowedRoles.includes(session.role));
    if (!allowed) return new NextResponse("Document confidentiel", { status: 403 });
  }

  let buffer: Buffer;
  try {
    buffer = await readStoredFile(document.storagePath);
  } catch {
    return new NextResponse("Fichier absent du stockage", { status: 410 });
  }

  // Le nom d'origine peut contenir des caractères non ASCII ou des guillemets :
  // on l'expose via filename*, et on garde un repli ASCII.
  const fallback = document.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": document.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
