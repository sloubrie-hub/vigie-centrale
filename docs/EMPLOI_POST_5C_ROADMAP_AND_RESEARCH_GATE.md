# VIGIE CENTRALE — EMPLOI POST-5C
# Roadmap consolidée après audit externe

## 0. Statut

Ce document formalise la cible fonctionnelle et technique de la verticale **Emploi** à partir du Lot 5C, après le gate externe :

```text
POST_5C_EXTERNAL_REUSE_AUDIT
→ POST_5C_EXTERNAL_REUSE_AUDIT_REPAIR_01
→ CONSOLIDATION
```

Le résultat de la recherche externe est :

```text
MAJOR_ARCHITECTURE_DELTA : NO
MATERIAL_DESIGN_DELTAS   : YES
CONFIDENCE               : MEDIUM
```

La stack de référence reste :

```text
Next.js
TypeScript
React
Vercel
Neon PostgreSQL
```

Aucune justification n'a été trouvée pour introduire à ce stade :

```text
Kafka
Kubernetes
microservices
Elasticsearch / OpenSearch
vector database
external search engine
```

Le Lot 5C reste le chantier actif. La PR correspondante doit rester non fusionnée tant que sa qualification Preview et les probes API requis ne sont pas terminés.

---

# 1. Principes directeurs consolidés

## 1.1 Séparer corpus, veille, recherche et publication

Architecture cible :

```text
FRANCE TRAVAIL
      |
      v
CORPUS EMPLOI NOUVELLE-AQUITAINE
      |
      +--> VEILLE PERSONNELLE PAR DEFAUT
      |      Lot-et-Garonne + Marmande 30 km
      |
      +--> RECHERCHE STRUCTUREE
      |
      +--> VEILLES SAUVEGARDEES
      |
      +--> HISTORIQUE / ANALYSE
      |
      +--> QUALIFICATION ROME
```

Le corpus régional peut être exhaustif sans que chaque offre devienne une carte du feed principal.

## 1.2 Séparer donnée source et donnée qualifiée

Pour ROME :

```text
ROME_SOURCE
!=
ROME_QUALIFIED
```

Le code fourni par France Travail est conservé tel quel et ne doit jamais être écrasé par une qualification locale.

## 1.3 PostgreSQL-first

Par défaut :

```text
PostgreSQL
+ BTREE
+ GIN FTS
+ pg_trgm
```

Doit être essayé, mesuré et optimisé avant toute introduction d'un moteur de recherche externe.

---

# 2. Lot 5C — veille locale tous métiers

## 2.1 Contrat fonctionnel

```text
SEARCH A
  departement=47

SEARCH B
  commune=47277
  distance=30

A + B
→ PAGINATION
→ MERGE
→ DEDUP BY FRANCE_TRAVAIL_ID
→ PERSIST
→ PUBLISH SAME UNIQUE SET
```

Contraintes :

- aucun filtre métier ;
- aucune limite arbitraire à 20 offres ;
- déduplication par identifiant France Travail ;
- même ensemble unique pour persistance et publication ;
- aucune migration liée au Lot 5C ;
- aucun élargissement vers le corpus régional, ROME ou saved searches.

## 2.2 Géographie

Décision :

```text
FT_NATIVE_RADIUS : KEEP
```

Le contrat de collecte utilise :

```text
commune=47277
distance=30
```

Il ne faut pas remplacer ce mécanisme dans le Lot 5C par :

```text
PostGIS
Haversine
liste manuelle de communes
```

Le rayon France Travail doit être accepté comme la sémantique métier de la veille locale, sauf décision ultérieure exigeant explicitement un cercle géométrique strict.

Ne jamais ajouter `departement=47` ou `region=75` à SEARCH B : cela casserait le caractère transfrontalier administratif du rayon.

## 2.3 Pagination

État documentaire candidat issu de l'audit :

```text
PAGE_SIZE_MAX        : 150
RANGE_DOCUMENTED     : 0..3149
CURRENT LOT 5C       : 20 pages × 150 = 0..2999
```

Décision :

```text
LOT_5C_PAGINATION_MISMATCH : NO
MAX_PAGES_20_CHANGE_NOW    : NO
```

Mais il existe un cas conditionnel :

