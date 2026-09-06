# VIGIE CENTRALE — EMPLOI POST-5C
# Roadmap canonique et gate de recherche / réutilisation

## 0. Statut

Ce document formalise la cible fonctionnelle de la verticale **Emploi** à partir du Lot 5C et impose un **gate de recherche externe / réutilisation** avant l’implémentation des lots suivants.

Le Lot 5C reste le chantier actif et n’est pas redéfini par ce document.

---

## 1. Principes directeurs

### 1.1 Séparer corpus, veille, recherche et publication

La cible n’est pas d’afficher toutes les offres collectées dans le flux principal.

Architecture cible :

```text
FRANCE TRAVAIL
      |
      v
CORPUS EMPLOI NOUVELLE-AQUITAINE
      |
      +--> VEILLE PERSONNELLE PAR DEFAUT
      |      47 + Marmande 30 km
      |
      +--> RECHERCHE STRUCTUREE
      |
      +--> VEILLES SAUVEGARDEES
      |
      +--> HISTORIQUE / ANALYSE
```

Le corpus régional peut être exhaustif sans que chaque offre devienne une carte de veille.

### 1.2 Périmètre territorial cible

- corpus persistant : **Nouvelle-Aquitaine** ;
- veille personnelle par défaut : **Lot-et-Garonne + rayon de 30 km autour de Marmande** ;
- possibilité ultérieure de requêtes et veilles sauvegardées sur tout ou partie du corpus régional.

### 1.3 Une donnée source n’est pas une donnée validée

Pour le métier et le ROME :

```text
ROME_SOURCE
!=
ROME_QUALIFIED
```

Le code ROME fourni par France Travail doit être conservé tel quel, mais ne doit jamais être considéré comme intrinsèquement exact.

---

## 2. Lot 5C — état et contrat à préserver

Objectif :

```text
VEILLE EMPLOI LOCALE
=
TOUTES les offres du département 47
+
TOUTES les offres dans un rayon de 30 km autour de Marmande
-
doublons
```

Contraintes :

- aucun filtre métier à la collecte ;
- aucune limite arbitraire de 20 offres ;
- pagination France Travail ;
- déduplication par identifiant France Travail ;
- même ensemble unique pour publication et persistance ;
- qualification Preview obligatoire avant fusion.

Le Lot 5C ne doit pas être élargi pour implémenter le moteur régional, le ROME ou les veilles sauvegardées.

---

## 3. Lot 6 — fiabilité par thème

Objectif : empêcher qu’une panne d’un thème rende artificiellement un autre thème inexploitable.

Cible :

```text
reliability.global
reliability.themes.emploi
reliability.themes.diablo4
reliability.themes.hearthstone
reliability.themes.cip
reliability.themes.tech
reliability.themes.ia
```

Exemple attendu :

```text
France Travail OK
YouTube Diablo KO

EMPLOI   = READY
DIABLO   = DEGRADED
GLOBAL   = DEGRADED
```

---

## 4. Lot 7A — corpus Emploi Nouvelle-Aquitaine

Objectif : constituer un corpus structuré et persistant de toutes les offres France Travail pertinentes territorialement pour la Nouvelle-Aquitaine.

Principes :

- collecte exhaustive régionale ;
- pagination robuste ;
- déduplication ;
- persistance structurée dans le modèle Emploi ;
- gestion de fraîcheur / disparition / réapparition à concevoir ;
- ne pas publier automatiquement toutes les offres dans le feed principal ;
- conserver la veille locale 47 + Marmande 30 km comme vue par défaut.

---

## 5. Lot 7B — couche ROME et qualification métier

### 5.1 Lot 7B1 — référentiel ROME local et versionné

Prévoir une représentation locale ou interrogeable de manière fiable du référentiel officiel permettant au minimum :

- code ROME ;
- libellé ;
- appellations métiers ;
- activités ;
- compétences ;
- contextes / éléments utiles à la qualification ;
- version du référentiel ;
- date de mise à jour.

Le mécanisme de mise à jour et les droits/licences doivent être vérifiés avant implémentation.

### 5.2 Lot 7B2 — resolver métier -> ROME

Contrat fonctionnel :

```text
FREE_TEXT_JOB_INPUT
-> NORMALIZE
-> ROME_REFERENTIAL_SEARCH
-> MATCHING_APPELLATIONS
-> GROUP_BY_ROME
-> USER_DISAMBIGUATION
-> ONE_OR_MORE_ROME_CODES
-> STRUCTURED_QUERY
```

