import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  collectFranceTravailSearch,
  createFranceTravailSearches,
  deduplicateFranceTravailOffers,
  persistFranceTravailOffers,
  toJobOfferUpsertInput,
} from "../lib/france-travail-job-offer.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const observedAt = "2026-07-24T09:30:00.000Z";

test("une offre France Travail complète est mappée sans normalisation artificielle", () => {
  const rawOffer = {
    id: "189ABC",
    intitule: "Conseiller en insertion professionnelle H/F",
    description: "Accompagnement des bénéficiaires",
    dateCreation: "2026-07-23T08:15:00+02:00",
    typeContrat: "CDI",
    typeContratLibelle: "Contrat à durée indéterminée",
    experienceLibelle: "2 ans",
    qualificationLibelle: "Technicien",
    dureeTravailLibelle: "35H Travail en journée",
    dureeTravailLibelleConverti: "Temps plein",
    romeCode: "K1801",
    romeLibelle: "Conseil en emploi et insertion socioprofessionnelle",
    salaire: { libelle: "Mensuel de 2100 euros" },
    lieuTravail: {
      libelle: "47 - MARMANDE",
      codePostal: "47200",
      commune: "47157",
      latitude: 44.5,
      longitude: 0.16,
    },
    entreprise: { nom: "Association Exemple" },
    origineOffre: { urlOrigine: "https://candidat.francetravail.fr/offres/189ABC" },
  };

  const input = toJobOfferUpsertInput(rawOffer, observedAt);
  assert.equal(input.observedAt, observedAt);
  assert.equal(input.offer.titleOriginal, rawOffer.intitule);
  assert.equal(input.offer.descriptionOriginal, rawOffer.description);
  assert.equal(input.offer.contractTypeOriginal, rawOffer.typeContratLibelle);
  assert.equal(input.offer.salaryOriginal, rawOffer.salaire.libelle);
  assert.equal(input.offer.experienceOriginal, rawOffer.experienceLibelle);
  assert.equal(input.offer.qualificationOriginal, rawOffer.qualificationLibelle);
  assert.equal(input.offer.workingTimeOriginal, rawOffer.dureeTravailLibelleConverti);
  assert.equal(input.offer.employerNameOriginal, rawOffer.entreprise.nom);
  assert.equal(input.offer.locationLabelOriginal, rawOffer.lieuTravail.libelle);
  assert.equal(input.offer.postalCode, rawOffer.lieuTravail.codePostal);
  assert.equal(input.offer.inseeCode, rawOffer.lieuTravail.commune);
  assert.equal(input.offer.latitude, rawOffer.lieuTravail.latitude);
  assert.equal(input.offer.longitude, rawOffer.lieuTravail.longitude);
  assert.equal(input.offer.romeCodeOriginal, rawOffer.romeCode);
  assert.equal(input.offer.romeTitleOriginal, rawOffer.romeLibelle);
  assert.equal(input.offer.active, true);
  assert.equal(input.offer.titleNormalized, undefined);
  assert.equal(input.offer.contractTypeNormalized, undefined);
  assert.equal(input.source.sourceId, "france-travail");
  assert.equal(input.source.externalId, rawOffer.id);
  assert.equal(input.source.sourceUrl, rawOffer.origineOffre.urlOrigine);
  assert.deepEqual(input.source.rawPayload, rawOffer);
  assert.notEqual(input.observedAt, input.offer.publicationDate);
  assert.equal(input.offer.publicationDate, "2026-07-23T06:15:00.000Z");
});

test("une offre minimale accepte tous les champs métier absents", () => {
  const input = toJobOfferUpsertInput({ id: "MIN-1", intitule: "Conseiller emploi" }, observedAt);
  assert.equal(input.offer.titleOriginal, "Conseiller emploi");
  assert.equal(input.offer.descriptionOriginal, null);
  assert.equal(input.offer.contractTypeOriginal, null);
  assert.equal(input.offer.salaryOriginal, null);
  assert.equal(input.offer.experienceOriginal, null);
  assert.equal(input.offer.qualificationOriginal, null);
  assert.equal(input.offer.workingTimeOriginal, null);
  assert.equal(input.offer.publicationDate, null);
  assert.equal(input.offer.employerNameOriginal, null);
  assert.equal(input.offer.locationLabelOriginal, null);
  assert.equal(input.offer.inseeCode, null);
  assert.equal(input.offer.latitude, null);
  assert.equal(input.offer.longitude, null);
  assert.equal(input.offer.romeCodeOriginal, null);
  assert.equal(input.source.externalId, "MIN-1");
  assert.equal(input.source.sourceUrl, "https://candidat.francetravail.fr/offres/recherche/detail/MIN-1");
});

