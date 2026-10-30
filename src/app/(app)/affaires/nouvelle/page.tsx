import { NewTenderForm } from "@/components/app/new-tender-form";
import { Notice, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";

export const metadata = { title: "Nouvelle affaire" };

export default async function NewTenderPage() {
  const session = await requireSession();

  if (!can(session.role, "tender.create")) {
    return (
      <>
        <PageHeader title="Nouvelle affaire" />
        <div className="p-6">
          <Notice tone="danger">Votre rôle ne permet pas de créer une affaire.</Notice>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Nouvelle affaire"
        subtitle="Création à partir d'un lien de consultation ou d'une saisie. Le matching est lancé dès l'enregistrement."
      />
      <div className="max-w-3xl p-6">
        <NewTenderForm />
      </div>
    </>
  );
}
