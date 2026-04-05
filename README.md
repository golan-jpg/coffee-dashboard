# Coffee Dashboard

Coffee Dashboard is a React + Leaflet app for discovering and ranking coffee places by city.

It combines multiple sources (Google lists, OSM, seeded curated places), calculates a specialty score, and lets you pin/rate/filter places on a map + sidebar workflow.

## Tech Stack

- React 19 + Vite 7
- Leaflet + React-Leaflet 5
- Recharts (analytics/visualization components)
- ESLint 9

## Quick Start

Requirements:

- Node.js 18+
- npm

Install and run:

```bash
npm install
npm run dev
```

Build and preview:

```bash
npm run build
npm run preview
```

LAN mode:

```bash
npm run dev:lan
npm run preview:lan
```

## Project Structure

- src/App.jsx: main app logic (data pipeline, filtering, scoring integration, map/list UX)
- src/constants/map.js: map and city-radius tuning constants
- src/utils/calculateSpecialtyScore.js: specialty scoring logic and presets
- src/data/googleLists.json: imported Google list places
- src/data/seededPlaces.json: curated/seeded places per city
- src/data/placeOverrides.json: allow/exclude overrides per city
- scripts/: import/audit/geocode/curation utilities

## Data Flows

- Google Lists data is loaded from src/data/googleLists.json.
- OSM data is fetched via Overpass endpoints at runtime.
- Seeded places are loaded from src/data/seededPlaces.json.
- City-level quality overrides are applied from src/data/placeOverrides.json.

## Useful npm Scripts

Daily workflow:

- npm run dev — start local dev server
- npm run build — create production build
- npm run lint — run ESLint checks
- npm run preview — preview built app locally

Data import / curation (as needed):

- npm run import:lists — ⚠ modifies data files (imports Google list data into project JSON)
- npm run import:ect — dry-run import for European Coffee Trip data
- npm run import:ect:write — ⚠ modifies data files (writes imported European Coffee Trip data)

Maintenance / one-off jobs:

- npm run import:ect:all — ⚠ modifies data files (imports all configured ECT cities)
- npm run discover:specialty — dry-run specialty place discovery
- npm run discover:specialty:write — ⚠ modifies data files (writes discovered specialty places)
- npm run geocode:seeded — dry-run geocoding for seeded places
- npm run geocode:seeded:write — ⚠ modifies data files (writes geocoding results for seeded places)

LAN variants:

- npm run dev:lan — expose dev server on local network
- npm run preview:lan — expose preview server on local network

## Deploy to Cloudflare Pages (cuproam.com)

This project can run on Cloudflare Pages with Pages Functions for `/api/*` endpoints.

### 1) Create Pages project

- Cloudflare Dashboard → Workers & Pages → Create application → Pages → Connect to Git.
- Build command: `npm run build`
- Build output directory: `dist`

### 2) Create and bind KV namespace

Pages Functions in this repo use one KV binding named `CUPROAM_STATE`.

- Cloudflare Dashboard → Workers & Pages → KV → Create namespace (for example: `cuproam-state-prod`).
- In your Pages project → Settings → Bindings → Add binding:
	- Type: KV Namespace
	- Variable name: `CUPROAM_STATE`
	- Namespace: `cuproam-state-prod`

### 3) Add custom domains

- In Pages project → Custom domains:
	- Add `cuproam.com`
	- Add `www.cuproam.com`

Cloudflare will create DNS records automatically for a domain managed in the same Cloudflare account.

### 4) SSL and redirects

- SSL/TLS mode: `Full (strict)`
- Enable `Always Use HTTPS`
- Choose one canonical host (`cuproam.com` or `www.cuproam.com`) and configure redirect in Pages settings.

### 5) API routes provided by Pages Functions

These routes are available in production under the same domain:

- `GET/POST /api/backup-user-ratings`
- `GET/POST /api/backup-hidden-place-ids`
- `POST /api/report-error`
- `GET /api/reverse-geocode`

### 6) Local development note

Local development can keep using the Node server:

- `npm run dev:api`
- `npm run dev` (or `npm run dev:full`)

## Map Tuning (Zoom + Radius)

Map behavior is configured in src/constants/map.js.

- DEFAULT_CITY_ZOOM: default zoom when recentering to a city
- PIN_FLY_TO_MIN_ZOOM: minimum zoom when flying to a pinned place
- FIT_BOUNDS_PADDING: padding used by Fit action
- CITY_FILTER_RADIUS_KM: city-radius filter for Google places
- LAST_RESORT_RADIUS_MULTIPLIER: fallback radius multiplier when no results survive
- CITY_OVERPASS_RADIUS_METERS: per-city OSM fetch radius map
- getCityOverpassRadiusMeters(cityName): helper used by Overpass query builder

Main usage points are in src/App.jsx (MapController, Fit button, Google city filtering, and Overpass query construction).
