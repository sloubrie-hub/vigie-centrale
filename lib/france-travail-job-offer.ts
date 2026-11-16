import type { JobOfferWithSourceRecord, JsonValue, UpsertJobOfferFromSourceInput } from "./job-offer-types.ts";

export type FranceTravailOffer = {
  id: string;
  intitule: string;
  description?: string;
  dateCreation?: string;
  typeContrat?: string;
  typeContratLibelle?: string;
  experienceLibelle?: string;
  qualificationLibelle?: string;
  dureeTravailLibelle?: string;
  dureeTravailLibelleConverti?: string;
  romeCode?: string;
  romeLibelle?: string;
  salaire?: { libelle?: string; [key: string]: unknown };
  lieuTravail?: {
    libelle?: string;
    codePostal?: string;
    commune?: string;
    latitude?: number;
    longitude?: number;
    [key: string]: unknown;
  };
  entreprise?: { nom?: string; [key: string]: unknown };
  origineOffre?: { urlOrigine?: string; [key: string]: unknown };
  [key: string]: unknown;
};

export type JobOfferUpsert = (
  input: UpsertJobOfferFromSourceInput,
) => Promise<JobOfferWithSourceRecord>;

const SENSITIVE_RAW_KEY = /^(?:access_?token|authorization|client_?id|client_?secret|headers?|oauth)$/i;
export const FRANCE_TRAVAIL_PAGE_SIZE = 150;
export const FRANCE_TRAVAIL_MAX_PAGES = 20;

export function createFranceTravailSearches(): URLSearchParams[] {
  return [
    new URLSearchParams({ departement: "47", sort: "1" }),
    new URLSearchParams({ commune: "47277", distance: "30", sort: "1" }),
  ];
}

export function franceTravailOfferUrl(offer: FranceTravailOffer): string {
  return offer.origineOffre?.urlOrigine
    || `https://candidat.francetravail.fr/offres/recherche/detail/${offer.id}`;
}

export function deduplicateFranceTravailOffers(
  payloads: Array<{ resultats: FranceTravailOffer[] }>,
): FranceTravailOffer[] {
  return [...new Map(
    payloads.flatMap((data) => data.resultats).map((offer) => [offer.id, offer]),
  ).values()];
}

type FranceTravailPageFetcher = (
  params: URLSearchParams,
) => Promise<{ resultats?: unknown } | null>;

export async function collectFranceTravailSearch(
  search: URLSearchParams,
  fetchPage: FranceTravailPageFetcher,
  { pageSize = FRANCE_TRAVAIL_PAGE_SIZE, maxPages = FRANCE_TRAVAIL_MAX_PAGES } = {},
): Promise<FranceTravailOffer[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || !Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error("Pagination France Travail : configuration invalide");
  }

  const offers: FranceTravailOffer[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const start = page * pageSize;
    const params = new URLSearchParams(search);
    params.set("range", `${start}-${start + pageSize - 1}`);
    const payload = await fetchPage(params);
    if (payload === null) return deduplicateFranceTravailOffers([{ resultats: offers }]);
    if (!Array.isArray(payload.resultats)) {
      throw new Error(`Pagination France Travail : réponse invalide pour la plage ${params.get("range")}`);
    }
    if (payload.resultats.length > pageSize) {
      throw new Error(`Pagination France Travail : ${payload.resultats.length} résultats pour une plage de ${pageSize}`);
    }
    const invalidOffer = payload.resultats.some((offer) => !offer || typeof offer !== "object"
      || typeof (offer as FranceTravailOffer).id !== "string"
      || typeof (offer as FranceTravailOffer).intitule !== "string");
    if (invalidOffer) {
      throw new Error(`Pagination France Travail : offre invalide pour la plage ${params.get("range")}`);
    }

    offers.push(...payload.resultats as FranceTravailOffer[]);
    if (payload.resultats.length < pageSize) {
      return deduplicateFranceTravailOffers([{ resultats: offers }]);
    }
  }

  throw new Error(`Pagination France Travail : limite de sécurité atteinte après ${maxPages} pages`);
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function validDate(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function validCoordinate(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function sanitizeRawValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(sanitizeRawValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key, nested]) => nested !== undefined && !SENSITIVE_RAW_KEY.test(key))
      .map(([key, nested]) => [key, sanitizeRawValue(nested)]));
  }
  return null;
}

export function toJobOfferUpsertInput(
  offer: FranceTravailOffer,
  observedAt: string,
): UpsertJobOfferFromSourceInput {
  return {
    observedAt,
    offer: {
      titleOriginal: offer.intitule,
      descriptionOriginal: optionalText(offer.description),
      contractTypeOriginal: optionalText(offer.typeContratLibelle) ?? optionalText(offer.typeContrat),
      salaryOriginal: optionalText(offer.salaire?.libelle),
      experienceOriginal: optionalText(offer.experienceLibelle),
      qualificationOriginal: optionalText(offer.qualificationLibelle),
      workingTimeOriginal: optionalText(offer.dureeTravailLibelleConverti)
        ?? optionalText(offer.dureeTravailLibelle),
      publicationDate: validDate(offer.dateCreation),
      employerNameOriginal: optionalText(offer.entreprise?.nom),
      locationLabelOriginal: optionalText(offer.lieuTravail?.libelle),
      postalCode: optionalText(offer.lieuTravail?.codePostal),
      inseeCode: optionalText(offer.lieuTravail?.commune),
      latitude: validCoordinate(offer.lieuTravail?.latitude, -90, 90),
      longitude: validCoordinate(offer.lieuTravail?.longitude, -180, 180),
      romeCodeOriginal: optionalText(offer.romeCode),
      romeTitleOriginal: optionalText(offer.romeLibelle),
      active: true,
    },
    source: {
      sourceId: "france-travail",
      externalId: offer.id,
      sourceUrl: franceTravailOfferUrl(offer),
      rawPayload: sanitizeRawValue(offer),
    },
  };
}

export async function persistFranceTravailOffers(
  offers: FranceTravailOffer[],
  observedAt: string,
  upsert: JobOfferUpsert,
  concurrency = 10,
): Promise<void> {
  const failures: unknown[] = [];
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, Math.trunc(concurrency)), offers.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < offers.length) {
      const offer = offers[cursor++];
      try {
        await upsert(toJobOfferUpsertInput(offer, observedAt));
      } catch (error) {
        failures.push(error);
      }
    }
  });
  await Promise.allSettled(workers);
  if (failures.length > 0) {
    throw new Error(`Persistance structurée France Travail : ${failures.length} offre(s) en échec`);
  }
}
