import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ImportTableau } from "@/components/app/veille/import-tableau";
import { Notice, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";

export const metadata = { title: "Importer un tableau de veille" };
export const dynamic = "force-dynamic";

export default async function ImportVeillePage() {
  const session = await requireSession();
  if (!can(session.role, "tender.create")) {
    return (
      <>
        <PageHeader title="Importer un tableau de veille" />
        <div className="p-6">
          <Notice tone="danger">
            Votre rôle ne permet pas de créer des affaires, donc pas d&apos;importer un tableau.
          </Notice>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Importer un tableau de veille"
        subtitle="Les lignes d'un classeur tenu à la main entrent dans le pipeline, à l'étape « AO identifiés »."
        actions={
          <Link
            href="/veille"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ink-300 bg-white px-3 text-[13px] text-esme-800 hover:border-esme-400 hover:bg-esme-50"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Veille
          </Link>
        }
      />

      <div className="space-y-5 p-6">
        <Notice tone="info" title="Ce que l'import fait, et ce qu'il ne fait pas">
          <p>
            Les colonnes sont reconnues par leur intitulé, sous à peu près toutes leurs formes
            usuelles : « Objet du marché » ou « Intitulé », « Acheteur » ou « Client », « Date de
            remise des plis » ou « Date limite ». Il faut au minimum l&apos;objet et l&apos;acheteur :
            sans eux, une ligne n&apos;a pas d&apos;identité et n&apos;est pas importée.
          </p>
          <p className="mt-2">
            Rien n&apos;est deviné. Un montant qu&apos;on ne sait pas lire — une fourchette, un « selon
            besoin » — reste absent plutôt qu&apos;approché. Les dates se lisent à la française :
            03/12/2026 est le 3 décembre. Un avis déjà suivi est reconnu par son identifiant BOAMP ou
            TED quand le tableau porte un lien, sinon par sa référence de consultation, sinon par son
            objet et son acheteur : la fiche existante n&apos;est jamais modifiée.
          </p>
          <p className="mt-2">
            Chaque affaire créée porte sa provenance — nom du fichier, feuille et numéro de ligne — au
            journal d&apos;audit, et le matching est calculé aussitôt.
          </p>
        </Notice>

        <ImportTableau />
      </div>
    </>
  );
}
