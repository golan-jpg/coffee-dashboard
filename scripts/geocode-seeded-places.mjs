#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const SEEDED_FILE = join(projectRoot, 'src', 'data', 'seededPlaces.json');

const CITY_CENTERS = {
  'Tel Aviv': { lat: 32.0853, lon: 34.7818, country: 'ישראל' },
  Berlin: { lat: 52.52, lon: 13.405, country: 'Germany' },
  Paris: { lat: 48.8566, lon: 2.3522, country: 'France' },
  Amsterdam: { lat: 52.3676, lon: 4.9041, country: 'Netherlands' },
  Copenhagen: { lat: 55.6761, lon: 12.5683, country: 'Denmark' },
  Barcelona: { lat: 41.3874, lon: 2.1686, country: 'Spain' },
  Madrid: { lat: 40.4168, lon: -3.7038, country: 'Spain' },
  Lisbon: { lat: 38.7223, lon: -9.1393, country: 'Portugal' },
  Porto: { lat: 41.1579, lon: -8.6291, country: 'Portugal' },
  London: { lat: 51.5074, lon: -0.1278, country: 'United Kingdom' },
  Rome: { lat: 41.9028, lon: 12.4964, country: 'Italy' },
  Vienna: { lat: 48.2082, lon: 16.3738, country: 'Austria' },
  Prague: { lat: 50.0755, lon: 14.4378, country: 'Czechia' },
};

const USER_AGENT = 'coffee-dashboard-geocoder/1.0';
const ectCoordCache = new Map();
let sharedBrowser = null;

function parseArgs() {
  const cityArg = process.argv.find((arg) => arg.startsWith('--city='))?.split('=')[1] || null;
  const write = process.argv.includes('--write');
  const limitArg = Number(process.argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1]);
  const limit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : 3;

  return { cityArg, write, limit };
}

function loadSeeded() {
  if (!existsSync(SEEDED_FILE)) {
    throw new Error(`Missing file: ${SEEDED_FILE}`);
  }
  return JSON.parse(readFileSync(SEEDED_FILE, 'utf-8'));
}

function normalize(value) {
  return String(value || '').trim();
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hasCoords(place) {
  if (place?.lat === null || place?.lat === undefined || place?.lat === '') return false;
  if (place?.lon === null || place?.lon === undefined || place?.lon === '') return false;
  return Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lon));
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function normalizeForMatch(value) {
  return normalize(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeForMatch(value)
    .split(' ')
    .filter((token) => token.length > 1);
}

function tokenOverlapRatio(a, b) {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }

  return overlap / Math.max(1, Math.min(aTokens.size, bTokens.size));
}

function extractEctSlugAlias(place, cityName) {
  const notes = normalize(place?.notes || '');
  const match = notes.match(/https?:\/\/europeancoffeetrip\.com\/cafe\/([^/)\s]+)/i);
  if (!match) return null;

  const slug = match[1]
    .replace(new RegExp(`-${String(cityName || '').toLowerCase().replace(/\s+/g, '-')}$`), '')
    .replace(/-(berlin|paris|london|barcelona|amsterdam|copenhagen|tel-aviv|telaviv)$/i, '');

  return slug
    .split('-')
    .filter(Boolean)
    .join(' ')
    .trim();
}

function extractEctCafeUrl(place) {
  const notes = normalize(place?.notes || '');
  const match = notes.match(/https?:\/\/europeancoffeetrip\.com\/cafe\/[^)\s]+/i);
  return match ? match[0] : null;
}

function findGeoInObject(value) {
  if (!value || typeof value !== 'object') return null;

  if ('latitude' in value && 'longitude' in value) {
    const lat = toNum(value.latitude);
    const lon = toNum(value.longitude);
    if (lat !== null && lon !== null) return { lat, lon };
  }

  if ('lat' in value && 'lng' in value) {
    const lat = toNum(value.lat);
    const lon = toNum(value.lng);
    if (lat !== null && lon !== null) return { lat, lon };
  }

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findGeoInObject(item);
        if (found) return found;
      }
    } else if (child && typeof child === 'object') {
      const found = findGeoInObject(child);
      if (found) return found;
    }
  }

  return null;
}

function extractCoordsFromHtml(html) {
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let scriptMatch;
  while ((scriptMatch = scriptRegex.exec(html)) !== null) {
    const raw = scriptMatch[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const found = findGeoInObject(parsed);
      if (found) return found;
    } catch {
      // continue to next script tag
    }
  }

  const latMatch = html.match(/"latitude"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/i);
  const lonMatch = html.match(/"longitude"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/i);
  if (latMatch && lonMatch) {
    const lat = toNum(latMatch[1]);
    const lon = toNum(lonMatch[1]);
    if (lat !== null && lon !== null) return { lat, lon };
  }

  const mapboxMatch = html.match(/marker-cafe\.png\((-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\)\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),\d+/i);
  if (mapboxMatch) {
    const lon = toNum(mapboxMatch[1]);
    const lat = toNum(mapboxMatch[2]);
    if (lat !== null && lon !== null) return { lat, lon };
  }

  return null;
}

