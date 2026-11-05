import assert from "node:assert/strict";
import { test } from "node:test";

import { analyserAdresses, analyserMontant, lireMontant } from "../src/lib/veille/avis";

/**
 * Les structures de ces cas viennent d'avis réels du BOAMP, réduites aux
 * champs qui portent l'information. Les chemins (`cac:ExternalReference`,
 * `cac:ProcurementProjectLot`) sont ceux du format eForms tels qu'ils
 * arrivent, et c'est précisément ce qui compte : le module lit un chemin, pas
 * un mot qui ressemble.
 */

test("lireMontant comprend les séparateurs et les unités", () => {
  assert.equal(lireMontant("250000"), 250_000);
  assert.equal(lireMontant("1 200 000 € HT"), 1_200_000);
  assert.equal(lireMontant("1,2 M€"), 1_200_000);
  assert.equal(lireMontant("180 k€"), 180_000);
  // Un numéro de lot ou une durée ne sont pas des montants.
  assert.equal(lireMontant("lot 3"), null);
  assert.equal(lireMontant("48 mois"), null);
  assert.equal(lireMontant(null), null);
});

/**
 * Le cas qui produisait l'erreur la plus répandue : un montant nu dans un
 * champ « estimé ». L'ancienne extraction, qui cherchait le mot « estimé »
 * dans la valeur, n'en trouvait pas et concluait « montant global » — la
 * seule étiquette qui affirme quelque chose de faux. Sur soixante et onze
 * avis réels, dix-huit montants sur dix-huit étaient ainsi présentés comme
 * fermes.
 */
test("un montant venu d'un champ « estimé » est étiqueté estimé", () => {
  const m = analyserMontant({
    EFORMS: { ContractNotice: { "cac:ProcurementProject": { "cbc:EstimatedOverallContractAmount": "250000" } } },
  });
  assert.equal(m.max, 250_000);
  assert.equal(m.kind, "ESTIME");
  assert.match(m.note ?? "", /estim/i);
});

test("un plafond d'accord-cadre passe devant l'estimation", () => {
  const m = analyserMontant({
    "cac:ProcurementProject": { "cbc:EstimatedOverallContractAmount": "250000" },
    "cac:FrameworkAgreement": { "cbc:MaximumValue": "900000" },
  });
  assert.equal(m.max, 900_000);
  assert.equal(m.kind, "MAXIMUM");
});

/**
 * L'erreur la plus grave, parce qu'elle donne un chiffre faux et non une
 * étiquette fausse : le montant d'un seul lot annoncé comme celui du marché.
 * Observée sur deux avis réels.
 */
test("un montant trouvé dans un lot n'est jamais promu en montant du marché", () => {
  const m = analyserMontant({
    "cac:ProcurementProjectLot": [
      { "cbc:ID": "1", "cac:ProcurementProject": { "cbc:EstimatedOverallContractAmount": "100000" } },
      { "cbc:ID": "2", "cac:ProcurementProject": { "cbc:EstimatedOverallContractAmount": "40000" } },
    ],
  });
  assert.equal(m.kind, "PAR_LOT");
  assert.equal(m.max, 140_000, "la somme des lots donne un ordre de grandeur");
  assert.match(m.note ?? "", /lot/i);
});

test("le niveau marché l'emporte sur le niveau lot quand les deux existent", () => {
  const m = analyserMontant({
    "cac:ProcurementProject": { "cbc:EstimatedOverallContractAmount": "500000" },
    "cac:ProcurementProjectLot": [
      { "cac:ProcurementProject": { "cbc:EstimatedOverallContractAmount": "100000" } },
    ],
  });
  assert.equal(m.max, 500_000);
  assert.equal(m.kind, "ESTIME");
});

test("un avis sans montant ne se voit pas attribuer de montant", () => {
  const m = analyserMontant({ "cac:ProcurementProject": { "cbc:Name": "Formation" } });
  assert.equal(m.max, null);
  assert.equal(m.kind, "NON_COMMUNIQUE");
  assert.equal(m.note, null);
});

/**
 * L'adresse du dossier n'était extraite aucune fois sur soixante et onze
 * avis, alors que cent trente-trois champs la portaient : le code la fixait à
 * « null ». Les décisions GO annonçaient donc que l'acheteur ne publiait pas
 * d'adresse de retrait, ce qui était faux.
 */
test("l'adresse du dossier est lue dans la référence externe", () => {
  const a = analyserAdresses({
    "cac:ExternalReference": { "cbc:URI": "https://www.marches-publics.gouv.fr/entreprise/consultation/3091727" },
  });
  assert.equal(a.dossier, "https://www.marches-publics.gouv.fr/entreprise/consultation/3091727");
});

test("le dépôt et le dossier restent deux adresses distinctes", () => {
  const a = analyserAdresses({
    "cac:ExternalReference": { "cbc:URI": "https://plateforme.test/consultation/42" },
    "cac:TenderRecipientParty": { "cbc:EndpointID": "https://plateforme.test/depot" },
    "cac:ContractingParty": { "cbc:BuyerProfileURI": "https://plateforme.test/profil" },
  });
  assert.equal(a.dossier, "https://plateforme.test/consultation/42");
  assert.equal(a.depot, "https://plateforme.test/depot");
  assert.equal(a.profil, "https://plateforme.test/profil");
});

test("le format BOAMP historique est lu aussi", () => {
  const a = analyserAdresses({
    communication: {
      urlDocConsul: "https://www.marches-publics.gouv.fr/?page=Entreprise.Consultation&id=99",
      urlProfilAch: "https://www.marches-publics.gouv.fr/entreprise",
    },
  });
  assert.match(a.dossier ?? "", /Consultation&id=99/);
  assert.equal(a.profil, "https://www.marches-publics.gouv.fr/entreprise");
});

test("ce qui n'est pas une adresse n'en devient pas une", () => {
  const a = analyserAdresses({
    "cac:ExternalReference": { "cbc:URI": "voir le profil d'acheteur" },
    "cac:TenderRecipientParty": { "cbc:EndpointID": "contact@acheteur.fr" },
  });
  assert.equal(a.dossier, null);
  assert.equal(a.depot, null);
});
