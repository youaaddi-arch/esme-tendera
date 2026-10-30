import "server-only";

/**
 * Extraction du texte des pièces d'un DCE.
 *
 * Formats pris en charge : PDF, DOCX, XLSX/XLS/CSV, TXT/MD, et ZIP (dont le
 * contenu est extrait pièce par pièce). Chaque extraction renvoie du texte
 * paginé : pour un PDF, la page du document ; pour un classeur, la feuille.
 * Cette pagination est ce qui permet, plus loin, de citer la source d'une
 * information avec son numéro de page.
 *
 * Un format non reconnu n'est pas deviné : le document est stocké, listé, et
 * marqué comme non analysable.
 */

export type ExtractedPage = { page: number; text: string };

export type ExtractionOutcome = {
  pages: ExtractedPage[];
  pageCount: number;
  status: "termine" | "non_supporte" | "echec";
  error?: string;
};

export type ArchiveEntry = { fileName: string; buffer: Buffer };

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm"]);

export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index === -1 ? "" : fileName.slice(index).toLowerCase();
}

export function isArchive(fileName: string): boolean {
  return extensionOf(fileName) === ".zip";
}

/** Déplie une archive. Les dossiers et fichiers système sont ignorés. */
export async function expandArchive(buffer: Buffer): Promise<ArchiveEntry[]> {
  const { default: AdmZip } = await import("adm-zip");
  const zip = new AdmZip(buffer);
  return zip
    .getEntries()
    .filter((entry) => !entry.isDirectory)
    .filter((entry) => {
      const name = entry.entryName.split("/").pop() ?? "";
      // Métadonnées macOS et fichiers cachés : sans intérêt pour l'analyse.
      return !entry.entryName.startsWith("__MACOSX/") && !name.startsWith(".") && name.length > 0;
    })
    .map((entry) => ({ fileName: entry.entryName, buffer: entry.getData() }));
}

export async function extractText(fileName: string, buffer: Buffer): Promise<ExtractionOutcome> {
  const extension = extensionOf(fileName);

  try {
    if (extension === ".pdf") return await extractPdf(buffer);
    if (extension === ".docx") return await extractDocx(buffer);
    if ([".xlsx", ".xls", ".xlsm", ".ods"].includes(extension)) return await extractSpreadsheet(buffer);
    if (TEXT_EXTENSIONS.has(extension)) {
      const text = buffer.toString("utf8");
      return { pages: [{ page: 1, text }], pageCount: 1, status: "termine" };
    }

    return {
      pages: [],
      pageCount: 0,
      status: "non_supporte",
      error:
        extension === ".doc"
          ? "Format .doc (Word 97-2003) non pris en charge. Convertissez la pièce en .docx ou en PDF pour l'analyser."
          : `Format ${extension || "inconnu"} non pris en charge par l'analyse automatique. La pièce reste disponible au téléchargement.`,
    };
  } catch (error) {
    return {
      pages: [],
      pageCount: 0,
      status: "echec",
      error: `Extraction impossible : ${(error as Error).message}`,
    };
  }
}

/**
 * PDF — via pdfjs-dist, en build « legacy » qui fonctionne sous Node.
 *
 * Un PDF scanné sans couche texte renvoie des pages vides : on le signale
 * plutôt que de laisser croire que le document a été analysé.
 */
async function extractPdf(buffer: Buffer): Promise<ExtractionOutcome> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const pages: ExtractedPage[] = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push({ page: index, text });
  }
  await document.destroy();

  const empty = pages.every((page) => page.text.length < 20);
  if (empty) {
    return {
      pages,
      pageCount: pages.length,
      status: "non_supporte",
      error:
        "Le PDF ne contient pas de couche texte : il s'agit probablement d'un document scanné. Une reconnaissance optique (OCR) serait nécessaire ; elle n'est pas installée.",
    };
  }

  return { pages, pageCount: pages.length, status: "termine" };
}

/** DOCX — le texte est récupéré en un bloc, découpé ensuite en pages logiques. */
async function extractDocx(buffer: Buffer): Promise<ExtractionOutcome> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value.replace(/\n{3,}/g, "\n\n").trim();

  // Un Word n'a pas de pages au sens du fichier : on découpe en blocs de
  // ~3 000 caractères pour garder une granularité de citation utilisable.
  const pages: ExtractedPage[] = [];
  const size = 3000;
  for (let index = 0; index * size < text.length; index += 1) {
    pages.push({ page: index + 1, text: text.slice(index * size, (index + 1) * size) });
  }
  if (pages.length === 0) pages.push({ page: 1, text: "" });

  return { pages, pageCount: pages.length, status: "termine" };
}

/** Classeur — une « page » par feuille, en CSV, ce qui préserve les colonnes. */
async function extractSpreadsheet(buffer: Buffer): Promise<ExtractionOutcome> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const pages: ExtractedPage[] = workbook.SheetNames.map((name, index) => {
    const sheet = workbook.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    return { page: index + 1, text: `[Feuille : ${name}]\n${csv}` };
  });
  return { pages, pageCount: pages.length, status: "termine" };
}

/** Texte complet d'un document, pages concaténées. */
export function joinPages(pages: ExtractedPage[]): string {
  return pages.map((page) => page.text).join("\n");
}
