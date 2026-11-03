/**
 * Lecture des liens d'agrégateurs.
 *
 * Module volontairement pur : aucune base, aucun réseau, aucun marquage
 * serveur. C'est du décodage de chaînes, et cela doit pouvoir se tester sans
 * monter l'application — la raison même pour laquelle ce code ne vit plus
 * dans le module de reprise, qui est réservé au serveur.
 */

/**
 * Identifiant officiel d'un avis, déduit du lien d'un agrégateur.
 *
 * Les tableaux de tri portent des liens de France Marchés, dont les adresses
 * encodent l'identifiant de la source. Trois formes, et la troisième a coûté
 * plusieurs lignes perdues :
 *
 *   /files/BOAMP/26-92262.html                → BOAMP 26-92262
 *   /appel-offre/13joue007253682026-2026-…    → TED 725368-2026
 *   /appel-offre/3boamp2694667-2026-…         → BOAMP 26-94667
 *
 * La troisième colle l'année au numéro. Lue telle quelle — « 2694667 » — elle
 * ne désigne rien, et la ligne retombait sur la recherche plein texte alors
 * que son identifiant exact était là. Vérifié sur deux cas : 2694667 est bien
 * l'accord-cadre du CROUS de Rennes-Bretagne, et 26103940 les formations des
 * agents du Département de la Savoie.
 *
 * Cette lecture vivait dans un script de préparation, à côté du dépôt. Elle
 * est ici pour être testée, et pour que la route accepte les lignes du tableau
 * telles quelles, lien compris.
 */
export function identifiantDepuisLien(lien: string): { source: "BOAMP" | "TED"; identifiant: string } | null {
  if (!lien) return null;

  // TED d'abord : son motif est le plus spécifique.
  const joue = lien.match(/joue0*(\d{4,8})(20\d\d)/i);
  if (joue) return { source: "TED", identifiant: `${Number(joue[1])}-${joue[2]}` };

  const fichier = lien.match(/\/BOAMP\/(\d{2}-\d+)\.html/i);
  if (fichier) return { source: "BOAMP", identifiant: fichier[1] };

  // Forme agrégée : l'année est collée au numéro.
  const agrege = lien.match(/boamp(\d{2})(\d{4,7})\b/i);
  if (agrege) return { source: "BOAMP", identifiant: `${agrege[1]}-${Number(agrege[2])}` };

  return null;
}

/**
 * Forme comparable d'un identifiant d'avis.
 *
 * Le même avis TED s'écrit « 725368-2026 » dans un lien d'agrégateur,
 * « 00725368-2026 » dans la réponse de l'API, et « TED-00725368-2026 » dans
 * notre base. Comparer les chaînes telles quelles fait manquer la
 * correspondance, et l'on retombe alors sur une recherche approximative alors
 * que l'identifiant exact était en main.
 *
 * Un identifiant du BOAMP, lui, s'écrit pareil partout : la fonction le laisse
 * intact.
 */
export function clefIdentifiant(valeur: string): string {
  return valeur.replace(/^TED-/i, "").replace(/^0+/, "");
}
