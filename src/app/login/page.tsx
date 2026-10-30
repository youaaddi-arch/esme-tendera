import Image from "next/image";
import { redirect } from "next/navigation";

import { Button, Field, Input, Notice } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { getSetting } from "@/lib/settings";

export const metadata = { title: "Connexion" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string; next?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/");

  const params = await searchParams;
  const brand = await getSetting("brand");

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Panneau de marque — bleu ESME, trame et gimmick chevron de la charte. */}
      <aside className="relative hidden overflow-hidden bg-esme-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="tendera-trame pointer-events-none absolute inset-0 opacity-50" aria-hidden />
        <div
          className="pointer-events-none absolute -right-24 top-1/4 size-80 rounded-full bg-framboise-400/20 blur-3xl"
          aria-hidden
        />

        <Image
          src={brand.logoDark}
          alt="ESME Executive Education"
          width={180}
          height={60}
          className="relative h-12 w-auto object-contain object-left"
          priority
        />

        <div className="relative max-w-md">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">{brand.productName}</h1>
          <p className="mt-3 text-lg text-esme-100/90">{brand.signature}</p>
          <p className="mt-8 text-sm leading-relaxed text-esme-200/80">
            Veille quotidienne, analyse des dossiers de consultation, matching avec le catalogue
            {" "}{brand.institution}, décision Go / No Go, préparation et contrôle des réponses.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-esme-100/85">
            <li className="tendera-chevron">Référentiel pédagogique issu du catalogue officiel</li>
            <li className="tendera-chevron">Scores explicables et corrigeables</li>
            <li className="tendera-chevron">Traçabilité complète des décisions</li>
          </ul>
        </div>

        <p className="relative text-xs text-esme-200/60">
          {brand.institution} — {brand.group}
        </p>
      </aside>

      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden">
            <Image
              src={brand.logoLight}
              alt="ESME Executive Education"
              width={160}
              height={54}
              className="mb-6 h-10 w-auto object-contain"
              priority
            />
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-esme-900">Connexion</h2>
          <p className="mt-1 text-sm text-ink-500">Accès réservé aux collaborateurs autorisés.</p>

          {params.erreur ? (
            <Notice tone="danger" className="mt-5">
              Identifiants incorrects, ou compte désactivé.
            </Notice>
          ) : null}

          <form action="/api/auth/login" method="post" className="mt-6 space-y-4">
            <input type="hidden" name="next" value={params.next ?? "/"} />
            <Field label="Adresse professionnelle" required>
              <Input
                type="email"
                name="email"
                autoComplete="username"
                required
                placeholder="prenom.nom@esme.fr"
              />
            </Field>
            <Field label="Mot de passe" required>
              <Input type="password" name="password" autoComplete="current-password" required />
            </Field>
            <Button type="submit" className="w-full" size="lg">
              Se connecter
            </Button>
          </form>

          <p className="mt-8 text-xs leading-relaxed text-ink-500">
            Première installation : les comptes de démarrage sont créés par le script
            d&apos;initialisation. Le mot de passe initial doit être changé dès la première
            connexion, depuis les paramètres d&apos;administration.
          </p>
        </div>
      </main>
    </div>
  );
}