```text
IF authenticated total <= 3000
  KEEP CURRENT PAGINATION

IF 3000 < total <= 3150
  COMPLETE LAST RANGE

IF total > documented query ceiling
  PARTITION QUERY BEFORE CLAIMING EXHAUSTIVITY
```

Aucune modification ne doit être faite sur hypothèse : le comportement réel doit être confirmé avec les credentials Vigie.

## 2.4 Rate limit

Référence candidate de l'audit :

```text
10 requests / second
```

Le Lot 5C restant séquentiel, aucune architecture de rate limiting distribuée n'est justifiée.

Pattern suffisant :

```text
SEQUENTIAL REQUESTS
+ bounded retry on 429 / 5xx
+ honor Retry-After if present
```

## 2.5 Checkpoint obligatoire avant fusion

Le Lot 5C est :

```text
SAFE_TO_CONTINUE_PREVIEW_VALIDATION : CONDITIONAL
```

Probes authentifiés requis :

1. `commune=47277&distance=30&range=0-149` ;
2. résultats hors département 47 dans le rayon, si présents ;
3. `departement=47&range=0-149` ;
4. `Content-Range` réel ;
5. page `150-299` ;
6. page `2850-2999` si la requête est assez large ;
7. `3000-3149` sur une requête permettant de tester le plafond ;
8. statut au-delà du plafond ;
9. comportement 200 / 204 / 206 ;
10. vérification que les totals réels des recherches A et B ne créent pas de troncature.

Le probe de quota ne doit pas devenir un load test.

---

# 3. Lot 6 — fiabilité par thème

## 3.1 Constat

Vigie possède déjà :

```text
source timeouts
collector timeout
Promise.allSettled
collector isolation
collection_runs
source_runs
last attempt
last success
consecutive failures
recent success rate
global reliability
employment reliability
```

Le Lot 6 ne doit donc pas devenir une nouvelle architecture SRE.

## 3.2 Delta réel

```text
SOURCE_HEALTH
+
SOURCE_TO_THEME_DEPENDENCIES
+
REQUIRED / OPTIONAL
+
FRESHNESS_POLICY
+
LAST_COLLECTION_PARTICIPATION
→
THEME_RELIABILITY
```

États métier candidats :

```text
AVAILABLE
DEGRADED
STALE
UNAVAILABLE
UNKNOWN
```

## 3.3 Décision

```text
LOT_6_ARCHITECTURE_DELTA : SMALL
NO_NEW_INFRASTRUCTURE    : YES
```

Ne pas ajouter pour ce besoin seul :

```text
microservices
circuit breakers supplémentaires
nouveaux schedulers
health endpoints techniques par thème
```

Le Lot 6 est le **prochain lot à implémenter après clôture du Lot 5C**.

---

# 4. Lot 7A — corpus Nouvelle-Aquitaine

## 4.1 Objectif

Constituer un corpus structuré des offres France Travail Nouvelle-Aquitaine sans publier automatiquement tout le corpus dans le feed.

## 4.2 Première action obligatoire

Ne plus estimer la volumétrie par population.

Effectuer :

```text
region=75
range=0-0
→ Content-Range
→ total réel
```

Si le contrat courant de l'API l'autorise.

```text
VOLUME_REQUIRES_AUTHENTICATED_PROBE : YES
```

## 4.3 Partitionnement adaptatif

Pattern cible :

```text
QUERY region=75

IF total <= query ceiling
    REGION_DIRECT
ELSE
    PARTITION_BY_DEPARTMENT

FOR EACH department
    IF total <= query ceiling
        FETCH
    ELSE
        SPLIT_BY_CREATION_DATE

DEDUP_BY_SOURCE_ID
```

Ne pas partitionner par ROME pour résoudre un problème de pagination territoriale.

## 4.4 Synchronisation

Un simple :

```text
LAST_SYNC
→ minCreationDate
```

ne suffit pas pour maintenir un corpus actif fiable.

Architecture cible :

```text
INCREMENTAL_CREATION_DISCOVERY
+
PERIODIC_PARTITIONED_ACTIVE_SNAPSHOT
+
RECONCILIATION
```

Concepts à prévoir :

```text
FIRST_SEEN_AT
LAST_SEEN_AT
SOURCE_UPDATED_AT
CONTENT_HASH
CLOSED_AT
REAPPEARED_AT
```

