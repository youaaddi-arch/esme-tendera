import "server-only";

import type { PricingLine, ResponseDocument } from "@prisma/client";

import { readContent } from "../tender-detail";

/**
 * Export des documents de réponse.
 *
 * Word et Excel sont les formats attendus par les acheteurs publics ; le
 * Markdown sert aux relectures rapides et au versionnage. Dans tous les cas,
 * les marqueurs « [À COMPLÉTER] » sont conservés tels quels : un export ne
 * doit jamais faire disparaître une lacune du document.
 */

export type ExportFormat = "docx" | "xlsx" | "md";

export function exportFileName(document: ResponseDocument, format: ExportFormat): string {
  const base = document.title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${base || "document"}.${format}`;
}

export function exportContentType(format: ExportFormat): string {
  if (format === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (format === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "text/markdown; charset=utf-8";
}

/** Markdown : la forme la plus simple, et la plus facile à relire en diff. */
export function toMarkdown(document: ResponseDocument, pricingLines: PricingLine[] = []): string {
  const content = readContent(document);
  const lines: string[] = [`# ${document.title}`, ""];

  if (content.frameworkNote) lines.push(`> ${content.frameworkNote}`, "");
  if (content.note) lines.push(`> ${content.note}`, "");

  if (document.gaps.length > 0) {
    lines.push("## Informations à compléter", "");
    for (const gap of document.gaps) lines.push(`- ${gap}`);
    lines.push("");
  }

  if (content.fields) {
    lines.push("## Champs du formulaire", "");
    for (const [label, value] of Object.entries(content.fields)) {
      lines.push(`- **${label}** : ${value}`);
    }
    lines.push("");
  }

  for (const section of content.sections ?? []) {
    lines.push(
      `## ${section.heading}${section.weight !== null ? ` _(critère ${section.weight} %)_` : ""}`,
      "",
      section.body,
      "",
    );
  }

  if (pricingLines.length > 0) {
    lines.push("## Offre financière", "", "| Prestation | Unité | Quantité | Prix unitaire HT |", "| --- | --- | --- | --- |");
    for (const line of pricingLines) {
      lines.push(
        `| ${line.label} | ${line.unit ?? ""} | ${line.quantity?.toString() ?? ""} | ${line.unitPrice?.toString() ?? "à renseigner"} |`,
      );
    }
    lines.push("");
  }

  lines.push(
    "",
    "---",
    `_Document généré par ESME TENDERA le ${new Date().toLocaleDateString("fr-FR")}. ` +
      "Les mentions « [À COMPLÉTER] » signalent des informations qui doivent être fournies par un rédacteur : " +
      "elles ne sont jamais renseignées automatiquement._",
  );

  return lines.join("\n");
}

