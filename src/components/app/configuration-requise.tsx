import Image from "next/image";

/**
 * Écran affiché quand la base de données n'est pas joignable.
 *
 * Au premier déploiement, l'application est en ligne avant que la base ne soit
 * branchée. Sans cet écran, chaque page renverrait une erreur serveur et
 * donnerait l'impression que le produit est cassé, alors qu'il attend
 * simplement sa configuration. On dit donc ce qui manque et comment le fournir.
 */
export function ConfigurationRequise({ detail }: { detail?: string }) {
  const missing = [
    {
      name: "DATABASE_URL",
      label: "Base de données PostgreSQL",
      done: Boolean(process.env.DATABASE_URL),
      help: "Sur Vercel : onglet Storage → Create Database → Neon. La variable est injectée automatiquement dans le projet.",
    },
    {
      name: "AUTH_SECRET",
      label: "Secret de signature des sessions",
      done: Boolean(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 24),
      help: "Au moins 24 caractères. Générer avec : openssl rand -base64 48",
    },
    {
      name: "TENDERA_CRON_SECRET",
      label: "Jeton de la synchronisation quotidienne",
      done: Boolean(process.env.TENDERA_CRON_SECRET),
      help: "Facultatif pour démarrer. Nécessaire pour que la veille tourne chaque matin.",
      optional: true,
    },
    {
      name: "BLOB_READ_WRITE_TOKEN",
      label: "Stockage des pièces de DCE",
      done: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      help: "Facultatif en local. Sur un hébergement sans disque persistant, les pièces importées seraient perdues à chaque déploiement.",
      optional: true,
    },
  ];

  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink-50 px-6 py-12">
      <div className="w-full max-w-2xl">
        <div className="relative overflow-hidden rounded-t-2xl bg-esme-900 px-8 py-7">
          <div className="tendera-trame pointer-events-none absolute inset-0 opacity-40" aria-hidden />
          <Image
            src="/brand/esme-exed-blanc.png"
            alt="ESME Executive Education"
            width={150}
            height={50}
            className="relative h-9 w-auto object-contain object-left"
            priority
          />
          <h1 className="relative mt-4 text-2xl font-semibold text-white">ESME TENDERA</h1>
          <p className="relative mt-1 text-sm text-esme-100/85">
            L&apos;application est déployée. Il lui manque sa configuration pour démarrer.
          </p>
        </div>

        <div className="rounded-b-2xl border border-t-0 border-ink-200 bg-white px-8 py-7">
          <ul className="space-y-4">
            {missing.map((item) => (
              <li key={item.name} className="flex gap-3">
                <span
                  aria-hidden
                  className={
                    item.done
                      ? "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-ok-100 text-[11px] font-bold text-ok-700"
                      : item.optional
                        ? "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-ink-100 text-[11px] font-bold text-ink-500"
                        : "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-danger-100 text-[11px] font-bold text-danger-700"
                  }
                >
                  {item.done ? "✓" : item.optional ? "·" : "!"}
                </span>
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-esme-900">
                    {item.label}
                    {item.optional && !item.done ? (
                      <span className="ml-1.5 text-[12px] font-normal text-ink-400">facultatif</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 font-mono text-[12px] text-ink-500">{item.name}</p>
                  {!item.done ? (
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-600">{item.help}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-6 rounded-xl border border-ink-200 bg-ink-50 px-4 py-3">
            <p className="text-[13px] font-medium text-esme-900">Une fois les variables en place</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
              Créez le schéma et chargez le référentiel depuis un poste disposant de la chaîne de
              connexion :
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-white px-3 py-2 font-mono text-[12px] leading-relaxed text-ink-700">
{`npm run db:push
npm run db:seed`}
            </pre>
            <p className="mt-2 text-[12px] text-ink-500">
              Puis redéployez. Les comptes de démarrage et leur mot de passe initial figurent au
              README.
            </p>
          </div>

          {detail ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-[12px] text-ink-500 hover:text-esme-600">
                Détail technique
              </summary>
              <p className="mt-1.5 break-words rounded-lg bg-ink-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-600">
                {detail}
              </p>
            </details>
          ) : null}
        </div>
      </div>
    </main>
  );
}

/** Vrai quand la configuration minimale est présente. */
export function configurationComplete(): boolean {
  return Boolean(
    process.env.DATABASE_URL && process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 24,
  );
}
