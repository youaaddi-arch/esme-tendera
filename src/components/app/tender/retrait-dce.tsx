"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ScanLine, ShieldAlert } from "lucide-react";

import { ActionButton, ActionForm } from "@/components/app/action-form";
import { Card, CardHeader, Field, Input, Notice } from "@/components/ui";
import {
  answerRetraitCaptchaAction, relancerRetraitAction,
} from "@/app/(app)/affaires/[id]/actions";
import { formatDateTime } from "@/lib/labels";
import type { TenderDetail } from "@/lib/tender-detail";

/**
 * Le retrait du dossier, vu depuis la fiche.
 *
 * Trois choses à montrer, et une seule à faire.
 *
 * Quand le retrait est en route, il faut dire qu'il est en route : sans cela,
 * un dossier demandé et pas encore arrivé ressemble à un dossier manquant, et
 * quelqu'un va l'importer à la main en double.
 *
 * Quand la plateforme oppose une épreuve anti-robot, il faut la montrer et
 * attendre. C'est le seul moment où la machine ne peut rien et où une personne
 * peut tout : elle lit six caractères, et le téléchargement reprend. Résoudre
 * l'épreuve à sa place serait se faire passer pour elle devant un dispositif
 * qui demande justement un humain.
 *
 * Quand le retrait a échoué, il faut dire pourquoi et laisser relancer, sans
 * prétendre que le dossier est là.
 */
export function RetraitDce({
  tenderId,
  retrait,
  canUpload,
}: {
  tenderId: string;
  retrait: TenderDetail["retraits"][number];
  canUpload: boolean;
}) {
  const router = useRouter();
  const enRoute = retrait.etat === "EN_ATTENTE" || retrait.etat === "EN_COURS";

  /**
   * Pendant l'attente, la page se rafraîchit d'elle-même.
   *
   * L'image arrive sans que le navigateur en soit averti — c'est un ouvrier
   * extérieur qui la dépose. Sans ce rappel, il faudrait recharger à la main
   * sans savoir quand, ce qui revient à surveiller une page qui ne dit rien.
   *
   * L'intervalle s'arrête dès que l'attente cesse : rien ne tourne en fond
   * sur une affaire dont le dossier est arrivé.
   */
  useEffect(() => {
    if (!enRoute) return;
    const minuteur = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(minuteur);
  }, [enRoute, router]);

  if (retrait.etat === "REUSSI") return null;

  if (enRoute) {
    return (
      <Card>
        <CardHeader
          title="Retrait du dossier en cours"
          subtitle={`Demandé le ${formatDateTime(retrait.createdAt)}`}
        />
        <div className="flex items-start gap-3 p-5">
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-esme-600" aria-hidden />
          <div className="text-[13px] leading-relaxed text-ink-600">
            <p className="font-medium text-ink-800">Patientez — nous allons chercher le dossier.</p>
            <p className="mt-1">
              {retrait.etat === "EN_ATTENTE"
                ? "La demande est en file. Elle sera prise en charge dans les prochaines minutes."
                : "La plateforme de retrait est en cours de consultation."}
            </p>
            <p className="mt-2 text-ink-500">
              Si elle oppose une vérification anti-robot, son image s&apos;affichera ici et il suffira
              d&apos;en saisir le texte. Cette page se met à jour toute seule.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (retrait.etat === "ATTENTE_CAPTCHA") {
    return (
      <Card className="ring-2 ring-esme-200">
        <CardHeader
          title="Vérification anti-robot à saisir"
          subtitle={
            retrait.captchaDemandeAt
              ? `Image reçue le ${formatDateTime(retrait.captchaDemandeAt)} — tentative ${retrait.tentatives}`
              : `Tentative ${retrait.tentatives}`
          }
        />
        <div className="space-y-4 p-5">
          <div className="flex items-start gap-3 text-[13px] leading-relaxed text-ink-600">
            <ScanLine className="mt-0.5 size-4 shrink-0 text-esme-600" aria-hidden />
            <p>
              La plateforme demande de recopier le texte de cette image avant de livrer le dossier.
              Elle vérifie ainsi qu&apos;une personne est à l&apos;origine du téléchargement : nous ne
              la lisons pas à votre place.
            </p>
          </div>

          {retrait.captchaImage ? (
            // Image fournie par la plateforme de retrait, relayée telle quelle.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={retrait.captchaImage}
              alt="Vérification anti-robot de la plateforme de retrait"
              className="max-w-full rounded-md border border-ink-200 bg-white"
            />
          ) : (
            <Notice tone="warn" title="Image indisponible">
              L&apos;image n&apos;a pas été transmise. Relancez le retrait pour en obtenir une
              nouvelle.
            </Notice>
          )}

          {canUpload ? (
            <ActionForm
              action={(formData) => answerRetraitCaptchaAction(tenderId, formData)}
              submitLabel="Valider et poursuivre le retrait"
              resetOnSuccess
            >
              <input type="hidden" name="retraitId" value={retrait.id} />
              <Field label="Texte de l'image" hint="Les majuscules et minuscules sont sans importance.">
                <Input name="reponse" autoComplete="off" autoFocus required maxLength={40} />
              </Field>
            </ActionForm>
          ) : (
            <Notice tone="warn" title="Saisie réservée">
              Vous n&apos;avez pas le droit d&apos;import sur les dossiers. Demandez à un
              collaborateur habilité de saisir cette vérification.
            </Notice>
          )}
        </div>
      </Card>
    );
  }

  // ÉCHOUE, ABANDONNE
  return (
    <Card>
      <CardHeader title="Retrait du dossier non abouti" />
      <div className="space-y-3 p-5">
        <Notice
          tone={retrait.etat === "ABANDONNE" ? "warn" : "danger"}
          title={
            retrait.etat === "ABANDONNE"
              ? "Abandonné faute de saisie dans le délai"
              : "Échec du retrait automatique"
          }
        >
          <p className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{retrait.echec ?? "Raison non précisée."}</span>
          </p>
        </Notice>
        <p className="text-[13px] leading-relaxed text-ink-600">
          Le dossier peut être relancé, ou importé à la main ci-dessous. Tant qu&apos;aucune pièce
          n&apos;est présente, aucune analyse n&apos;est produite : TENDERA ne prétend pas avoir lu un
          dossier qu&apos;il n&apos;a pas.
        </p>
        {canUpload ? (
          <ActionButton
            action={() => relancerRetraitAction(tenderId)}
            label="Relancer le retrait"
            pendingLabel="Demande en cours…"
          />
        ) : null}
      </div>
    </Card>
  );
}
