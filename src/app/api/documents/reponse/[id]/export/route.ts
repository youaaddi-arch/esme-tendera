import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { exportContentType, exportFileName, toDocx, toMarkdown, toXlsx, type ExportFormat } from "@/lib/docs/export";

/** Export d'un document de réponse en Word, Excel ou Markdown. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("Non authentifié", { status: 401 });
  if (!can(session.role, "tender.read")) return new NextResponse("Accès refusé", { status: 403 });

  const { id } = await context.params;
  const format = (new URL(request.url).searchParams.get("format") ?? "docx") as ExportFormat;
  if (!["docx", "xlsx", "md"].includes(format)) {
    return new NextResponse("Format non pris en charge. Formats acceptés : docx, xlsx, md.", { status: 400 });
  }

  const document = await prisma.responseDocument.findUnique({ where: { id } });
  if (!document) return new NextResponse("Document introuvable", { status: 404 });

  const pricingLines =
    format === "xlsx" || document.type === "OFFRE_FINANCIERE"
      ? await prisma.pricingLine.findMany({ where: { tenderId: document.tenderId }, orderBy: { position: "asc" } })
      : [];

  let body: Buffer;
  try {
    if (format === "docx") body = await toDocx(document);
    else if (format === "xlsx") body = await toXlsx(document, pricingLines);
    else body = Buffer.from(toMarkdown(document, pricingLines), "utf8");
  } catch (error) {
    console.error("[export] échec", error);
    return new NextResponse("La génération du fichier a échoué.", { status: 500 });
  }

  await recordAudit({
    action: "document.export",
    entity: "ResponseDocument",
    entityId: document.id,
    tenderId: document.tenderId,
    userId: session.id,
    summary: `Export ${format.toUpperCase()} de « ${document.title} ».`,
  });

  const name = exportFileName(document, format);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": exportContentType(format),
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