test("le raw payload exclut récursivement OAuth, headers et secrets", () => {
  const input = toJobOfferUpsertInput({
    id: "SAFE-1",
    intitule: "Référent insertion",
    access_token: "token-interdit",
    client_secret: "secret-interdit",
    headers: { authorization: "Bearer secret" },
    entreprise: { nom: "Employeur", clientId: "client-interdit" },
  }, observedAt);
  const serialized = JSON.stringify(input.source.rawPayload);
  assert.doesNotMatch(serialized, /token-interdit|secret-interdit|client-interdit|authorization/i);
  assert.match(serialized, /Employeur/);
});

test("les deux recherches géographiques restent strictement bornées", () => {
  const [department, radius] = createFranceTravailSearches();
  assert.equal(createFranceTravailSearches().length, 2);
  assert.deepEqual(Object.fromEntries(department), { departement: "47", sort: "1" });
  assert.deepEqual(Object.fromEntries(radius), { commune: "47277", distance: "30", sort: "1" });
  const serialized = createFranceTravailSearches().map(String).join("&");
  assert.doesNotMatch(serialized, /33227|distance=45/);
});

test("les offres de tous métiers sont conservées et dédupliquées entre territoires", async () => {
  const offers = [
    { id: "CIP", intitule: "Conseiller en insertion professionnelle" },
    { id: "COMMERCE", intitule: "Vendeur en magasin" },
    { id: "INDUSTRIE", intitule: "Opérateur de production" },
    { id: "SERVICE", intitule: "Agent de nettoyage" },
  ];
  const duplicate = { ...offers[0], description: "Version du second périmètre" };
  const unique = deduplicateFranceTravailOffers([
    { resultats: offers },
    { resultats: [duplicate] },
  ]);
  const persisted = [];
  await persistFranceTravailOffers(unique, observedAt, async (input) => {
    persisted.push(input);
    return { offer: { id: input.source.externalId }, source: {} };
  });
  assert.deepEqual(unique.map((offer) => offer.id), ["CIP", "COMMERCE", "INDUSTRIE", "SERVICE"]);
  assert.equal(persisted.length, 4);
  assert.equal(new Set(persisted.map((input) => input.source.externalId)).size, 4);
  assert.equal(persisted.every((input) => input.observedAt === observedAt), true);
});

test("une page complète appelle la suivante, puis une page partielle arrête sans requête inutile", async () => {
  const ranges = [];
  const offers = await collectFranceTravailSearch(
    new URLSearchParams({ departement: "47", sort: "1" }),
    async (params) => {
      ranges.push(params.get("range"));
      return ranges.length === 1
        ? { resultats: Array.from({ length: 3 }, (_, index) => ({ id: `PAGE-1-${index}`, intitule: `Métier ${index}` })) }
        : { resultats: [{ id: "PAGE-2", intitule: "Autre métier" }] };
    },
    { pageSize: 3, maxPages: 5 },
  );
  assert.deepEqual(ranges, ["0-2", "3-5"]);
  assert.equal(offers.length, 4);
});

test("une réponse vide arrête la pagination", async () => {
  let calls = 0;
  const offers = await collectFranceTravailSearch(new URLSearchParams({ departement: "47" }), async () => {
    calls += 1;
    return { resultats: [] };
  });
  assert.equal(calls, 1);
  assert.deepEqual(offers, []);
});

