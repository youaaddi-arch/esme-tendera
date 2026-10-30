import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeDce, type AnalyzedDocument } from "../src/lib/dce/analyze";
import { classifyDocument } from "../src/lib/dce/classify";
import { buildWhereClause, normalizeBoampRecord, parseAmount, parseDate } from "../src/lib/veille/boamp-parse";

/**
 * Jeu d'essai : extraits représentatifs d'un règlement de consultation, d'un
 * CCTP et d'un CCAP de marché de formation. Les formulations reprennent celles
 * qu'on rencontre réellement dans la commande publique.
 */

const RC = `
RÈGLEMENT DE LA CONSULTATION

Article 1 — Objet du marché : accompagnement à la montée en compétences des agents
techniques de la collectivité en matière de transition énergétique du patrimoine bâti.

Article 4 — Composition du pli. L'offre doit comporter l'acte d'engagement complété
et signé, le mémoire technique renseigné selon le cadre de réponse joint, et le
bordereau des prix unitaires. L'absence du mémoire technique entraînera le rejet de
l'offre.

Le candidat doit justifier d'une certification Qualiopi en cours de validité.
La production de l'attestation de vigilance URSSAF est obligatoire.

Article 7 — Jugement des offres. Les offres seront jugées selon les critères suivants :
Valeur technique : 60 %
Prix des prestations : 40 %

Durée de validité des offres : 120 jours à compter de la date limite de remise.
Il est souhaitable que le candidat propose des modalités d'évaluation à froid.
`;

const CCTP = `
CAHIER DES CLAUSES TECHNIQUES PARTICULIÈRES

1. Contexte : la collectivité engage un plan pluriannuel de sobriété énergétique et
souhaite former ses équipes aux enjeux techniques et réglementaires associés.

2. Public cible : agents techniques des services bâtiments, responsables de site,
référents énergie.

Le marché porte sur la formation de 120 agents répartis en 8 sessions de formation.
Chaque session représente 14 heures de formation, en présentiel sur les sites de la
collectivité, avec possibilité de classe virtuelle pour les modules de sensibilisation.

Lieu d'exécution : sites de la collectivité, région Île-de-France.

Moyens humains : le prestataire précisera le profil des formateurs mobilisés, leur
expérience du secteur public et leurs références sur des prestations comparables.

Le titulaire doit fournir les supports pédagogiques au format numérique accessible.
`;

const CCAP = `
CAHIER DES CLAUSES ADMINISTRATIVES PARTICULIÈRES

Article 3 — Durée du marché : le marché est conclu pour une durée de 2 ans à compter
de sa notification, reconductible 1 fois.

Article 9 — Prix. Les prix sont fermes pour la première année, actualisables ensuite.

Article 12 — Pénalités de retard : en cas de report d'une session du fait du titulaire,
une pénalité forfaitaire de 300 euros par session reportée sera appliquée.

Article 15 — Résiliation. En cas de manquement grave, le pouvoir adjudicateur pourra
prononcer la résiliation du marché aux torts du titulaire après mise en demeure.

Durée de validité des offres : 90 jours.
`;

function doc(id: string, fileName: string, kind: AnalyzedDocument["kind"], text: string): AnalyzedDocument {
  // Une page par bloc de 1 200 caractères, pour que les citations portent une page.
  const pages: { page: number; text: string }[] = [];
  for (let index = 0; index * 1200 < text.length; index += 1) {
    pages.push({ page: index + 1, text: text.slice(index * 1200, (index + 1) * 1200) });
  }
  return { id, fileName, kind, pages };
}

const DOSSIER = [
  doc("d1", "RC.pdf", "RC", RC),
  doc("d2", "CCTP.pdf", "CCTP", CCTP),
  doc("d3", "CCAP.pdf", "CCAP", CCAP),
];