/** Word — format attendu pour un mémoire technique. */
export async function toDocx(document: ResponseDocument): Promise<Buffer> {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType } = await import("docx");
  const content = readContent(document);

  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({ text: document.title, heading: HeadingLevel.TITLE }),
  ];

  if (content.frameworkNote) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: content.frameworkNote, italics: true, color: "4A5570" })],
        spacing: { after: 200 },
      }),
    );
  }
  if (content.note) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: content.note, italics: true, color: "4A5570" })],
        spacing: { after: 200 },
      }),
    );
  }

  if (content.fields) {
    children.push(new Paragraph({ text: "Champs du formulaire", heading: HeadingLevel.HEADING_1 }));
    for (const [label, value] of Object.entries(content.fields)) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `${label} : `, bold: true }), new TextRun({ text: value })],
          spacing: { after: 80 },
        }),
      );
    }
  }

  for (const section of content.sections ?? []) {
    children.push(
      new Paragraph({
        text: section.weight !== null ? `${section.heading} (${section.weight} %)` : section.heading,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 320, after: 120 },
      }),
    );

    for (const block of section.body.split("\n")) {
      const text = block.trim();
      if (!text) continue;

      // Les puces du brouillon sont rendues comme telles dans le Word.
      if (text.startsWith("- ") || text.startsWith("• ")) {
        children.push(new Paragraph({ text: text.slice(2), bullet: { level: 0 } }));
        continue;
      }
      // Les intertitres en gras du brouillon deviennent des titres de niveau 2.
      const bold = /^\*\*(.+)\*\*$/.exec(text);
      if (bold) {
        children.push(new Paragraph({ text: bold[1], heading: HeadingLevel.HEADING_2 }));
        continue;
      }
      // Les lacunes restent visibles, en couleur d'alerte.
      if (text.includes("[À COMPLÉTER]")) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text, color: "B47811", bold: true })],
            spacing: { after: 120 },
          }),
        );
        continue;
      }
      children.push(new Paragraph({ text, spacing: { after: 120 } }));
    }
  }

  if (document.gaps.length > 0) {
    children.push(
      new Paragraph({ text: "Informations restant à fournir", heading: HeadingLevel.HEADING_1, spacing: { before: 400 } }),
    );
    for (const gap of document.gaps) {
      children.push(new Paragraph({ text: gap, bullet: { level: 0 } }));
    }
  }

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 600 },
      children: [
        new TextRun({
          text: `Document généré par ESME TENDERA le ${new Date().toLocaleDateString("fr-FR")}. À relire et compléter avant dépôt.`,
          size: 16,
          color: "94A0BA",
          italics: true,
        }),
      ],
    }),
  );

  const file = new Document({
    creator: "ESME TENDERA",
    title: document.title,
    description: "Document de réponse à un appel d'offres",
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22 } },
        // Bleu ESME sur les titres : la charte s'applique aussi aux exports.
        title: { run: { size: 44, bold: true, color: "174290" } },
        heading1: { run: { size: 28, bold: true, color: "174290" } },
        heading2: { run: { size: 24, bold: true, color: "162259" } },
      },
    },
    sections: [{ properties: {}, children }],
  });

  return Buffer.from(await Packer.toBuffer(file));
}

/** Excel — pour l'offre financière, à reporter dans le bordereau de l'acheteur. */
export async function toXlsx(document: ResponseDocument, pricingLines: PricingLine[]): Promise<Buffer> {
  const XLSX = await import("xlsx");

  const rows = pricingLines.map((line) => ({
    Prestation: line.label,
    Unité: line.unit ?? "",
    Quantité: line.quantity === null ? "" : Number(line.quantity),
    "Coût pédagogique HT": line.costPedago === null ? "" : Number(line.costPedago),
    "Coût formateur HT": line.costTrainer === null ? "" : Number(line.costTrainer),
    "Frais annexes HT": line.costOther === null ? "" : Number(line.costOther),
    "Prix unitaire HT": line.unitPrice === null ? "" : Number(line.unitPrice),
    "Taux de marge": line.marginRate === null ? "" : line.marginRate,
    Origine: line.priceOrigin,
    Note: line.note ?? "",
  }));

  if (rows.length === 0) {
    rows.push({
      Prestation: "Aucune ligne reprise du bordereau de l'acheteur",
      Unité: "", Quantité: "", "Coût pédagogique HT": "", "Coût formateur HT": "",
      "Frais annexes HT": "", "Prix unitaire HT": "", "Taux de marge": "",
      Origine: "", Note: "Importez le BPU, le DQE ou la DPGF pour reprendre sa structure.",
    });
  }

  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = [{ wch: 52 }, { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 40 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Offre financière");

  const notice = XLSX.utils.aoa_to_sheet([
    [document.title],
    [],
    ["Aucun tarif n'est pré-rempli par ESME TENDERA."],
    ["Le catalogue ESME Executive Education ne publie pas de prix : les montants doivent être saisis."],
    ["Vérifiez les totaux avant report dans le bordereau de l'acheteur."],
    [],
    [`Export du ${new Date().toLocaleDateString("fr-FR")}`],
  ]);
  notice["!cols"] = [{ wch: 96 }];
  XLSX.utils.book_append_sheet(workbook, notice, "Avertissement");

  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer);
}
