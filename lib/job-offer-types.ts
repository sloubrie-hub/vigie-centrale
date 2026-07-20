export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JobOfferInput = {
  titleOriginal: string;
  titleNormalized?: string | null;
  descriptionOriginal?: string | null;
  contractTypeOriginal?: string | null;
  contractTypeNormalized?: string | null;
  salaryOriginal?: string | null;
  experienceOriginal?: string | null;
  qualificationOriginal?: string | null;
  workingTimeOriginal?: string | null;
  publicationDate?: string | null;
  employerNameOriginal?: string | null;
  employerSiret?: string | null;
  employerSiren?: string | null;
  locationLabelOriginal?: string | null;
  postalCode?: string | null;
  inseeCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  romeCodeOriginal?: string | null;
  romeTitleOriginal?: string | null;
  active?: boolean;
};

export type JobOfferSourceInput = {
  sourceId: string;
  externalId: string;
  sourceUrl?: string | null;
  rawPayload: JsonValue;
};

export type UpsertJobOfferFromSourceInput = {
  offer: JobOfferInput;
  source: JobOfferSourceInput;
  observedAt?: string;
};

export type JobOfferRecord = {
  id: string;
  titleOriginal: string;
  titleNormalized: string | null;
  descriptionOriginal: string | null;
  contractTypeOriginal: string | null;
  contractTypeNormalized: string | null;
  salaryOriginal: string | null;
  experienceOriginal: string | null;
  qualificationOriginal: string | null;
  workingTimeOriginal: string | null;
  publicationDate: string | null;
  employerNameOriginal: string | null;
  employerSiret: string | null;
  employerSiren: string | null;
  locationLabelOriginal: string | null;
  postalCode: string | null;
  inseeCode: string | null;
  latitude: number | null;
  longitude: number | null;
  romeCodeOriginal: string | null;
  romeTitleOriginal: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type JobOfferSourceRecord = {
  id: string;
  jobOfferId: string;
  sourceId: string;
  externalId: string;
  sourceUrl: string | null;
  rawPayload: JsonValue;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

export type JobOfferWithSourceRecord = {
  offer: JobOfferRecord;
  source: JobOfferSourceRecord;
};
