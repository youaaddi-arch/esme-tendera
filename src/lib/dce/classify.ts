import type { DocumentKind } from "@prisma/client";

/**
 * Identification du type d'une pièce du DCE.
 *
 * Deux indices, pondérés : le nom du fichier, qui suit presque toujours une
 * convention lisible (« RC.pdf », « CCTP_lot1.pdf », « DC1.pdf »), et le
 * contenu, qui tranche quand le nom est muet (« Document 3.pdf »).
 *
 * Le score de confiance est rendu à l'interface : en dessous de 0,5, la pièce
 * est présentée comme « type à confirmer » et reste modifiable à la main.
 */

type Rule = {
  kind: DocumentKind;
  /** Motifs sur le nom de fichier — les plus fiables. */
  fileName: RegExp[];
  /** Motifs sur le contenu, cherchés dans les premiers milliers de caractères. */
  content: RegExp[];
};

const RULES: Rule[] = [
  {
    kind: "RC",
    fileName: [/\brc\b/i, /r[eè]glement[_\s-]*(de[_\s-]*)?consultation/i, /\brdc\b/i],
    content: [/r[èe]glement\s+de\s+(la\s+)?consultation/i, /conditions\s+de\s+remise\s+des\s+(offres|plis)/i],
  },
  {
    kind: "CCTP",
    fileName: [/\bcctp\b/i, /cahier.*clauses.*techniques/i, /\bctp\b/i],
    content: [/cahier\s+des\s+clauses\s+techniques\s+particuli[èe]res/i, /\bcctp\b/i],
  },
  {
    kind: "CCAP",
    fileName: [/\bccap\b/i, /cahier.*clauses.*administratives/i],
    content: [/cahier\s+des\s+clauses\s+administratives\s+particuli[èe]res/i, /\bccap\b/i],
  },
  {
    kind: "AE",
    fileName: [/\bae\b/i, /acte[_\s-]*d?[_\s-]*engagement/i, /\batri\b/i],
    content: [/acte\s+d['’]engagement/i],
  },
  {
    kind: "BPU",
    fileName: [/\bbpu\b/i, /bordereau.*prix.*unitaires?/i],
    content: [/bordereau\s+des\s+prix\s+unitaires/i],
  },
  {
    kind: "DPGF",
    fileName: [/\bdpgf\b/i, /d[ée]composition.*prix.*global/i],
    content: [/d[ée]composition\s+du\s+prix\s+global\s+et\s+forfaitaire/i],
  },
  {
    kind: "DQE",
    fileName: [/\bdqe\b/i, /d[ée]tail.*quantitatif.*estimatif/i],
    content: [/d[ée]tail\s+quantitatif\s+estimatif/i],
  },
  {
    kind: "CADRE_MEMOIRE",
    fileName: [
      /cadre.*(m[ée]moire|r[ée]ponse)/i, /m[ée]moire[_\s-]*technique/i,
      /trame.*m[ée]moire/i, /cadre[_\s-]*de[_\s-]*r[ée]ponse/i,
    ],
    content: [
      /cadre\s+de\s+(r[ée]ponse|m[ée]moire)/i,
      /le\s+candidat\s+(d[ée]crira|pr[ée]cisera|compl[ée]tera)/i,
    ],
  },
  { kind: "DC1", fileName: [/\bdc\s*-?1\b/i, /lettre[_\s-]*de[_\s-]*candidature/i], content: [/\bdc1\b/i, /lettre\s+de\s+candidature/i] },
  { kind: "DC2", fileName: [/\bdc\s*-?2\b/i, /d[ée]claration[_\s-]*du[_\s-]*candidat/i], content: [/\bdc2\b/i, /d[ée]claration\s+du\s+candidat/i] },
  { kind: "DC4", fileName: [/\bdc\s*-?4\b/i, /sous[_\s-]*traitance/i], content: [/\bdc4\b/i, /d[ée]claration\s+de\s+sous-traitance/i] },
  {
    kind: "ATTESTATION",
    fileName: [/attestation/i, /urssaf/i, /fiscale/i, /vigilance/i, /kbis/i, /assurance/i],
    content: [/attestation\s+(de|d['’])/i, /attestation\s+de\s+vigilance/i],
  },
  {
    kind: "AVIS",
    fileName: [/avis[_\s-]*(de[_\s-]*)?(publicit[ée]|march[ée]|aapc)/i, /\baapc\b/i, /\bboamp\b/i],
    content: [/avis\s+d['’]appel\s+public\s+[àa]\s+la\s+concurrence/i, /avis\s+de\s+march[ée]/i],
  },
  {
    kind: "ANNEXE",
    fileName: [/annexe/i, /\bann\b/i],
    content: [/^annexe\s+n?°?\s*\d/im],
  },
];

export type Classification = { kind: DocumentKind; confidence: number; reason: string };

export function classifyDocument(fileName: string, text: string): Classification {
  // Le chemin dans une archive compte : « DCE/02 - CCTP/piece.pdf » est parlant.
  const haystackName = fileName.replace(/[_-]/g, " ");
  const sample = text.slice(0, 6000);

  let best: Classification = {
    kind: "AUTRE",
    confidence: 0,
    reason: "Aucun motif reconnu dans le nom du fichier ni dans son contenu.",
  };

  for (const rule of RULES) {
    const nameHit = rule.fileName.some((pattern) => pattern.test(haystackName));
    const contentHit = rule.content.some((pattern) => pattern.test(sample));

    let confidence = 0;
    let reason = "";
    if (nameHit && contentHit) {
      confidence = 0.95;
      reason = "Nom de fichier et contenu concordants.";
    } else if (nameHit) {
      confidence = 0.75;
      reason = "Reconnu d'après le nom du fichier.";
    } else if (contentHit) {
      confidence = 0.6;
      reason = "Reconnu d'après le contenu du document.";
    }

    if (confidence > best.confidence) best = { kind: rule.kind, confidence, reason };
  }

  // Un classeur sans motif reconnu est très probablement une pièce de prix.
  if (best.confidence === 0 && /\.(xlsx|xls|xlsm|csv)$/i.test(fileName)) {
    return {
      kind: "BPU",
      confidence: 0.35,
      reason: "Classeur sans motif explicite : supposé pièce de prix. À confirmer.",
    };
  }

  return best;
}

/** Pièces attendues dans un dossier de consultation de formation. */
export const EXPECTED_DCE_KINDS: DocumentKind[] = ["RC", "CCTP", "AE"];

/** Pièces habituellement exigées au dossier de réponse. */
export const EXPECTED_RESPONSE_KINDS: { kind: DocumentKind; label: string; mandatory: boolean }[] = [
  { kind: "DC1", label: "DC1 — Lettre de candidature", mandatory: true },
  { kind: "DC2", label: "DC2 — Déclaration du candidat", mandatory: true },
  { kind: "AE", label: "Acte d'engagement complété", mandatory: true },
  { kind: "CADRE_MEMOIRE", label: "Mémoire technique", mandatory: true },
  { kind: "BPU", label: "Pièce financière (BPU / DPGF / DQE)", mandatory: true },
  { kind: "ATTESTATION", label: "Attestations fiscales et sociales", mandatory: true },
  { kind: "DC4", label: "DC4 — Déclaration de sous-traitance", mandatory: false },
];
