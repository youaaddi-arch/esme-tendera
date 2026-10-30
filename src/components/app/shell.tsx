"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Bell, Building2, Calendar, FileSearch, FolderKanban, GraduationCap, LayoutDashboard,
  Library, LogOut, Menu, Radar, Settings, ShieldCheck, Table2, X,
} from "lucide-react";

import { cx } from "@/components/ui";
import type { Permission } from "@/lib/rbac";

export type NavUser = {
  name: string;
  email: string;
  roleLabel: string;
  permissions: Permission[];
};

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Permission requise pour voir l'entrée. */
  permission?: Permission;
};

type NavGroup = { title: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    title: "Pilotage",
    items: [
      { href: "/", label: "Tableau de bord", icon: LayoutDashboard },
      { href: "/pipeline", label: "Pipeline Kanban", icon: FolderKanban },
      { href: "/affaires", label: "Vue tableau", icon: Table2 },
      { href: "/calendrier", label: "Calendrier", icon: Calendar },
      { href: "/alertes", label: "Alertes", icon: Bell },
    ],
  },
  {
    title: "Sourcing",
    items: [
      { href: "/veille", label: "Veille", icon: Radar, permission: "veille.run" },
      { href: "/catalogue", label: "Référentiel formations", icon: GraduationCap, permission: "catalogue.read" },
      { href: "/ionis", label: "Groupe IONIS", icon: Building2, permission: "catalogue.read" },
    ],
  },
  {
    title: "Production",
    items: [
      { href: "/base-connaissances", label: "Base de connaissances", icon: Library, permission: "knowledge.read" },
      { href: "/controle", label: "Contrôle de dossier", icon: FileSearch, permission: "quality.run" },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/admin", label: "Paramètres", icon: Settings, permission: "admin.settings" },
      { href: "/admin/journal", label: "Journal d'audit", icon: ShieldCheck, permission: "audit.read" },
    ],
  },
];

export function AppShell({
  user,
  brand,
  unreadAlerts,
  children,
}: {
  user: NavUser;
  brand: { productName: string; signature: string; logoDark: string };
  unreadAlerts: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleGroups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || user.permissions.includes(item.permission)),
  })).filter((group) => group.items.length > 0);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  const rail = (
    <nav aria-label="Navigation principale" className="flex h-full w-64 shrink-0 flex-col bg-esme-900 text-white">
      <div className="relative overflow-hidden border-b border-white/10 px-5 py-5">
        <div className="tendera-trame pointer-events-none absolute inset-0 opacity-40" aria-hidden />
        <Link href="/" className="relative flex flex-col gap-2.5" onClick={() => setMobileOpen(false)}>
          <Image
            src={brand.logoDark}
            alt="ESME Executive Education"
            width={132}
            height={44}
            className="h-9 w-auto object-contain object-left"
            priority
          />
          <span>
            <span className="block text-[15px] font-semibold tracking-tight">{brand.productName}</span>
            <span className="mt-0.5 block text-[11px] leading-tight text-esme-200/80">{brand.signature}</span>
          </span>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {visibleGroups.map((group) => (
          <div key={group.title} className="mb-5">
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-esme-200/55">
              {group.title}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors",
                        active
                          ? "bg-esme-700 font-medium text-white"
                          : "text-esme-100/85 hover:bg-white/8 hover:text-white",
                      )}
                    >
                      <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                      <span className="truncate">{item.label}</span>
                      {item.href === "/alertes" && unreadAlerts > 0 ? (
                        <span className="ml-auto rounded-full bg-framboise-400 px-1.5 text-[10px] font-semibold leading-4 text-white">
                          {unreadAlerts > 99 ? "99+" : unreadAlerts}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-white/10 px-4 py-3">
        <p className="truncate text-[13px] font-medium">{user.name}</p>
        <p className="truncate text-[11px] text-esme-200/70">{user.roleLabel}</p>
        <form action="/api/auth/logout" method="post" className="mt-2">
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-esme-100/80 transition-colors hover:bg-white/8 hover:text-white"
          >
            <LogOut className="size-3.5" strokeWidth={1.75} aria-hidden />
            Se déconnecter
          </button>
        </form>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <div className="hidden lg:block">{rail}</div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-esme-950/60"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0">{rail}</div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-ink-200 bg-white px-4 py-2.5 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            className="rounded-lg p-1.5 text-esme-800 hover:bg-esme-50"
            aria-label={mobileOpen ? "Fermer la navigation" : "Ouvrir la navigation"}
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <span className="text-sm font-semibold text-esme-900">{brand.productName}</span>
        </div>

        <main id="contenu" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
