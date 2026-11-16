"use client";

import { useRef, useState } from "react";
import { Check, Copy, Eye, EyeOff, RefreshCw } from "lucide-react";

import { Input } from "@/components/ui";

/**
 * Alphabet du générateur.
 *
 * Sans `I`, `l`, `1`, `O` ni `0` : un mot de passe initial se transmet
 * souvent à l'oral ou se recopie depuis un écran, et ces caractères se
 * confondent. Un mot de passe illisible finit noté sur un papier.
 */
const LETTRES = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const CHIFFRES = "23456789";
const SIGNES = "!?@#$%*+-=";

/** Un indice uniforme, tiré du générateur cryptographique du navigateur. */
function tirer(max: number): number {
  const buffer = new Uint32Array(1);
  const limite = Math.floor(0xffffffff / max) * max;
  // Rejet des tirages qui tomberaient dans la tranche incomplète : sans lui,
  // les premiers caractères de l'alphabet sortiraient un peu plus souvent.
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= limite);
  return buffer[0] % max;
}

function piocher(source: string): string {
  return source[tirer(source.length)];
}

/**
 * Mot de passe de 14 caractères, dont au moins un chiffre et un signe.
 *
 * Les deux obligatoires sont placés à un rang tiré au sort, et non en tête ni
 * en queue : une position fixe se devine, et retire à la chaîne une partie de
 * ce qu'elle promet.
 */
function engendrer(): string {
  const caracteres = Array.from({ length: 14 }, () => piocher(LETTRES));
  const rangs = new Set<number>();
  while (rangs.size < 2) rangs.add(tirer(caracteres.length));
  const [premier, second] = [...rangs];
  caracteres[premier] = piocher(CHIFFRES);
  caracteres[second] = piocher(SIGNES);
  return caracteres.join("");
}

/**
 * Champ de mot de passe avec générateur.
 *
 * Non contrôlé à dessein : la valeur vit dans le DOM, de sorte que la remise à
 * zéro du formulaire après succès vide réellement le champ. Un état React
 * aurait survécu au `reset` et laissé le mot de passe du compte précédent
 * affiché sous les yeux du suivant.
 */
export function PasswordField({
  name,
  required = false,
  autoComplete = "new-password",
  compact = false,
  placeholder,
}: {
  name: string;
  required?: boolean;
  autoComplete?: string;
  compact?: boolean;
  placeholder?: string;
}) {
  const champ = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);
  const [copie, setCopie] = useState(false);

  function generer() {
    const input = champ.current;
    if (!input) return;
    input.value = engendrer();
    setVisible(true);
    setCopie(false);
    // L'événement natif ne part pas d'une écriture directe : on le pose, pour
    // que la validation du navigateur reconnaisse le champ comme rempli.
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function copier() {
    const valeur = champ.current?.value ?? "";
    if (!valeur) return;
    try {
      await navigator.clipboard.writeText(valeur);
      setCopie(true);
      window.setTimeout(() => setCopie(false), 2000);
    } catch {
      // Le presse-papiers peut être refusé : le mot de passe reste lisible à
      // l'écran, ce qui suffit pour le recopier.
      setVisible(true);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        ref={champ}
        type={visible ? "text" : "password"}
        name={name}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className={compact ? "h-8 w-44 font-mono text-[12px]" : "font-mono"}
      />
      <button
        type="button"
        onClick={generer}
        title="Engendrer un mot de passe"
        aria-label="Engendrer un mot de passe"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-ink-300 bg-white text-ink-600 hover:border-esme-400 hover:text-esme-700"
      >
        <RefreshCw className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        title={visible ? "Masquer" : "Afficher"}
        aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-ink-300 bg-white text-ink-600 hover:border-esme-400 hover:text-esme-700"
      >
        {visible ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
      </button>
      <button
        type="button"
        onClick={copier}
        title="Copier"
        aria-label="Copier le mot de passe"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-ink-300 bg-white text-ink-600 hover:border-esme-400 hover:text-esme-700"
      >
        {copie ? (
          <Check className="size-3.5 text-ok-600" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
      </button>
    </div>
  );
}
