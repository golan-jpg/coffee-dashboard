#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const SEEDED_FILE = join(projectRoot, 'src', 'data', 'seededPlaces.json');

const CITIES = [
  { name: 'Berlin', lat: 52.52, lon: 13.405, radius: 2600 },
  { name: 'Tel Aviv', lat: 32.0853, lon: 34.7818, radius: 2600 },
  { name: 'Paris', lat: 48.8566, lon: 2.3522, radius: 2600 },
  { name: 'Amsterdam', lat: 52.3676, lon: 4.9041, radius: 2600 },
  { name: 'Copenhagen', lat: 55.6761, lon: 12.5683, radius: 2600 },
  { name: 'Barcelona', lat: 41.3874, lon: 2.1686, radius: 2600 },
  { name: 'London', lat: 51.5074, lon: -0.1278, radius: 2600 },
];

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
];

const TAG_GROUPS = {
  core: [
    'specialty_coffee',
    'third_wave',
    'single_origin',
    'filter_coffee',
    'espresso_bar',
    'manual_brew',
  ],
  roasting: [
    'roastery',
    'in_house_roasting',
    'micro_roaster',
    'guest_roasters',
    'direct_trade',
    'traceability',
  ],
  brewing: [
    'v60',
    'chemex',
    'aeropress',
    'kalita',
    'batch_brew',
    'cold_brew',
    'espresso_tonics',
  ],
  quality: [
    'quality_grinder',
    'espresso_machine_pro',
    'precision_brewing',
    'weighing_scale',
  ],
  experience: [
    'latte_art',
    'barista_focus',
    'tasting_notes',
    'cupping',
    'coffee_workshop',
  ],
};

const TEXT_HINTS = [
  'specialty', 'speciality', 'third wave', 'single origin', 'filter coffee',
  'manual brew', 'pour over', 'v60', 'chemex', 'aeropress', 'kalita',
  'batch brew', 'cold brew', 'roastery', 'roaster', 'coffee lab',
  'direct trade', 'traceability', 'tasting notes', 'cupping',
  'espresso bar',
  'ספיישלטי', 'מקור יחיד', 'פילטר', 'קלייה', 'רוסטר', 'קאפינג',
];

const POSITIVE_NAME_HINTS = [
  'coffee', 'cafe', 'café', 'espresso', 'roaster', 'roastery',
  'קפה', 'אספרסו', 'קלייה',
];

const NEGATIVE_HINTS = [
  'cocktail', 'wine bar', 'pub', 'nightclub', 'restaurant', 'bistro',
  'burger', 'pizza', 'grill', 'sushi',
  'בר קוקטיילים', 'בר יין', 'פאב', 'מסעדה', 'ביסטרו',
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function hasTruthyTag(tags, key) {
  const value = normalizeText(tags?.[key]);
  return Boolean(value && value !== 'no' && value !== 'false' && value !== '0');
}

function buildAddress(tags = {}) {
  const street = tags['addr:street'];
  const houseNumber = tags['addr:housenumber'];
  const postcode = tags['addr:postcode'];
  const city = tags['addr:city'];

  const line1 = [street, houseNumber].filter(Boolean).join(' ').trim();
  const line2 = [postcode, city].filter(Boolean).join(' ').trim();
  return [line1, line2].filter(Boolean).join(', ');
}

function buildOverpassQuery(city) {
  const { lat, lon, radius } = city;
  return `
[out:json][timeout:40];
(
  node["amenity"="cafe"](around:${radius},${lat},${lon});
  way["amenity"="cafe"](around:${radius},${lat},${lon});
  relation["amenity"="cafe"](around:${radius},${lat},${lon});

  node["shop"="coffee"](around:${radius},${lat},${lon});
  way["shop"="coffee"](around:${radius},${lat},${lon});
  relation["shop"="coffee"](around:${radius},${lat},${lon});

  node["cuisine"~"coffee_shop|specialty_coffee",i](around:${radius},${lat},${lon});
  way["cuisine"~"coffee_shop|specialty_coffee",i](around:${radius},${lat},${lon});
  relation["cuisine"~"coffee_shop|specialty_coffee",i](around:${radius},${lat},${lon});

  node["roasting"="yes"](around:${radius},${lat},${lon});
  way["roasting"="yes"](around:${radius},${lat},${lon});
  relation["roasting"="yes"](around:${radius},${lat},${lon});
);
out center tags;
`;
}

async function fetchOverpass(query) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: new URLSearchParams({ data: query }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (error) {
        lastError = error;
      }
    }
    await delay(500 * (attempt + 1));
  }
  throw lastError || new Error('Overpass failed');
}

