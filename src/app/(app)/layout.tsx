import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/shell";
import { ConfigurationRequise, configurationComplete } from "@/components/app/configuration-requise";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { permissionsFor, roleLabels } from "@/lib/rbac";
import { getSetting } from "@/lib/settings";

// Toutes les pages de ce segment dépendent de la session et des données en
// base : aucune n'est pré-rendue à la compilation.
export const dynamic = "force-dynamic";

/**
 * Enveloppe de l'application authentifiée.
 *
 * Toutes les pages sous ce segment exigent une session. Le rail de navigation
 * n'affiche que les entrées correspondant aux permissions du rôle.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!configurationComplete()) return <ConfigurationRequise />;

  const session = await getSession();
  if (!session) redirect("/login");

  // Une base injoignable doit se dire, pas se traduire en erreur serveur sur
  // chaque page : au premier déploiement, l'application est en ligne avant que
  // la base ne soit branchée.
  let brand;
  let unreadAlerts = 0;
  try {
    [brand, unreadAlerts] = await Promise.all([
      getSetting("brand"),
      prisma.notification.count({
        where: { readAt: null, OR: [{ userId: session.id }, { userId: null }] },
      }),
    ]);
  } catch (error) {
    return <ConfigurationRequise detail={(error as Error).message} />;
  }

  return (
    <AppShell
      user={{
        name: session.name,
        email: session.email,
        roleLabel: roleLabels[session.role],
        permissions: permissionsFor(session.role),
      }}
      brand={{
        productName: brand.productName,
        signature: brand.signature,
        logoDark: brand.logoDark,
      }}
      unreadAlerts={unreadAlerts}
    >
      {children}
    </AppShell>
  );
}