async function getSharedBrowser() {
  if (!sharedBrowser) {
    sharedBrowser = await chromium.launch({ headless: true });
  }
  return sharedBrowser;
}

async function fetchEctCoordinatesWithBrowser(cafeUrl) {
  try {
    const browser = await getSharedBrowser();
    const page = await browser.newPage({
      userAgent: USER_AGENT,
    });

    await page.goto(cafeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1200);
    const html = await page.content();
    await page.close();

    return extractCoordsFromHtml(html);
  } catch {
    return null;
  }
}

async function fetchEctCoordinates(cafeUrl) {
  if (!cafeUrl) return null;
  if (ectCoordCache.has(cafeUrl)) return ectCoordCache.get(cafeUrl);

  try {
    const res = await fetch(cafeUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
      },
    });

    if (res.ok) {
      const html = await res.text();
      const coords = extractCoordsFromHtml(html);
      if (coords) {
        ectCoordCache.set(cafeUrl, coords);
        return coords;
      }
    }
  } catch {
    // continue to browser fallback
  }

  const browserCoords = await fetchEctCoordinatesWithBrowser(cafeUrl);
  ectCoordCache.set(cafeUrl, browserCoords);
  return browserCoords;
}

function buildQueries(place, cityName, countryName) {
  const name = normalize(place?.name);
  const slugAlias = extractEctSlugAlias(place, cityName);
  const queryBase = [name, slugAlias].filter(Boolean);
  const queries = [];
  const countryPart = normalize(countryName);

  for (const base of queryBase) {
    if (countryPart) {
      queries.push(`${base}, ${cityName}, ${countryPart}`);
      queries.push(`${base} coffee, ${cityName}, ${countryPart}`);
      queries.push(`${base} cafe, ${cityName}, ${countryPart}`);
    }
    queries.push(`${base}, ${cityName}`);
  }

  return Array.from(new Set(queries));
}

function scoreCandidate(result, placeName, cityCenter) {
  const lat = toNum(result.lat);
  const lon = toNum(result.lon);
  if (lat === null || lon === null) return -Infinity;

  let score = 0;

  const display = normalize(result.display_name);
  const queryName = normalize(placeName);
  const type = normalize(result.type).toLowerCase();
  const category = normalize(result.category).toLowerCase();

  const displayNorm = normalizeForMatch(display);
  const queryNorm = normalizeForMatch(queryName);
  const overlap = tokenOverlapRatio(displayNorm, queryNorm);

  if (displayNorm.includes(queryNorm) && queryNorm.length > 2) score += 38;
  else if (overlap >= 0.6) score += 28;
  else if (overlap >= 0.35) score += 16;

  if (category === 'amenity') score += 14;
  if (['cafe', 'coffee_shop', 'restaurant', 'coffee'].includes(type)) score += 12;

  const distance = haversineKm(cityCenter.lat, cityCenter.lon, lat, lon);
  score += Math.max(0, 32 - distance * 2.5);

  if (distance > 25) score -= 35;

  return score;
}