function scoreCandidate(tags = {}) {
  let score = 0;
  const reasons = [];

  const text = normalizeText([
    tags.name,
    tags.brand,
    tags.operator,
    tags.description,
    tags.cuisine,
  ].filter(Boolean).join(' '));

  const matchedCore = TAG_GROUPS.core.filter((key) => hasTruthyTag(tags, key));
  if (matchedCore.length) {
    score += 25;
    reasons.push(`core:${matchedCore.join(',')}`);
  }

  const matchedRoasting = TAG_GROUPS.roasting.filter((key) => hasTruthyTag(tags, key));
  if (matchedRoasting.length) {
    score += 15;
    reasons.push(`roasting:${matchedRoasting.join(',')}`);
  }

  const matchedBrewing = TAG_GROUPS.brewing.filter((key) => hasTruthyTag(tags, key));
  if (matchedBrewing.length) {
    score += Math.min(12, matchedBrewing.length * 3);
    reasons.push(`brewing:${matchedBrewing.join(',')}`);
  }

  const matchedQuality = TAG_GROUPS.quality.filter((key) => hasTruthyTag(tags, key));
  if (matchedQuality.length) {
    score += Math.min(8, matchedQuality.length * 2);
    reasons.push(`quality:${matchedQuality.join(',')}`);
  }

  const matchedExperience = TAG_GROUPS.experience.filter((key) => hasTruthyTag(tags, key));
  if (matchedExperience.length) {
    score += Math.min(8, matchedExperience.length * 2);
    reasons.push(`experience:${matchedExperience.join(',')}`);
  }

  const textHits = TEXT_HINTS.filter((hint) => text.includes(hint));
  if (textHits.length) {
    score += Math.min(20, textHits.length * 4);
    reasons.push(`text:${textHits.slice(0, 5).join(',')}`);
  }

  const nameHits = POSITIVE_NAME_HINTS.filter((hint) => text.includes(hint));
  if (nameHits.length) {
    score += Math.min(12, nameHits.length * 3);
    reasons.push(`name:${nameHits.slice(0, 4).join(',')}`);
  }

  if (tags.cuisine && /coffee_shop|specialty_coffee/i.test(tags.cuisine)) {
    score += 8;
    reasons.push('cuisine:coffee');
  }

  if (normalizeText(tags.roasting) === 'yes') {
    score += 8;
    reasons.push('roasting:yes');
  }

  const hasNegative = NEGATIVE_HINTS.some((hint) => text.includes(hint));
  if (hasNegative) {
    score -= 25;
    reasons.push('negative:food_or_bar');
  }

  return { score: Math.max(0, score), reasons };
}

function loadSeededPlaces() {
  if (!existsSync(SEEDED_FILE)) {
    return CITIES.reduce((acc, city) => {
      acc[city.name] = [];
      return acc;
    }, {});
  }

  try {
    return JSON.parse(readFileSync(SEEDED_FILE, 'utf-8'));
  } catch {
    return CITIES.reduce((acc, city) => {
      acc[city.name] = [];
      return acc;
    }, {});
  }
}

function cityNameFromArgs() {
  const arg = process.argv.find((item) => item.startsWith('--city='));
  if (!arg) return null;
  return arg.split('=')[1] || null;
}

function shouldWrite() {
  return process.argv.includes('--write');
}

function minScore() {
  const arg = process.argv.find((item) => item.startsWith('--min-score='));
  const parsed = Number(arg?.split('=')[1]);
  return Number.isFinite(parsed) ? parsed : 18;
}

async function discoverForCity(city, threshold) {
  const query = buildOverpassQuery(city);
  const data = await fetchOverpass(query);

  const byName = new Map();

  for (const el of data.elements || []) {
    const tags = el.tags || {};
    const name = String(tags.name || '').trim();
    if (!name) continue;

    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const { score, reasons } = scoreCandidate(tags);
    if (score < threshold) continue;

    const key = name.toLowerCase();
    const candidate = {
      id: `osm:${el.type}-${el.id}`,
      name,
      lat,
      lon,
      address: buildAddress(tags),
      source: 'seeded',
      isSpecialty: true,
      specialtyScore: Math.min(100, 60 + score),
      notes: `auto-discovered (${reasons.join(' | ')})`,
    };

    const existing = byName.get(key);
    if (!existing || (candidate.specialtyScore || 0) > (existing.specialtyScore || 0)) {
      byName.set(key, candidate);
    }
  }

  return Array.from(byName.values()).sort((a, b) => (b.specialtyScore || 0) - (a.specialtyScore || 0));
}

async function main() {
  const cityArg = cityNameFromArgs();
  const write = shouldWrite();
  const threshold = minScore();

  const targetCities = cityArg
    ? CITIES.filter((city) => city.name.toLowerCase() === cityArg.toLowerCase())
    : CITIES;

  if (targetCities.length === 0) {
    console.error(`Unknown city: ${cityArg}`);
    process.exit(1);
  }

  const seeded = loadSeededPlaces();
  const summary = [];

  for (const city of targetCities) {
    const discovered = await discoverForCity(city, threshold);

    const existingManualPinned = (seeded[city.name] || []).filter((place) => place.needsCoords === true);
    const existingNames = new Set(existingManualPinned.map((place) => String(place.name || '').toLowerCase()));
    const merged = [
      ...existingManualPinned,
      ...discovered.filter((place) => !existingNames.has(String(place.name || '').toLowerCase())),
    ];

    if (write) {
      seeded[city.name] = merged;
    }

    summary.push({ city: city.name, discovered: discovered.length, kept: merged.length });

    console.log(`\n${city.name}: discovered ${discovered.length}`);
    for (const place of discovered.slice(0, 12)) {
      console.log(`- ${place.name} (${place.specialtyScore})`);
    }
  }

  if (write) {
    writeFileSync(SEEDED_FILE, JSON.stringify(seeded, null, 2) + '\n', 'utf-8');
    console.log(`\nUpdated ${SEEDED_FILE}`);
  } else {
    console.log('\nDry run only. Use --write to persist results.');
  }

  console.log('\nSummary:');
  for (const item of summary) {
    console.log(`- ${item.city}: ${item.discovered} discovered`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