sans figer prématurément le SQL.

Règle fail-closed :

```text
ABSENT FROM COMPLETE + SUCCESSFUL + NON_TRUNCATED RECONCILIATION
→ may become CLOSED

ABSENT FROM PARTIAL / FAILED / TRUNCATED RECONCILIATION
→ STALE / UNKNOWN
→ NEVER CLOSED
```

Une réapparition avec le même ID France Travail est fiable ; le rapprochement de deux IDs différents reste probabiliste.

## 4.5 Fréquence cible

Objectif initial si quota/volume compatibles :

```text
DAILY RECONCILIATION
```

Fallback raisonnable :

```text
48 HOURS
```

Une réconciliation hebdomadaire est trop lente si l'interface prétend exposer un état actif fiable.

## 4.6 Blockers

Avant implémentation finale du corpus historique régional :

```text
AUTHENTICATED REGION 75 VOLUME PROBE
+
FRANCE TRAVAIL STORAGE / RETENTION / REDISTRIBUTION TERMS VERIFICATION
```

---

# 5. Lot 7B1 — référentiel ROME local et versionné

## 5.1 Décision acquise

```text
ROME_RUNTIME_STRATEGY : LOCAL_VERSIONED_COPY
ROME_API_AT_RUNTIME    : NO
VERSION_CHECK          : WEEKLY
IMPORT                 : ONLY_IF_CHANGED
```

Le runtime local doit servir :

```text
autocomplete
resolver
search
qualification
navigation taxonomique
```

sans dépendance réseau vers l'API ROME.

## 5.2 Source

Source canonique : dataset officiel France Travail / data.gouv ROME.

Le ROME est traité comme :

```text
BUSINESS_REFERENTIAL_VERSION
+
DATASET_RELEASE
```

Ne pas confondre un numéro de release de fichiers avec une version métier du ROME.

## 5.3 Détection de changement

Pattern :

```text
WEEKLY DATA.GOUV METADATA CHECK
→ compare dataset/resource metadata
→ IF unchanged: STOP
→ download candidate resources
→ compute local SHA-256
→ IF hashes unchanged: STOP
→ VALIDATE
→ IMPORT TO STAGING
→ DIFF
→ ATOMIC ACTIVATE
→ PRESERVE OLD VERSION
```

Ne pas dépendre de la présence d'un ETag ou d'un checksum officiel.

## 5.4 Modèle conceptuel minimal

```text
rome_referential_versions
rome_occupations
rome_appellations
rome_competencies
rome_contexts
```

avec relations nécessaires, sans figer maintenant le DDL.

Le diff interversion doit pouvoir identifier :

```text
ADDED
REMOVED
CHANGED_LABEL
CHANGED_APPELLATIONS
CHANGED_COMPETENCIES
CHANGED_CONTEXTS
CHANGED_HIERARCHY
```

## 5.5 Licence

Décision issue de l'audit :

```text
ROME_LOCAL_STORAGE_LEGAL  : YES
ROME_VERSION_HISTORY_LEGAL: YES
ATTRIBUTION_REQUIRED      : YES
```

---

# 6. Lot 7B2 — resolver métier -> ROME

## 6.1 Contrat

```text
FREE_TEXT_JOB_INPUT
→ NORMALIZE
→ ROME_REFERENTIAL_SEARCH
→ MATCHING_APPELLATIONS
→ GROUP_BY_ROME
→ USER_DISAMBIGUATION
→ ONE_OR_MORE_ROME_CODES
→ STRUCTURED_QUERY
```

## 6.2 Stack

```text
POSTGRESQL
+
NORMALIZED SEARCH TEXT
+
FTS
+
pg_trgm
```

Ordre de scoring initial :

```text
1. exact ROME code
2. exact normalized label/appellation
3. prefix match
4. token / FTS match
5. trigram fuzzy match
```

Normalisation minimale :

```text
lowercase
unaccent
apostrophes normalized
hyphens normalized
whitespace collapsed
```

## 6.3 Décision

```text
LOT_7B2              : IMPLEMENT_AS_PLANNED
EXTERNAL_SEARCH_ENGINE_REQUIRED : NO
```

