import { NextResponse } from "next/server";

import { destroySession, getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export async function POST(request: Request) {
  const session = await getSession();
  if (session) {
    await recordAudit({
      action: "auth.logout",
      entity: "User",
      entityId: session.id,
      userId: session.id,
      summary: `Déconnexion de ${session.email}.`,
    });
  }
  await destroySession();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
