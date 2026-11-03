import assert from "node:assert/strict";
import { test } from "node:test";

import { clefIdentifiant, identifiantDepuisLien } from "../src/lib/veille/liens";

/**
 * Ces cas viennent d'un tableau de tri réel et de vérifications faites chez
 * la source : chaque identifiant attendu a été interrogé au BOAMP ou à TED et
 * a rendu l'avis correspondant.
 */

test("un fichier BOAMP porte l'identifiant tel quel", () => {
  assert.deepEqual(
    identifiantDepuisLien("https://www.francemarches.com/files/BOAMP/26-92262.html"),
    { source: "BOAMP", identifiant: "26-92262" },
  );
});

test("un lien JOUE donne le numéro de publication TED, zéros de tête ôtés", () => {
  assert.deepEqual(
    identifiantDepuisLien(
      "https://www.francemarches.com/appel-offre/13joue007253682026-2026-formations-management-projet",
    ),
    { source: "TED", identifiant: "725368-2026" },
  );
});

/**
 * Le cas qui avait été manqué : l'année est collée au numéro. Lu tel quel,
 * « 2694667 » ne désigne rien, et la ligne retombait sur une recherche plein
 * texte alors que son identifiant exact figurait dans le lien.
 */
test("un lien BOAMP agrégé sépare l'année du numéro", () => {
  assert.deepEqual(
    identifiantDepuisLien("https://www.francemarches.com/appel-offre/3boamp2694667-2026-accord-cadre-bons"),
    { source: "BOAMP", identifiant: "26-94667" },
  );
  assert.deepEqual(
    identifiantDepuisLien("https://www.francemarches.com/appel-offre/3boamp2699225-2026-formations-managers-asnr"),
    { source: "BOAMP", identifiant: "26-99225" },
  );
});

test("un numéro BOAMP à six chiffres garde ses six chiffres", () => {
  assert.deepEqual(
    identifiantDepuisLien("https://www.francemarches.com/appel-offre/3boamp26103940-2026-savoie"),
    { source: "BOAMP", identifiant: "26-103940" },
  );
});

/**
 * TED passe avant BOAMP, et il faut que ce soit vrai même quand les deux
 * motifs pourraient mordre : un avis au JOUE n'est pas un avis au BOAMP.
 */
test("TED est reconnu même si le lien contient aussi « boamp »", () => {
  assert.deepEqual(
    identifiantDepuisLien("https://exemple.test/13joue006312402026-2026-boamp2694667-truc"),
    { source: "TED", identifiant: "631240-2026" },
  );
});

test("un lien d'agrégateur sans identifiant de source ne rend rien", () => {
  assert.equal(
    identifiantDepuisLien(
      "https://www.francemarches.com/appel-offre/37mpipub20262861675161120267976-2026-audits-formations",
    ),
    null,
  );
  assert.equal(identifiantDepuisLien(""), null);
  assert.equal(identifiantDepuisLien("Non retrouvé – chercher l'objet sur francemarches.com"), null);
});

/**
 * La forme comparable d'un identifiant.
 *
 * Le même avis TED s'écrit de trois façons selon l'endroit, et comparer les
 * chaînes telles quelles faisait manquer la correspondance : une affaire créée
 * depuis un identifiant TED exact était ensuite notée à 36 % par une
 * recherche de ressemblance, parce que la clé ne collait pas.
 */
test("la clé d'un identifiant TED ignore le préfixe et les zéros de tête", () => {
  assert.equal(clefIdentifiant("TED-00725368-2026"), "725368-2026");
  assert.equal(clefIdentifiant("TED-725368-2026"), "725368-2026");
  assert.equal(clefIdentifiant("00725368-2026"), "725368-2026");
  assert.equal(clefIdentifiant("725368-2026"), "725368-2026");
});

test("un identifiant BOAMP est laissé intact", () => {
  assert.equal(clefIdentifiant("26-92262"), "26-92262");
  assert.equal(clefIdentifiant("26-103940"), "26-103940");
});
