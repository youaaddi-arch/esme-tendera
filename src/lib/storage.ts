import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/**
 * Stockage documentaire.
 *
 * Deux implémentations, choisies à l'exécution :
 *
 *  - **stockage objet** quand `BLOB_READ_WRITE_TOKEN` est présent. C'est le
 *    cas sur un hébergement sans disque persistant, où le système de fichiers
 *    est remis à zéro à chaque déploiement : écrire les pièces d'un DCE sur
 *    disque les perdrait silencieusement ;
 *  - **système de fichiers local** sinon, pour le développement et pour un
 *    serveur dédié avec un volume monté.
 *
 * Dans les deux cas les fichiers restent hors du dossier public : leur
 * téléchargement passe par une route d'API qui vérifie la session et les
 * permissions. Les URL du stockage objet ne sont jamais exposées au
 * navigateur.
 *
 * Pour une bibliothèque SharePoint, c'est ici qu'il faut brancher Microsoft
 * Graph : seules les quatre fonctions d'accès sont à réimplémenter.
 */

function localRoot(): string {
  // Résolu à chaque appel plutôt qu'au chargement du module : la variable
  // d'environnement peut différer entre la compilation et l'exécution, et une
  // constante calculée à l'import fait tracer tout le projet par le bundler.
  return resolve(process.cwd(), process.env.TENDERA_STORAGE_DIR ?? "./storage");
}

/** Vrai quand un stockage objet est configuré. */
export function usesObjectStorage(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
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
  // Le même chemin sert de clé d'objet : on garde des séparateurs « / ».
  return join(tenderId, `${digest}${safeExtension}`).split(sep).join("/");
}

function absolute(relativePath: string): string {
  const base = localRoot();
  const target = resolve(base, relativePath);
  // Double garde : même avec un chemin forgé, on ne sort pas de la racine.
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error("Chemin de stockage hors du dossier autorisé.");
  }
  return target;
}

export async function saveFile(relativePath: string, buffer: Buffer): Promise<void> {
  if (usesObjectStorage()) {
    const { put } = await import("@vercel/blob");
    await put(relativePath, buffer, {
      access: "public",
      // Le chemin porte déjà l'empreinte du contenu : y ajouter un suffixe
      // aléatoire empêcherait de retrouver le fichier depuis la base.
      addRandomSuffix: false,
      // Deux affaires peuvent recevoir la même pièce : l'écrasement est
      // volontaire, le contenu étant identique par construction.
      allowOverwrite: true,
    });
    return;
  }

  const target = absolute(relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer);
}

export async function readStoredFile(relativePath: string): Promise<Buffer> {
  if (usesObjectStorage()) {
    const { head } = await import("@vercel/blob");
    const metadata = await head(relativePath);
    const response = await fetch(metadata.url);
    if (!response.ok) {
      throw new Error(`Lecture du stockage objet impossible : HTTP ${response.status}.`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  return readFile(absolute(relativePath));
}

export async function deleteStoredFile(relativePath: string): Promise<void> {
  if (usesObjectStorage()) {
    const { del, head } = await import("@vercel/blob");
    try {
      const metadata = await head(relativePath);
      await del(metadata.url);
    } catch {
      // Un objet déjà absent n'est pas une erreur : la suppression est idempotente.
    }
    return;
  }

  try {
    await unlink(absolute(relativePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** Description du stockage en place, affichée dans l'administration. */
export function storageDescription(): string {
  return usesObjectStorage()
    ? "Stockage objet (Vercel Blob)."
    : `Système de fichiers local : ${localRoot()}`;
}
