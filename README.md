# Vigie Centrale

Agrégateur personnel de veille thématique pour Diablo IV, Hearthstone et Battlegrounds, les offres d'emploi locales, le métier de conseiller en insertion professionnelle et les nouveautés technologiques.

## Données

L'interface distingue strictement les données en direct, les connecteurs nécessitant une API et les données de démonstration.

Sources publiques connectées : Blizzard, chaînes YouTube sélectionnées, ministère du Travail, UNML, Google et Microsoft.

## Développement

```bash
npm install
npm run dev
```

## Variables d'environnement

Copier `.env.example` vers `.env.local` pour le développement. Ne jamais enregistrer les vraies valeurs dans Git.

Sur Vercel, créer les variables suivantes dans les paramètres du projet :

- `FRANCE_TRAVAIL_CLIENT_ID`
- `FRANCE_TRAVAIL_CLIENT_SECRET`
- `DATABASE_URL`
- `CRON_SECRET`

## Collecte et lecture

L’interface et `GET /api/veille` lisent uniquement les dernières données disponibles dans PostgreSQL. Elles ne contactent aucune source externe.

La collecte est déclenchée séparément par Vercel Cron sur `GET /api/cron/archive`, protégée par `CRON_SECRET`. Chaque exécution et chaque source sont journalisées dans `collection_runs` et `source_runs`.

Avant le premier déploiement du Lot 1, exécuter la migration additive :

```text
migrations/001_lot1_collection_runs.sql
```

## Déploiement

Le projet est conçu pour être importé directement dans Vercel comme application Next.js.