---

# 7. Lot 7B3 — autocomplete métier

## 7.1 UX cible

```text
0-2 chars → NO_QUERY
>=3 chars → QUERY
initial debounce ≈ 300 ms
```

Ces valeurs sont des paramètres de départ, pas des standards immuables.

Pipeline :

```text
input
→ normalized lookup
→ rank matching appellations
→ group by ROME
→ show canonical occupation
→ show matching appellations
→ select 1..N ROME codes
```

Règles :

- 8–12 groupes visibles avant scroll comme point de départ ;
- navigation clavier ;
- highlight du texte correspondant ;
- métier/appellation visuellement prioritaire ;
- code ROME secondaire mais visible ;
- multi-select par chips ou contrôle équivalent ;
- ne jamais convertir silencieusement le texte libre en un ROME.

## 7.2 Décision

```text
LOT_7B3 : IMPLEMENT_AS_PLANNED
```

---

# 8. Lot 7B4 — qualification ROME des annonces

## 8.1 Statut

```text
LOT_7B4 : RESEARCH_MORE
```

Le design est assez défini pour un POC, pas pour une capability production.

## 8.2 Contrat

Conserver distinctement :

```text
ROME_SOURCE
ROME_CANDIDATE
ROME_QUALIFIED
```

Statuts :

```text
MATCH
PARTIAL_MATCH
MISMATCH
AMBIGUOUS
NO_SOURCE_ROME
INSUFFICIENT_EVIDENCE
```

Le système doit accepter l'abstention et plusieurs candidats.

## 8.3 Pipeline MVP candidat

```text
STEP 1
TITLE / APPELLATION MATCH

STEP 2
TOP-K ROME RETRIEVAL

STEP 3
DESCRIPTION
+ COMPETENCE
+ ACTIVITY
+ CONTEXT EVIDENCE

STEP 4
LEXICAL RERANK

STEP 5
COMPARE SOURCE ROME WITH CANDIDATE SET

STEP 6
DECISION + ABSTENTION
```

MVP autorisé sans :

```text
embeddings
LLM
supervised model
```

Positionnement obligatoire du MVP :

```text
ROME VERIFICATION / TRIAGE
```

et non :

```text
AUTHORITATIVE AUTOMATIC CODER
```

## 8.4 Escalade de complexité

Uniquement si un benchmark humain démontre le besoin :

```text
1. lexical retrieval
2. embeddings retrieval
3. cross-encoder reranking
4. supervised / hierarchical classifier
5. constrained LLM evidence/reranking
```

Ne jamais utiliser :

```text
JOB DESCRIPTION
→ unconstrained LLM
→ ROME CODE
```

## 8.5 Production gate

Les codes France Travail peuvent servir de pseudo-labels mais pas de gold standard pour mesurer un mécanisme destiné à détecter leurs erreurs.

Gold dataset stratifié :

```text
OBVIOUS_MATCH
PARTIAL_MATCH
REAL_MISMATCH
AMBIGUOUS
NO_SOURCE_ROME
INSUFFICIENT_EVIDENCE
```

Les cas mismatch/ambiguous doivent idéalement avoir double revue humaine + arbitrage en cas de désaccord.

Ordres de grandeur d'ingénierie :

```text
POC              : 200-300
CONTROLLED_TRIAL : 750-1000
PRODUCTION_GATE  : 1500-3000
```

Métriques prioritaires :

```text
TOP_1_ACCURACY
TOP_3_RECALL
TOP_5_RECALL
PRECISION_ON_MISMATCH
RECALL_ON_MISMATCH
FALSE_MISMATCH_RATE
ABSTENTION_PRECISION
SELECTIVE_ACCURACY_VS_COVERAGE
CONFIDENCE_CALIBRATION
```

Pour Vigie, le `FALSE_MISMATCH_RATE` est critique : une abstention est préférable à une accusation erronée de mauvais ROME.

## 8.6 Open source

Aucun composant externe n'est retenu comme dépendance directe.

Les projets étudiés ne servent que de patterns d'inspiration pour :

```text
candidate retrieval
entity/taxonomy linking
reranking
abstention
```

---

# 9. ESCO

Décision :

```text
ESCO_ROLE            : OPTIONAL_REFERENCE
ESCO_CORE_DEPENDENCY : NO
```

