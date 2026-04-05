#!/usr/bin/env node

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');
const projectRoot = join(__dirname, '..');

const seededDir = join(projectRoot, 'src', 'data', 'seeded-cities');
const googleListsPath = join(projectRoot, 'src', 'data', 'googleLists.json');
const seededMetaPath = join(projectRoot, 'src', 'data', 'seededCitiesMeta.json');

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function hasAddress(place) {
  return String(place?.address || '').trim().length > 0;
}

function slugToCityName(slug) {
  return slug
    .replace(/\.json$/i, '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getArgValue(flag, fallback = '') {
  const idx = process.argv.findIndex((item) => item === flag);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] || fallback;
}

const cityFilter = String(getArgValue('--city', '')).trim().toLowerCase();
const sourceFilter = String(getArgValue('--source', 'all')).trim().toLowerCase();
const limitRaw = Number(getArgValue('--limit', '120'));
const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 120;

const metaCities = existsSync(seededMetaPath)
  ? JSON.parse(readFileSync(seededMetaPath, 'utf8'))
  : [];

const metaByFile = new Map(
  (Array.isArray(metaCities) ? metaCities : [])
    .filter((item) => item?.file && item?.name)
    .map((item) => [String(item.file), String(item.name)])
);

const referenceCities = (Array.isArray(metaCities) ? metaCities : [])
  .filter((city) => Number.isFinite(Number(city?.lat)) && Number.isFinite(Number(city?.lon)))
  .map((city) => ({
    name: String(city.name),
    lat: Number(city.lat),
    lon: Number(city.lon),
  }));

function inferNearestCityName(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || referenceCities.length === 0) return 'Unknown';

  let nearest = null;
  for (const city of referenceCities) {
    const dist = haversineKm(lat, lon, city.lat, city.lon);
    if (!Number.isFinite(dist)) continue;
    if (!nearest || dist < nearest.dist) {
      nearest = { name: city.name, dist };
    }
  }

  if (!nearest) return 'Unknown';
  if (nearest.dist > 80) return `Unknown (~${nearest.dist.toFixed(1)}km from ${nearest.name})`;
  return nearest.name;
}

const rows = [];

if (existsSync(seededDir)) {
  const files = readdirSync(seededDir).filter((name) => name.endsWith('.json'));

  for (const file of files) {
    const filePath = join(seededDir, file);
    let places = [];

    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
      places = Array.isArray(parsed) ? parsed : [];
    } catch {
      continue;
    }

    const cityName = metaByFile.get(file) || slugToCityName(file);

    places.forEach((place, idx) => {
      if (hasAddress(place)) return;

      rows.push({
        source: 'seeded',
        city: cityName,
        name: String(place?.name || '').trim() || '(unnamed)',
        lat: toNum(place?.lat),
        lon: toNum(place?.lon),
        pointer: `src/data/seeded-cities/${file}#${idx}`,
      });
    });
  }
}

if (sourceFilter === 'all' || sourceFilter === 'google') {
  if (existsSync(googleListsPath)) {
    try {
      const googleData = JSON.parse(readFileSync(googleListsPath, 'utf8'));
      const lists = Array.isArray(googleData?.lists) ? googleData.lists : [];

      lists.forEach((list, listIdx) => {
        const places = Array.isArray(list?.places) ? list.places : [];
        places.forEach((place, placeIdx) => {
          if (hasAddress(place)) return;

          const lat = toNum(place?.latitude ?? place?.lat);
          const lon = toNum(place?.longitude ?? place?.lon);

          rows.push({
            source: 'google',
            city: inferNearestCityName(lat, lon),
            name: String(place?.name || '').trim() || '(unnamed)',
            lat,
            lon,
            pointer: `src/data/googleLists.json#list:${listIdx}/place:${placeIdx}`,
          });
        });
      });
    } catch {
      // ignore malformed file
    }
  }
}

let filtered = rows;

if (sourceFilter === 'seeded' || sourceFilter === 'google') {
  filtered = filtered.filter((row) => row.source === sourceFilter);
}

if (cityFilter) {
  filtered = filtered.filter((row) => row.city.toLowerCase().includes(cityFilter));
}

filtered.sort((a, b) => {
  const cityCmp = a.city.localeCompare(b.city);
  if (cityCmp !== 0) return cityCmp;
  return a.name.localeCompare(b.name);
});

const countsByCity = new Map();
for (const row of filtered) {
  countsByCity.set(row.city, (countsByCity.get(row.city) || 0) + 1);
}

console.log(`Missing addresses: ${filtered.length}`);
console.log(`Source filter: ${sourceFilter}`);
if (cityFilter) console.log(`City filter: ${cityFilter}`);
console.log('');

const topCities = [...countsByCity.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15);

if (topCities.length > 0) {
  console.log('Top cities with missing addresses:');
  topCities.forEach(([city, count]) => {
    console.log(`- ${city}: ${count}`);
  });
  console.log('');
}

console.log(`Showing first ${Math.min(limit, filtered.length)} rows:`);
for (const row of filtered.slice(0, limit)) {
  const lat = Number.isFinite(row.lat) ? row.lat : 'NA';
  const lon = Number.isFinite(row.lon) ? row.lon : 'NA';
  console.log(`${row.source}\t${row.city}\t${row.name}\t${lat}\t${lon}\t${row.pointer}`);
}