async function nominatimSearch(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Nominatim HTTP ${res.status}`);
  }

  return await res.json();
}

function extractCountryFromDisplayName(displayName) {
  const parts = normalize(displayName)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts[parts.length - 1] : '';
}

function deriveCenterFromSeededList(list) {
  const points = (Array.isArray(list) ? list : [])
    .map((place) => ({ lat: toNum(place?.lat), lon: toNum(place?.lon) }))
    .filter((point) => point.lat !== null && point.lon !== null);

  if (points.length === 0) return null;

  const sum = points.reduce((acc, point) => {
    acc.lat += point.lat;
    acc.lon += point.lon;
    return acc;
  }, { lat: 0, lon: 0 });

  return {
    lat: sum.lat / points.length,
    lon: sum.lon / points.length,
    country: '',
  };
}

async function resolveCityCenter(cityName, seededList) {
  if (CITY_CENTERS[cityName]) return CITY_CENTERS[cityName];

  const seededCenter = deriveCenterFromSeededList(seededList);
  if (seededCenter) return seededCenter;

  const queries = [`${cityName} city center`, cityName];
  for (const query of queries) {
    try {
      const results = await nominatimSearch(query);
      if (!Array.isArray(results) || results.length === 0) continue;

      const first = results[0];
      const lat = toNum(first.lat);
      const lon = toNum(first.lon);
      if (lat === null || lon === null) continue;

      return {
        lat,
        lon,
        country: extractCountryFromDisplayName(first.display_name),
      };
    } catch {
      // continue to next query
    }
  }

  return null;
}

async function geocodePlace(place, cityName, cityCenter) {
  if (!cityCenter) return { matched: false, reason: 'No city center configured' };

  const name = normalize(place.name);
  if (!name) return { matched: false, reason: 'Missing name' };

  const ectUrl = extractEctCafeUrl(place);
  if (ectUrl) {
    const ectCoords = await fetchEctCoordinates(ectUrl);
    if (ectCoords) {
      return {
        matched: true,
        query: `ECT ${ectUrl}`,
        score: 100,
        lat: ectCoords.lat,
        lon: ectCoords.lon,
        address: normalize(place.address || ''),
        osmType: 'cafe',
        osmCategory: 'amenity',
      };
    }
  }

  const queries = buildQueries(place, cityName, cityCenter.country);
  const slugAlias = extractEctSlugAlias(place, cityName);

  let best = null;
  for (const query of queries) {
    let results = [];
    try {
      results = await nominatimSearch(query);
    } catch {
      continue;
    }

    for (const result of results) {
      const score = scoreCandidate(result, name, cityCenter);
      if (!best || score > best.score) {
        best = { score, query, result };
      }
    }
  }

  if ((!best || best.score < 32) && slugAlias) {
    try {
      const slugResults = await nominatimSearch(`${slugAlias}, ${cityName}`);
      for (const result of slugResults) {
        const score = scoreCandidate(result, slugAlias, cityCenter) + 6;
        if (!best || score > best.score) {
          best = { score, query: `${slugAlias}, ${cityName}`, result };
        }
      }
    } catch {
      // ignore and continue to final decision
    }
  }

  const bestDistance = best
    ? haversineKm(cityCenter.lat, cityCenter.lon, toNum(best.result.lat) ?? cityCenter.lat, toNum(best.result.lon) ?? cityCenter.lon)
    : null;

  const acceptedByScore = best && best.score >= 32;
  const acceptedByDistance = best && best.score >= 24 && bestDistance !== null && bestDistance <= 12;

  if (!best || (!acceptedByScore && !acceptedByDistance)) {
    return { matched: false, reason: 'No confident match', bestScore: best?.score ?? null };
  }

  return {
    matched: true,
    query: best.query,
    score: best.score,
    lat: toNum(best.result.lat),
    lon: toNum(best.result.lon),
    address: normalize(best.result.display_name),
    osmType: best.result.type,
    osmCategory: best.result.category,
  };
}

async function main() {
  const { cityArg, write, limit } = parseArgs();
  const seeded = loadSeeded();

  const cityNames = cityArg
    ? Object.keys(seeded).filter((name) => name.toLowerCase() === cityArg.toLowerCase())
    : Object.keys(seeded);

  if (cityArg && cityNames.length === 0) {
    console.error(`Unknown city in seededPlaces: ${cityArg}`);
    process.exit(1);
  }

  const updates = [];

  for (const cityName of cityNames) {
    const list = Array.isArray(seeded[cityName]) ? seeded[cityName] : [];
    const cityCenter = await resolveCityCenter(cityName, list);
    let processed = 0;

    for (const place of list) {
      if (processed >= limit) break;

      if (hasCoords(place) && place.needsCoords !== true) continue;

      processed += 1;
      const result = await geocodePlace(place, cityName, cityCenter);

      if (result.matched) {
        const existingNotes = normalize(place.notes);
        place.lat = result.lat;
        place.lon = result.lon;
        place.address = place.address || result.address;
        place.needsCoords = false;
        if (existingNotes && existingNotes.includes('europeancoffeetrip.com')) {
          place.notes = `${existingNotes} | geocoded (${result.query})`;
        } else {
          place.notes = `geocoded (${result.query})`;
        }
        updates.push({ cityName, name: place.name, status: 'matched', score: result.score });
      } else {
        updates.push({ cityName, name: place.name, status: 'unmatched', reason: result.reason, score: result.bestScore ?? null });
      }
    }
  }

  if (write) {
    writeFileSync(SEEDED_FILE, JSON.stringify(seeded, null, 2) + '\n', 'utf-8');
  }

  console.log(`Mode: ${write ? 'WRITE' : 'DRY-RUN'}`);
  if (updates.length === 0) {
    console.log('No seeded places required geocoding.');
  } else {
    for (const item of updates) {
      if (item.status === 'matched') {
        console.log(`✓ ${item.cityName} :: ${item.name} (score=${Math.round(item.score)})`);
      } else {
        console.log(`- ${item.cityName} :: ${item.name} (no match, score=${item.score ?? 'n/a'}, reason=${item.reason})`);
      }
    }
  }

  if (!write) {
    console.log('Use --write to persist changes.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(async () => {
  if (sharedBrowser) {
    await sharedBrowser.close();
  }
});