Le mapping institutionnel ESCO/France existe, mais sa correspondance exacte avec les versions actuellement actives de ROME et ESCO n'est pas assez établie pour en faire une dépendance de validation.

ESCO peut ultérieurement servir d'enrichissement ou de comparaison, pas de vérité secondaire obligatoire.

---

# 10. Lot 7C — moteur de recherche Emploi

## 10.1 Dépendances

Le moteur ne doit pas attendre la qualification ROME complète 7B4.

Première version :

```text
ROME_SOURCE
+
ROME_RESOLVER
+
STRUCTURED FILTERS
```

Extension ultérieure :

```text
ROME_QUALIFIED
```

comme facette supplémentaire.

## 10.2 Critères

Le moteur doit pouvoir combiner :

- un ou plusieurs codes ROME ;
- texte libre ;
- région ;
- département ;
- commune ;
- rayon ;
- contrat ;
- date/fraîcheur ;
- employeur ;
- salaire ;
- temps de travail ;
- télétravail si fiable ;
- statut actif/fermé lorsque le modèle 7A le permet ;
- ROME source puis, plus tard, ROME qualifié.

## 10.3 Indexation

Point de départ :

```text
BTREE
  dates
  contract
  department
  region
  normalized employer
  salary/work-time fields

GIN FTS
  weighted title
  description

pg_trgm
  title
  employer
  ROME appellations
  short typo-sensitive fields
```

Ne pas indexer en trigrammes chaque colonne par défaut.

## 10.4 Pagination / facettes

Premières pages : `LIMIT/OFFSET` acceptable.

Navigation profonde : préférer cursor/keyset si nécessaire.

Facettes : commencer par SQL correctement indexé avant de dénormaliser/cacher les compteurs.

## 10.5 Deep links

Les critères doivent être sérialisés dans l'URL afin de permettre :

```text
BACK/FORWARD
SHAREABLE_SEARCH
DEEP_LINK
SAVED_SEARCH_CANONICALIZATION
```

## 10.6 Décision

```text
LOT_7C              : IMPLEMENT_AS_PLANNED
POSTGRESQL_SUFFICIENT: YES
```

Déclencheur pour envisager un moteur externe : uniquement une limite mesurée après optimisation PostgreSQL.

---

# 11. Géographie locale du moteur

Séparer :

```text
COLLECTION_GEOGRAPHY
vs
LOCAL_SEARCH_GEOGRAPHY
```

Pour la collecte Lot 5C, l'API France Travail gère le rayon.

Pour le moteur local PostgreSQL, stocker progressivement :

```text
commune_insee
department
region
latitude
longitude
```

Modèle recommandé :

```text
ADMINISTRATIVE_CODES
+
LATITUDE/LONGITUDE
+
BOUNDING BOX PREFILTER
+
LIGHTWEIGHT GREAT-CIRCLE DISTANCE
```

ou `earthdistance` si l'extension Neon est appropriée.

```text
POSTGIS_REQUIRED : NO
```

---

# 12. Lot 7D — recherches / veilles sauvegardées

## 12.1 Contrat

```text
SEARCH
→ SAVE
→ PERIODIC EXECUTION
→ DETECT NEW MATCHES
→ OPTIONAL NOTIFICATION
```

## 12.2 Modèle recommandé

Ne pas se limiter à `last_run`.

Pattern :

```text
CANONICAL_QUERY
+
QUERY_VERSION
+
QUERY_FINGERPRINT
+
PERSISTENT_MATCH_TABLE
+
IDEMPOTENT_NOTIFICATION
```

Conceptuellement :

```text
saved_search
  id
  canonical_query
  query_version
  fingerprint
  enabled
  cadence

saved_search_match
  saved_search_id
  query_version
  offer_id
  first_matched_at
  last_matched_at
  notified_at
```

Lors d'une modification majeure :

```text
query_version++
→ establish baseline
→ do not resend all existing matches as new
```

## 12.3 Décision

```text
LOT_7D : ADAPT_BEFORE_IMPLEMENTATION
```

---

# 13. Lot 7E — suivi candidat

Fonctionnalité utile mais périphérique :