La recherche doit porter sur :

- libellés ROME ;
- appellations ;
- synonymes / alias autorisés et sourcés ;
- code ROME.

Normalisation minimale : casse, accents, tirets, apostrophes et variations textuelles raisonnables.

### 5.3 Lot 7B3 — autocomplete métier + sélection multiple

Comportement cible :

- pas de requête sur 0–2 caractères ;
- suggestions dynamiques à partir d’environ **3 caractères**, seuil à valider par test utilisateur ;
- debounce indicatif **250–350 ms**, à valider en implémentation ;
- résultats regroupés par code ROME ;
- affichage des appellations correspondantes sous chaque code ;
- sélection d’un ou plusieurs codes ROME ;
- aucune dépendance à un simple `LIKE '%texte%'` comme mécanisme métier principal.

Exemple :

```text
conseiller inse...

[ ] ROME X — Métier A
    - appellation 1
    - appellation 2

[ ] ROME Y — Métier B
    - appellation 3
```

L’utilisateur peut sélectionner plusieurs métiers/codes.

### 5.4 Lot 7B4 — qualification ROME des annonces

Pour chaque offre, distinguer :

```text
ROME_SOURCE
ROME_CANDIDATE
ROME_VALIDATED / QUALIFIED
```

Le code source ne doit jamais être écrasé.

Statuts de qualification à prévoir :

- `MATCH` ;
- `PARTIAL_MATCH` ;
- `MISMATCH` ;
- `AMBIGUOUS` ;
- `NO_SOURCE_ROME` ;
- `INSUFFICIENT_EVIDENCE`.

La qualification doit comparer le contenu réel de l’annonce au référentiel :

- intitulé ;
- description ;
- activités ;
- compétences ;
- contexte ;
- appellations ;
- autres champs utiles disponibles.

Elle doit produire une trace inspectable :

- code source ;
- un ou plusieurs codes candidats ;
- rang ;
- statut ;
- confiance ;
- éléments confirmants ;
- éléments contradictoires ;
- version du référentiel ;
- méthode/version d’analyse ;
- date d’analyse ;
- éventuelle validation humaine.

Une annonce hybride peut conserver plusieurs candidats. Ne pas forcer un code unique en cas d’ambiguïté réelle.

La qualification sémantique/LLM éventuelle ne doit jamais écrire un résultat opaque sans evidence/provenance.

---

## 6. Lot 7C — moteur de recherche Emploi structuré

Le moteur doit rechercher dans le corpus régional et combiner au minimum :

- métier via sélection ROME ;
- texte libre complémentaire ;
- région / département ;
- commune ;
- rayon ;
- type de contrat ;
- date de publication ;
- employeur ;
- temps de travail ;
- salaire lorsque disponible ;
- télétravail lorsque la donnée est disponible et suffisamment fiable ;
- statut de l’offre / fraîcheur.

La recherche métier doit pouvoir choisir la source de classification :

```text
ROME qualifié
ROME déclaré par la source
les deux
```

Le comportement par défaut sera décidé après audit et tests.

Un clic depuis une offre doit pouvoir préremplir une recherche sur le métier/ROME qualifié correspondant.

---

## 7. Lot 7D — recherches / veilles sauvegardées

Une recherche structurée doit pouvoir être sauvegardée comme veille.

```text
RECHERCHE MANUELLE
-> REQUETE INTERESSANTE
-> SAUVEGARDER COMME VEILLE
-> EXECUTION RECURRENTE CIBLEE
-> NOUVELLES CORRESPONDANCES UNIQUEMENT
```

Prévoir :

- nom ;
- critères structurés ;
- activation/désactivation ;
- fréquence ;
- dernière exécution ;
- détection des nouvelles offres ;
- gestion des doublons et réapparitions ;
- éventuelle notification séparée du feed global.

---

## 8. Lot 7E — suivi candidat

À concevoir après moteur et veilles sauvegardées :

- intéressante ;
- vue ;
- candidature prévue ;
- candidature envoyée ;
- relance ;
- entretien ;
- refus ;
- retenue ;
- notes / actions associées.

Le suivi candidat est distinct de la collecte et de la qualification métier.

---

# 9. GATE OBLIGATOIRE — RECHERCHE EXTERNE / REUTILISATION

