import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/**
 * Stockage documentaire local.
 *
 * Les fichiers sont écrits hors du dossier public : ils ne sont jamais servis
 * directement par le serveur web. Leur téléchargement passe par une route
 * d'API qui vérifie la session et les permissions.
 *
 * Pour une mise en production, ce module est le point de substitution d'un
 * stockage objet (S3, Azure Blob) ou d'une bibliothèque SharePoint : seules
 * ces quatre fonctions sont à réimplémenter.
 */

function root(): string {
  // Résolu à chaque appel plutôt qu'au chargement du module : la variable
  // d'environnement peut différer entre la compilation et l'exécution, et une
  // constante calculée à l'import fait tracer tout le projet par le bundler.
  return resolve(process.cwd(), process.env.TENDERA_STORAGE_DIR ?? "./storage");
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Chemin de stockage d'une pièce.
 *
 * Le nom d'origine n'est jamais utilisé tel quel comme chemin : une pièce de
 * DCE peut s'appeler « ../../etc/passwd » ou contenir des séparateurs issus
 * d'une arborescence ZIP. Le fichier est rangé sous son empreinte, et le nom
 * lisible reste en base.
 */
export function storagePathFor(tenderId: string, digest: string, fileName: string): string {
  const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase() : "";
  const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : "";
  return join(tenderId, `${digest}${safeExtension}`);
}

function absolute(relativePath: string): string {
  const base = root();
  const target = resolve(base, relativePath);
  // Double garde : même avec un chemin forgé, on ne sort pas de la racine.
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error("Chemin de stockage hors du dossier autorisé.");
  }
  return target;
}

export async function saveFile(relativePath: string, buffer: Buffer): Promise<void> {
  const target = absolute(relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer);
}

export async function readStoredFile(relativePath: string): Promise<Buffer> {
  return readFile(absolute(relativePath));
}

export async function deleteStoredFile(relativePath: string): Promise<void> {
  try {
    await unlink(absolute(relativePath));
  } catch (error) {
    // Un fichier déjà absent n'est pas une erreur : la suppression est idempotente.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function storageRoot(): string {
  return root();
}