```text
INTERESSANTE
VUE
CANDIDATURE_PREVUE
ENVOYEE
RELANCE
ENTRETIEN
REFUS
RETENUE
```

Décision :

```text
LOT_7E : DEFER
ROLE   : DEFERRED_OPTIONAL_CAPABILITY
```

Seule contrainte à préserver maintenant : une candidature future ne doit pas disparaître lorsque l'offre source disparaît ; le suivi devra donc pouvoir conserver un snapshot minimal de l'offre.

---

# 14. Conditions d'utilisation France Travail

Ne pas inférer :

```text
OPEN API
→ OPEN LICENSE FOR ALL PAYLOADS
```

Avant le corpus régional historique persistant 7A, vérifier explicitement :

```text
STORAGE_RIGHTS
RETENTION_RIGHTS
REDISTRIBUTION_RIGHTS
PUBLIC_DISPLAY_RIGHTS
ATTRIBUTION_REQUIREMENTS
```

Statut actuel :

```text
LEGAL_TERMS_TO_VERIFY
```

Ce point ne bloque pas les probes techniques du Lot 5C mais bloque une décision définitive d'historisation régionale à long terme.

---

# 15. Roadmap révisée

Dépendances :

```text
                    ┌── 7A corpus/sync ───────────┐
5C → 6 ─────────────┤                              ├→ 7C → 7D
                    └── 7B1 → 7B2 → 7B3 ────────┘

                         7B4 = independent R&D gate
                         7E  = deferred
```

Ordre pratique par défaut :

```text
5C
→ 6
→ 7A
→ 7B1
→ 7B2
→ 7B3
→ 7C
→ 7D
→ 7B4 controlled research/trial
→ 7E deferred
```

Exception :

```text
IF 7A blocked by API probes or legal terms
THEN implement 7B1 while 7A is blocked
```

Le moteur 7C ne doit pas attendre 7B4.

---

# 16. Verdicts consolidés

```text
LOT_5C  : ADAPT_BEFORE_IMPLEMENTATION
           (validation/probes d'abord ; code inchangé tant qu'aucun mismatch réel n'est observé)

LOT_6   : ADAPT_BEFORE_IMPLEMENTATION
           (small delta, no new infrastructure)

LOT_7A  : ADAPT_BEFORE_IMPLEMENTATION

LOT_7B1 : ADAPT_IMPORT_MECHANISM

LOT_7B2 : IMPLEMENT_AS_PLANNED

LOT_7B3 : IMPLEMENT_AS_PLANNED

LOT_7B4 : RESEARCH_MORE

LOT_7C  : IMPLEMENT_AS_PLANNED

LOT_7D  : ADAPT_BEFORE_IMPLEMENTATION

LOT_7E  : DEFER
```

---

# 17. Gate de recherche externe — état

Le gate général post-5C a été exécuté.

Résultat :

```text
EXTERNAL_RESEARCH_REVEALS_MAJOR_ARCHITECTURE_DELTA : NO
REMAINING_ARCHITECTURE_UNCERTAINTY                  : MEDIUM
```

La recherche externe ne doit pas être recommencée globalement avant chaque lot.

À partir de maintenant :

```text
LOT_CONTRACT
→ TARGETED RESEARCH ONLY IF OPEN QUESTION EXISTS
→ IMPLEMENTATION
→ PREVIEW VALIDATION
→ HUMAN CHECKPOINT
```

Recherche supplémentaire explicitement encore requise :

```text
7B4 qualification ROME
```

Vérification externe/contractuelle encore requise :

```text
France Travail API current authenticated behavior
France Travail storage/retention/redistribution terms before durable regional replication
```

---

# 18. Prochaine action projet

Le chantier reste :

```text
LOT_5C
```

Séquence immédiate :

```text
1. terminer l'isolation Neon Preview
2. exécuter les probes France Travail authentifiés dans Preview / environnement sûr
3. déclencher une collecte Preview Lot 5C
4. vérifier Content-Range, pagination, totals, déduplication et persistance
5. corriger uniquement si un mismatch réel est démontré
6. valider / fusionner Lot 5C
7. qualifier Production
8. ouvrir Lot 6
```

Aucun développement Lot 6/7 ne doit commencer avant la clôture du Lot 5C, sauf blocage durable explicitement décidé.