## 9.1 Objectif

Avant toute implémentation significative à partir du Lot 6, effectuer une recherche ciblée afin de déterminer si des solutions existantes, standards, produits, projets GitHub ou pratiques éprouvées font déjà tout ou partie du travail envisagé, éventuellement mieux.

Le Lot 5C doit être inclus rétrospectivement dans l’audit, mais il ne doit pas être réécrit sans delta matériel démontré.

Question centrale :

```text
EXISTING_SOLUTION / PATTERN / STANDARD
+
MATERIAL_ADVANTAGE
+
COMPATIBILITY_WITH_VIGIE
-> REUSE / ADAPT / INSPIRE
```

et non :

```text
SOMETHING_SIMILAR_EXISTS
-> REWRITE_THE_PROJECT
```

## 9.2 Périmètre de recherche

Chercher notamment :

- moteurs de recherche d’emploi ;
- agrégateurs et job boards ;
- projets open source d’agrégation d’offres ;
- moteurs de recherche full-text / facettés adaptés aux offres ;
- modèles de données d’offres d’emploi ;
- déduplication inter-source ;
- pagination et synchronisation incrémentale ;
- gestion de fraîcheur / expiration / réapparition ;
- recherche géographique / rayon ;
- recherches sauvegardées / alertes ;
- UX d’autocomplete métier ;
- résolution intitulé métier -> taxonomie ;
- ROME et outils officiels associés ;
- ESCO / O*NET / autres taxonomies uniquement comme comparaison ou complément possible ;
- classification automatique d’annonces ;
- validation d’un code métier contre une description ;
- recherche sémantique / embeddings si réellement utile ;
- observabilité et fiabilité par domaine/thème ;
- architectures de veille multi-sources ;
- projets GitHub comparables.

## 9.3 Sources à privilégier

Ordre de preuve :

1. documentation officielle / standards / API ;
2. dépôts GitHub actifs et inspectables ;
3. produits reconnus avec comportement observable/documenté ;
4. retours techniques de qualité ;
5. contenus secondaires uniquement comme piste de découverte.

Ne pas confondre promesse marketing et capacité démontrée.

## 9.4 Critères d’évaluation

Pour chaque solution/pattern :

- fonctionnalité couverte ;
- maturité ;
- activité récente ;
- qualité technique observable ;
- licence ;
- maintenabilité ;
- coût ;
- dépendance fournisseur ;
- quotas/API ;
- conformité avec le contexte France / ROME ;
- confidentialité ;
- intégration Next.js / PostgreSQL / Neon / Vercel ;
- impact sur l’architecture existante ;
- valeur marginale réelle.

## 9.5 Classes de verdict

Chaque mécanisme étudié doit finir dans l’une de ces catégories :

```text
REUSE_DIRECTLY
ADAPT_EXISTING_COMPONENT
INSPIRE_PATTERN_ONLY
MERGE_INTO_EXISTING_CAPABILITY
NEW_CAPABILITY_JUSTIFIED
NO_USEFUL_DELTA
REJECT
```

## 9.6 Livrables de l’audit

Le rapport doit produire :

1. benchmark des solutions/sites/projets ;
2. matrice fonctionnalités x solutions ;
3. analyse spécifique France Travail / ROME ;
4. patterns réutilisables ;
5. composants ou bibliothèques candidats ;
6. risques licence / coût / verrouillage / quotas ;
7. deltas par rapport à l’architecture Vigie actuelle ;
8. conséquences sur les Lots 5C, 6, 7A, 7B, 7C, 7D, 7E ;
9. propositions de regroupement, suppression ou réordonnancement des lots ;
10. décision `IMPLEMENT_AS_PLANNED`, `ADAPT_BEFORE_IMPLEMENTATION`, `REUSE_COMPONENT`, `RESEARCH_MORE`, ou `NO_CHANGE` par lot.

## 9.7 Règle de gouvernance

Aucun lot post-5C ne doit être implémenté uniquement parce qu’il figure dans la roadmap.

Avant implémentation :

```text
ROADMAP_CANDIDATE
-> EXTERNAL_REUSE_AUDIT
-> ARCHITECTURE_DELTA
-> LOT_CONTRACT
-> IMPLEMENTATION
```

L’audit peut modifier la roadmap s’il apporte un delta démontré. Il ne doit pas rouvrir les décisions acquises sans preuve suffisante.