test("une offre présente sur deux pages n'est collectée qu'une fois", async () => {
  let page = 0;
  const offers = await collectFranceTravailSearch(new URLSearchParams({ departement: "47" }), async () => {
    page += 1;
    return page === 1
      ? { resultats: [{ id: "DUP", intitule: "Métier A" }, { id: "UNIQUE", intitule: "Métier B" }] }
      : { resultats: [{ id: "DUP", intitule: "Métier A actualisé" }] };
  }, { pageSize: 2, maxPages: 3 });
  assert.deepEqual(offers.map((offer) => offer.id), ["DUP", "UNIQUE"]);
});

test("la limite de sécurité arrête une pagination toujours pleine", async () => {
  let calls = 0;
  await assert.rejects(
    collectFranceTravailSearch(new URLSearchParams({ departement: "47" }), async () => {
      calls += 1;
      return { resultats: [{ id: `A-${calls}`, intitule: "Métier A" }] };
    }, { pageSize: 1, maxPages: 2 }),
    /limite de sécurité atteinte après 2 pages/,
  );
  assert.equal(calls, 2);
});

test("une réponse paginée invalide produit un diagnostic explicite", async () => {
  await assert.rejects(
    collectFranceTravailSearch(new URLSearchParams({ departement: "47" }), async () => ({ resultats: "invalide" })),
    /réponse invalide.*0-149/,
  );
  await assert.rejects(
    collectFranceTravailSearch(
      new URLSearchParams({ departement: "47" }),
      async () => ({ resultats: [
        { id: "A", intitule: "Métier A" },
        { id: "B", intitule: "Métier B" },
      ] }),
      { pageSize: 1, maxPages: 2 },
    ),
    /2 résultats pour une plage de 1/,
  );
});

test("tous les upserts sont attendus avant un échec de persistance aseptisé", async () => {
  const offers = Array.from({ length: 7 }, (_, index) => ({
    id: `ERR-${index}`,
    intitule: `Chargé insertion ${index}`,
  }));
  let attempts = 0;
  await assert.rejects(
    persistFranceTravailOffers(offers, observedAt, async (input) => {
      attempts += 1;
      if (input.source.externalId === "ERR-2") throw new Error("payload secret-super-sensible");
      return { offer: {}, source: {} };
    }, 3),
    (error) => {
      assert.match(error.message, /1 offre\(s\) en échec/);
      assert.doesNotMatch(error.message, /ERR-2|secret-super-sensible|payload/);
      return true;
    },
  );
  assert.equal(attempts, offers.length);
});

test("le collecteur publie et persiste exactement le même ensemble territorial unique", async () => {
  const collector = await read("lib/collector.ts");
  const adapter = await read("lib/france-travail-job-offer.ts");
  assert.match(collector, /collectFranceTravailSearch\(search/);
  assert.match(collector, /const uniqueOffers = deduplicateFranceTravailOffers\(payloads\)/);
  assert.match(collector, /await persistFranceTravailOffers\(uniqueOffers, checkedAt, upsertJobOfferFromSource\)/);
  assert.match(collector, /const items = uniqueOffers\.map/);
  assert.match(collector, /return \{ items, itemsCollected: uniqueOffers\.length \}/);
  assert.doesNotMatch(`${collector}\n${adapter}`, /RELEVANT_JOB_PATTERN|selectRelevantFranceTravailOffers|\.slice\(0, 20\)/);
  assert.match(collector, /const FRANCE_TRAVAIL_TIMEOUT_MS = 120_000/);
  assert.match(collector, /source: get\("france-travail"\), run: franceTravail, timeoutMs: FRANCE_TRAVAIL_TIMEOUT_MS/);
  assert.match(collector, /id: `ft-\$\{offer\.id\}`/);
  assert.match(collector, /summary: clean\(offer\.description\)\.slice\(0, 280\)/);
  assert.match(collector, /source: "France Travail — API officielle"/);
});

test("aucun DDL ni écriture ne rejoint la route publique", async () => {
  const route = await read("app/api/veille/route.ts");
  const adapter = await read("lib/france-travail-job-offer.ts");
  assert.doesNotMatch(route, /upsertJobOffer|persistFranceTravail|runCollection|fetch\(|INSERT|UPDATE|DELETE/);
  assert.doesNotMatch(adapter, /CREATE TABLE|CREATE INDEX|ALTER TABLE|DROP TABLE/);
});
