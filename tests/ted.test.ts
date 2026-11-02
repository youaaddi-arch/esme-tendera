import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTedQuery, isAppelAConcurrence, normalizeTedNotice, parseTedDate, pickDeadline,
  pickLink, pickList, pickText,
} from "../src/lib/veille/ted-parse";

/**
 * Les enregistrements ci-dessous sont de vrais avis TED, repris tels que
 * l'API les renvoie. Une forme inventée ne prouverait rien : c'est justement
 * la forme réelle des champs multilingues qui piège.
 */
const AVIS_CNFPT = {
  "publication-number": "682070-2026",
  "notice-type": "cn-standard",
  "title-proc": {
    fra: "Réalisation d'actions de formation sur le thème « Santé, sécurité et conditions de travail » pour le compte de la délégation Occitanie du CNFPT",
  },
  "description-proc": { fra: "Accord-cadre de services à bons de commande, mono-attributaire" },
  "organisation-name-buyer": { fra: ["CNFPT - Direction de l'achat public"] },
  "publication-date": "2026-10-05+02:00",
  "deadline-receipt-tender-date-lot": ["2026-11-02+01:00", "2026-11-02+01:00"],
  "classification-cpv": ["80530000", "80530000", "80530000"],
  "procedure-type": "open",
  "total-value": 280000,
  "title-lot": {
    fra: [
      "Prestation de formation « Santé, sécurité et conditions de travail »",
      "Prestation de formation « Santé, sécurité et conditions de travail »",
    ],
  },
  "description-lot": {
    fra: ["Formation des membres des comités sociaux territoriaux", "Formation de formateurs"],
  },
  links: {
    html: { FRA: "https://ted.europa.eu/fr/notice/-/detail/682070-2026" },
    pdf: { FRA: "https://ted.europa.eu/fr/notice/682070-2026/pdf" },
  },
};

const AVIS_ATTRIBUTION = {
  "publication-number": "707714-2026",
  "notice-type": "can-standard",
  "title-proc": { fra: "Achat de formations dans le secteur agricole" },
  "organisation-name-buyer": { fra: ["Collectivité de Corse"] },
  "publication-date": "2026-10-14+02:00",
  "total-value": 633450,
};

describe("lecture des avis TED", () => {
  it("lit un champ multilingue sous ses deux formes", () => {
    assert.equal(pickText({ fra: "texte" }), "texte");
    assert.equal(pickText({ fra: ["premier", "second"] }), "premier");
    assert.equal(pickText({ eng: "english only" }), "english only");
    assert.equal(pickText(null), null);
    assert.equal(pickText({ fra: "" }), null);
  });

  it("préfère le français quand plusieurs langues sont présentes", () => {
    assert.equal(pickText({ eng: "Training", fra: "Formation" }), "Formation");
  });

  it("ne perd pas un avis rédigé dans une langue non prévue", () => {
    // Un avis d'un organisme européen implanté en France peut n'avoir ni
    // français ni anglais : l'écarter silencieusement serait pire.
    assert.equal(pickText({ deu: "Fortbildung" }), "Fortbildung");
  });

  it("rend la liste complète des valeurs répétées par lot", () => {
    assert.deepEqual(pickList({ fra: ["a", "b", "c"] }), ["a", "b", "c"]);
    assert.deepEqual(pickList({ fra: "seul" }), ["seul"]);
    assert.deepEqual(pickList(null), []);
  });

  it("ancre une date sans heure à midi UTC", () => {
    // Ancrée à minuit, la conversion de fuseau la ferait basculer sur la
    // veille : une date limite affichée un jour trop tôt ferait manquer un
    // dépôt.
    const date = parseTedDate("2026-11-02+01:00");
    assert.ok(date);
    assert.equal(date.toISOString().slice(0, 10), "2026-11-02");
  });

  it("écarte une date sentinelle", () => {
    assert.equal(parseTedDate("1900-01-01"), null);
    assert.equal(parseTedDate(""), null);
    assert.equal(parseTedDate(undefined), null);
  });

  it("retient l'échéance la plus proche parmi celles des lots", () => {
    // C'est la plus proche qui engage : la manquer ferme ce lot-là.
    const date = pickDeadline(["2026-12-01+01:00", "2026-11-02+01:00", "2026-11-20+01:00"]);
    assert.ok(date);
    assert.equal(date.toISOString().slice(0, 10), "2026-11-02");
  });

  it("distingue un appel à concurrence d'une attribution", () => {
    assert.ok(isAppelAConcurrence("cn-standard"));
    assert.ok(isAppelAConcurrence("cn-social"));
    assert.ok(!isAppelAConcurrence("can-standard"));
    assert.ok(!isAppelAConcurrence("pin-only"));
    assert.ok(!isAppelAConcurrence("veat"));
    assert.ok(!isAppelAConcurrence(undefined));
  });

  it("préfère la page HTML française au PDF", () => {
    assert.equal(pickLink(AVIS_CNFPT.links), "https://ted.europa.eu/fr/notice/-/detail/682070-2026");
    assert.equal(pickLink(null), null);
  });

  it("normalise un avis de consultation réel", () => {
    const notice = normalizeTedNotice(AVIS_CNFPT);
    assert.ok(notice, "l'avis aurait dû être retenu");
    assert.equal(notice.sourceNoticeId, "TED-682070-2026");
    assert.match(notice.title, /^Réalisation d'actions de formation/);
    assert.equal(notice.buyer, "CNFPT - Direction de l'achat public");
    assert.deepEqual(notice.cpvCodes, ["80530000"], "les CPV répétés sont dédoublonnés");
    assert.equal(notice.amountKind, "ESTIME");
    assert.equal(notice.amountMaxEur, 280000);
    assert.equal(notice.lots.length, 2);
    assert.equal(notice.lots[0].number, "1");
    assert.match(notice.lots[0].description ?? "", /comités sociaux/);
    assert.equal(notice.publishedAt?.toISOString().slice(0, 10), "2026-10-05");
    assert.equal(notice.deadlineAt?.toISOString().slice(0, 10), "2026-11-02");
  });

  it("écarte un avis d'attribution", () => {
    // Il n'y a plus rien à déposer : en faire une affaire encombrerait le
    // pipeline d'opportunités déjà fermées.
    assert.equal(normalizeTedNotice(AVIS_ATTRIBUTION), null);
  });

  it("écarte un enregistrement sans identifiant ou sans objet", () => {
    assert.equal(normalizeTedNotice({ "notice-type": "cn-standard", "title-proc": { fra: "x" } }), null);
    assert.equal(normalizeTedNotice({ "publication-number": "1-2026", "notice-type": "cn-standard" }), null);
  });

  it("construit une requête qui filtre source, pays, fenêtre et type", () => {
    const query = buildTedQuery({ lookbackDays: 30 });
    assert.match(query, /classification-cpv IN \(80000000\)/);
    assert.match(query, /buyer-country=FRA/);
    assert.match(query, /publication-date>=today\(-30\)/);
    assert.match(query, /notice-type IN \(cn-standard cn-social cn-desg\)/);
  });

  it("borne la fenêtre de recherche", () => {
    // Zéro vaut « non renseigné », pas « un jour » : une fenêtre d'un jour
    // rétrécirait la veille sans que personne s'en aperçoive.
    assert.match(buildTedQuery({ lookbackDays: 0 }), /today\(-30\)/);
    assert.match(buildTedQuery({ lookbackDays: -5 }), /today\(-30\)/);
    assert.match(buildTedQuery({ lookbackDays: 9000 }), /today\(-365\)/);
  });
});
