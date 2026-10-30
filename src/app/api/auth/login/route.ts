import { NextResponse } from "next/server";

import { authenticate, createSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/");

  const user = await authenticate(email, password);
  if (!user) {
    // Message volontairement identique pour un mot de passe faux et un compte
    // inconnu : l'interface ne doit pas servir à tester des adresses.
    const url = new URL("/login", request.url);
    url.searchParams.set("erreur", "1");
    if (next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url, { status: 303 });
  }

  await createSession(user);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await recordAudit({
    action: "auth.login",
    entity: "User",
    entityId: user.id,
    userId: user.id,
    summary: `Connexion de ${user.email}.`,
  });

  // On ne redirige que vers un chemin interne, pour éviter toute redirection ouverte.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return NextResponse.redirect(new URL(safeNext, request.url), { status: 303 });
}