describe("classification des pièces", () => {
  it("reconnaît les pièces par leur nom", () => {
    assert.equal(classifyDocument("RC.pdf", "").kind, "RC");
    assert.equal(classifyDocument("CCTP_lot_1.pdf", "").kind, "CCTP");
    assert.equal(classifyDocument("DCE/03 - CCAP.pdf", "").kind, "CCAP");
    assert.equal(classifyDocument("DC1.pdf", "").kind, "DC1");
    assert.equal(classifyDocument("BPU_formation.xlsx", "").kind, "BPU");
  });

  it("reconnaît une pièce au nom muet par son contenu", () => {
    const result = classifyDocument(
      "Document 3.pdf",
      "CAHIER DES CLAUSES TECHNIQUES PARTICULIÈRES\n\nArticle 1 — Objet",
    );
    assert.equal(result.kind, "CCTP");
    assert.ok(result.confidence >= 0.5);
  });

  it("donne une confiance plus élevée quand nom et contenu concordent", () => {
    const both = classifyDocument("CCTP.pdf", "cahier des clauses techniques particulières");
    const nameOnly = classifyDocument("CCTP.pdf", "texte sans rapport");
    assert.ok(both.confidence > nameOnly.confidence);
  });

  it("n'invente pas un type pour une pièce inconnue", () => {
    const result = classifyDocument("photo-site.png", "");
    assert.equal(result.kind, "AUTRE");
    assert.equal(result.confidence, 0);
  });
});

describe("analyse du DCE", () => {
  const outcome = analyzeDce(DOSSIER);

  it("n'analyse rien sans pièce, et le dit", () => {
    const empty = analyzeDce([]);
    assert.equal(empty.basedOnDocuments, false);
    assert.equal(empty.documentCount, 0);
    assert.ok(empty.incertitudes.some((note) => note.includes("n'a pas eu lieu")));
  });

  it("identifie l'objet du marché", () => {
    assert.ok(outcome.objet, "objet non identifié");
    assert.match(outcome.objet!, /mont[ée]e en comp[ée]tences/i);
  });

  it("relève le nombre de stagiaires, de sessions et le volume horaire", () => {
    assert.match(outcome.stagiaires ?? "", /120/);
    assert.match(outcome.sessions ?? "", /8/);
    assert.match(outcome.volumeHoraire ?? "", /14/);
  });

  it("relève les modalités pédagogiques", () => {
    const joined = outcome.modalites.join(" ").toLowerCase();
    assert.ok(joined.includes("présentiel") || joined.includes("classe virtuelle"), joined);
  });

  it("extrait les critères d'attribution avec leur pondération", () => {
    const technique = outcome.criteres.find((critere) => /valeur\s+technique/i.test(critere.label));
    const prix = outcome.criteres.find((critere) => /prix/i.test(critere.label));
    assert.ok(technique, `critères trouvés : ${outcome.criteres.map((c) => c.label).join(" | ")}`);
    assert.equal(technique!.weight, 60);
    assert.ok(prix);
    assert.equal(prix!.weight, 40);
  });

  it("rattache chaque critère à sa pièce et à sa page", () => {
    for (const critere of outcome.criteres) {
      assert.ok(critere.source, `critère sans source : ${critere.label}`);
      assert.ok(critere.source!.page >= 1);
      assert.ok(critere.source!.fileName.length > 0);
    }
  });

  it("repère la certification exigée", () => {
    assert.ok(outcome.certifications.some((item) => /qualiopi/i.test(item)));
  });

  it("classe les exigences en obligatoires, évaluées et recommandations", () => {
    const levels = new Set(outcome.requirements.map((requirement) => requirement.level));
    assert.ok(levels.has("OBLIGATOIRE"), "aucune exigence obligatoire détectée");
    assert.ok(levels.has("EVALUEE"), "les critères doivent devenir des exigences évaluées");
    assert.ok(levels.has("RECOMMANDATION"), "aucune recommandation détectée");
  });

  it("traite comme obligatoire une clause assortie d'un rejet", () => {
    const blocking = outcome.requirements.filter((requirement) => requirement.level === "OBLIGATOIRE");
    assert.ok(
      blocking.some((requirement) => /rejet|obligatoire|doit/i.test(requirement.label)),
      blocking.map((r) => r.label).join(" | "),
    );
  });

  it("relève les pénalités et les risques contractuels", () => {
    assert.ok(outcome.penalites.some((item) => /p[ée]nalit[ée]/i.test(item)));
    assert.ok(outcome.risques.some((item) => /r[ée]siliation/i.test(item)));
  });

  it("détecte une contradiction entre deux pièces", () => {
    // Le RC annonce 120 jours de validité des offres, le CCAP 90.
    const contradiction = outcome.contradictions.find((item) => /validit[ée]/i.test(item.sujet));
    assert.ok(contradiction, `contradictions : ${JSON.stringify(outcome.contradictions)}`);
    assert.ok(contradiction!.piecesConcernees.length >= 2);
    assert.ok(outcome.pointsAClarifier.some((point) => /validit[ée]/i.test(point)));
  });

  it("produit des citations rattachées à une pièce et à une page", () => {
    assert.ok(outcome.citations.length > 0);
    for (const citation of outcome.citations) {
      assert.ok(citation.source.documentId);
      assert.ok(citation.source.page >= 1);
    }
  });

  it("signale toujours la portée et les limites de l'analyse", () => {
    assert.ok(outcome.incertitudes.some((note) => /valeur juridique/i.test(note)));
  });

  it("signale les pièces manquantes du dossier", () => {
    const sansCctp = analyzeDce([DOSSIER[0]]);
    assert.ok(sansCctp.incertitudes.some((note) => note.includes("CCTP")));
  });
});

describe("connecteur BOAMP", () => {
  describe("lecture des montants", () => {
    it("lit un montant simple", () => {
      const result = parseAmount("180 000 € HT");
      assert.equal(result.max, 180000);
      assert.equal(result.kind, "GLOBAL");
    });

    it("reconnaît un montant maximum", () => {
      const result = parseAmount("Montant maximum : 250 000 euros");
      assert.equal(result.kind, "MAXIMUM");
      assert.equal(result.max, 250000);
    });

    it("reconnaît une estimation et une fourchette", () => {
      const result = parseAmount("Montant estimé entre 90 000 € et 120 000 €");
      assert.equal(result.kind, "ESTIME");
      assert.equal(result.min, 90000);
      assert.equal(result.max, 120000);
    });

    it("gère les millions", () => {
      assert.equal(parseAmount("1,2 M€").max, 1_200_000);
    });

    it("ne produit aucun montant quand l'avis n'en donne pas", () => {
      const result = parseAmount(null);
      assert.equal(result.kind, "NON_COMMUNIQUE");
      assert.equal(result.max, null);
    });

    it("ignore les petits nombres qui ne sont pas des montants", () => {
      assert.equal(parseAmount("lot 3").kind, "NON_COMMUNIQUE");
    });
  });

  describe("construction de la requête", () => {
    it("borne la recherche dans le temps et interroge objet et descripteurs", () => {
      const where = buildWhereClause({ lookbackDays: 7, keywords: ["formation", "cybersécurité"] });
      assert.match(where, /dateparution >= date'/);
      assert.match(where, /search\(objet, "formation"\)/);
      assert.match(where, /search\(descripteur_libelle, "formation"\)/);
    });

    it("ne filtre jamais sur code_cpv, qui n'existe pas dans le jeu de données", () => {
      // Le portail renvoie « ODSQLError: Unknown field: code_cpv » et toute la
      // synchronisation échoue : la régression doit être détectée ici.
      const where = buildWhereClause({ lookbackDays: 30, keywords: ["formation"] });
      assert.ok(!where.includes("code_cpv"), where);
    });

    it("échappe les guillemets d'un mot-clé", () => {
      const where = buildWhereClause({ lookbackDays: 1, keywords: ['dit "formation"'] });
      assert.ok(where.includes('\\"formation\\"'), where);
    });

    it("reste valide sans aucun mot-clé", () => {
      const where = buildWhereClause({ lookbackDays: 3, keywords: [] });
      assert.match(where, /^dateparution >= date'\d{4}-\d{2}-\d{2}'$/);
    });
  });

  describe("normalisation d'un avis", () => {
    // Enregistrement calqué sur la structure réelle du jeu de données :
    // colonnes plates, tableaux, et avis complet eForms dans « donnees ».
    const record = {
      idweb: "26-105283",
      id: "26_105283",
      objet: "Acquisition de modules de formation à destination des agents",
      nomacheteur: "CNAF Etablissement Public",
      dateparution: "2026-10-30",
      datelimitereponse: null,
      type_procedure: "RESTREINT",
      procedure_libelle: "Procédure Restreinte",
      famille: "JOUE",
      nature: "APPEL_OFFRE",
      etat: "INITIAL",
      type_marche: ["SERVICES"],
      code_departement: ["75"],
      code_departement_prestation: "75",
      url_avis: "https://www.boamp.fr/pages/avis/?q=idweb:26-105283",
      annonce_lie: [],
      donnees: {
        EFORMS: {
          ContractNotice: {
            "cac:ProcurementProject": {
              "cbc:Name": { "#text": "Modules de formation" },
              "cac:MainCommodityClassification": {
                "cbc:ItemClassificationCode": { "@listName": "cpv", "#text": "80500000" },
              },
            },
            "cac:ProcurementProjectLot": [
              {
                "cbc:ID": "LOT-0001",
                "cac:ProcurementProject": { "cbc:Name": { "#text": "Conception des modules" } },
              },
              {
                "cbc:ID": "LOT-0002",
                "cac:ProcurementProject": { "cbc:Name": { "#text": "Animation des sessions" } },
              },
            ],
            "cac:TenderingProcess": {
              "cac:TenderSubmissionDeadlinePeriod": { "cbc:EndDate": "2026-12-15" },
            },
            "cbc:EstimatedOverallContractAmount": { "#text": "450000" },
          },
        },
      },
    };

    it("préfère une référence lisible à un identifiant technique", () => {
      // `contractfolderid` est souvent un GUID : il n'apprend rien sur une carte.
      const guid = normalizeBoampRecord({
        ...record,
        contractfolderid: "a477258a-5651-4e21-bd74-a0c7ecd383af",
      })!;
      assert.equal(guid.consultationRef, "BOAMP 26-105283");

      const readable = normalizeBoampRecord({ ...record, contractfolderid: "2026-AO-14" })!;
      assert.equal(readable.consultationRef, "2026-AO-14");
    });

    it("reprend les colonnes plates", () => {
      const notice = normalizeBoampRecord(record)!;
      assert.ok(notice);
      assert.equal(notice.sourceNoticeId, "26-105283");
      assert.equal(notice.buyer, "CNAF Etablissement Public");
      assert.equal(notice.procedure, "Procédure Restreinte");
      assert.equal(notice.sourceUrl, record.url_avis);
    });

    it("lit les codes CPV dans l'avis complet", () => {
      const notice = normalizeBoampRecord(record)!;
      assert.deepEqual(notice.cpvCodes, ["80500000"]);
    });

    it("récupère la date limite dans l'avis complet quand la colonne est vide", () => {
      const notice = normalizeBoampRecord(record)!;
      assert.ok(notice.deadlineAt, "date limite non trouvée");
      assert.equal(notice.deadlineAt!.toISOString().slice(0, 10), "2026-12-15");
    });

    it("extrait les lots", () => {
      const notice = normalizeBoampRecord(record)!;
      assert.equal(notice.lots.length, 2);
      assert.equal(notice.lots[0].number, "LOT-0001");
      assert.match(notice.lots[0].title, /Conception/);
    });

    it("lit le montant estimé", () => {
      const notice = normalizeBoampRecord(record)!;
      assert.equal(notice.amountMaxEur, 450000);
    });

    it("gère une colonne « donnees » sérialisée en chaîne", () => {
      const notice = normalizeBoampRecord({ ...record, donnees: JSON.stringify(record.donnees) })!;
      assert.deepEqual(notice.cpvCodes, ["80500000"]);
      assert.equal(notice.lots.length, 2);
    });

    it("ne renvoie rien sans objet ni identifiant", () => {
      assert.equal(normalizeBoampRecord({ nomacheteur: "X" }), null);
      assert.equal(normalizeBoampRecord({ objet: "Formation" }), null);
    });

    it("n'invente ni lot ni CPV quand l'avis n'en porte pas", () => {
      const minimal = normalizeBoampRecord({
        idweb: "26-1", objet: "Formation des agents", nomacheteur: "Ville", dateparution: "2026-10-01",
      })!;
      assert.deepEqual(minimal.lots, []);
      assert.deepEqual(minimal.cpvCodes, []);
      assert.equal(minimal.amountKind, "NON_COMMUNIQUE");
      assert.equal(minimal.deadlineAt, null);
    });

    it("reconnaît un avis rectificatif et son avis initial", () => {
      const rectificatif = normalizeBoampRecord({
        ...record,
        idweb: "26-105999",
        etat: "RECTIFICATIF",
        annonce_lie: ["26-105283"],
      })!;
      assert.equal(rectificatif.rectifiesNoticeId, "26-105283");
    });

    it("lit une date eForms au format « 2026-11-18+01:00 »", () => {
      // new Date() renvoie une date invalide sur cette forme : sans correction,
      // toutes les dates limites des avis européens étaient perdues.
      const notice = normalizeBoampRecord({
        idweb: "26-2",
        objet: "Formation",
        nomacheteur: "Ville",
        donnees: {
          EFORMS: {
            ContractNotice: {
              "cac:TenderingProcess": {
                "cac:TenderSubmissionDeadlinePeriod": { "cbc:EndDate": "2026-11-18+01:00" },
              },
            },
          },
        },
      })!;
      assert.ok(notice.deadlineAt, "date limite non lue");
      assert.equal(notice.deadlineAt!.toISOString().slice(0, 10), "2026-11-18");
    });

    it("ne confond pas la fin du marché avec la date limite de réponse", () => {
      const notice = normalizeBoampRecord({
        idweb: "26-3",
        objet: "Formation",
        nomacheteur: "Ville",
        donnees: {
          EFORMS: {
            ContractNotice: {
              // La fin d'exécution est bien plus tardive que la remise des offres.
              "cac:ProcurementProject": { "cac:PlannedPeriod": { "cbc:EndDate": "2028-11-30+01:00" } },
              "cac:TenderingProcess": {
                "cac:AdditionalInformationRequestPeriod": { "cbc:EndDate": "2026-11-16+01:00" },
                "cac:TenderSubmissionDeadlinePeriod": { "cbc:EndDate": "2026-11-26+01:00" },
              },
            },
          },
        },
      })!;
      assert.equal(notice.deadlineAt!.toISOString().slice(0, 10), "2026-11-26");
    });

    it("retient la remise des candidatures en procédure restreinte", () => {
      const notice = normalizeBoampRecord({
        idweb: "26-4",
        objet: "Formation",
        nomacheteur: "Ville",
        donnees: {
          EFORMS: {
            ContractNotice: {
              "cac:ProcurementProject": { "cac:PlannedPeriod": { "cbc:EndDate": "2028-11-30+01:00" } },
              "cac:TenderingProcess": {
                "cac:ParticipationRequestReceptionPeriod": { "cbc:EndDate": "2026-11-25+01:00" },
              },
            },
          },
        },
      })!;
      assert.equal(notice.deadlineAt!.toISOString().slice(0, 10), "2026-11-25");
    });

    it("écarte un avis d'attribution", () => {
      // Un marché déjà attribué n'est pas une opportunité : l'importer
      // fausserait le portefeuille et les indicateurs.
      const award = normalizeBoampRecord({
        idweb: "26-5",
        objet: "Actions de formation",
        nomacheteur: "CNFPT",
        donnees: { EFORMS: { ContractAwardNotice: { "cbc:IssueDate": "2026-10-28+01:00" } } },
      });
      assert.equal(award, null);
      assert.equal(
        normalizeBoampRecord({ idweb: "26-6", objet: "Formation", nature_libelle: "Avis d'attribution" }),
        null,
      );
    });

    it("ignore la date sentinelle des avis de résultat", () => {
      assert.equal(parseDate("2000-01-01Z"), null);
    });

    it("ne prétend pas disposer d'un lien vers le DCE", () => {
      // Le BOAMP ne publie pas de lien direct : le retrait passe par le profil
      // d'acheteur, souvent nominatif.
      assert.equal(normalizeBoampRecord(record)!.dceUrl, null);
    });
  });
});
