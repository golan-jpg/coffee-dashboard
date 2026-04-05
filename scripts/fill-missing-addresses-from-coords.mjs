#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');
const projectRoot = join(__dirname, '..');
const seededCitiesDir = join(projectRoot, 'src', 'data', 'seeded-cities');
const seededMetaPath = join(projectRoot, 'src', 'data', 'seededCitiesMeta.json');

const USER_AGENT = 'coffee-dashboard-address-filler/1.0';

function getArg(flag, fallback = '') {
  const arg = process.argv.find((item) => item.startsWith(`${flag}=`));
  if (!arg) return fallback;
  return arg.slice(flag.length + 1);
}

function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeAddress(value) {
  return String(value || '')
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .trim();
}

function hasAddress(place) {
  return normalizeAddress(place?.address).length > 0;
}

function formatPhotonAddress(properties = {}) {
  const streetPart = [properties.street, properties.housenumber].filter(Boolean).join(' ').trim();
  const cityPart = properties.city || properties.district || properties.locality || '';
  const postcode = properties.postcode || '';

  const line2 = [postcode, cityPart].filter(Boolean).join(' ').trim();
  const countryCode = String(properties.countrycode || '').toUpperCase();
  const country = countryCode === 'CZ' ? 'Czech Republic' : (properties.country || '');

  return [streetPart, line2, country].filter(Boolean).join(', ').trim();
}

async function reverseWithPhoton(lat, lon) {
  const url = `https://photon.komoot.io/reverse?lon=${encodeURIComponent(lon)}&lat=${encodeURIComponent(lat)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  });

  if (!response.ok) return '';
  const data = await response.json();
  const first = Array.isArray(data?.features) ? data.features[0] : null;
  const props = first?.properties || {};

  const formatted = formatPhotonAddress(props);
  if (formatted) return formatted;

  return normalizeAddress(props.name || '');
}

function cityNameToSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function loadMeta() {
  if (!existsSync(seededMetaPath)) return [];
  try {
    const raw = JSON.parse(readFileSync(seededMetaPath, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function resolveTargetFiles(cityFilter) {
  const files = readdirSync(seededCitiesDir).filter((name) => name.endsWith('.json'));
  if (!cityFilter) return files;

  const normalizedFilter = cityFilter.trim().toLowerCase();
  const meta = loadMeta();
  const matchedMeta = meta.find((item) => String(item?.name || '').trim().toLowerCase() === normalizedFilter);
  if (matchedMeta?.file) return [matchedMeta.file].filter((f) => files.includes(f));

  const slug = cityNameToSlug(cityFilter);
  return files.filter((name) => name.replace(/\.json$/i, '').toLowerCase() === slug);
}

async function main() {
  const city = getArg('--city', '');
  const limitRaw = Number(getArg('--limit', '40'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 40;
  const write = process.argv.includes('--write');

  if (!existsSync(seededCitiesDir)) {
    throw new Error(`Missing dir: ${seededCitiesDir}`);
  }

  const files = resolveTargetFiles(city);
  if (files.length === 0) {
    console.log('No city files matched the filter.');
    return;
  }

  const report = [];
  let updatedCount = 0;
  let processed = 0;

  for (const file of files) {
    const path = join(seededCitiesDir, file);
    let list = [];

    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      list = Array.isArray(parsed) ? parsed : [];
    } catch {
      continue;
    }

    for (let i = 0; i < list.length; i += 1) {
      if (processed >= limit) break;

      const place = list[i];
      if (!place || hasAddress(place)) continue;

      const lat = toNum(place.lat);
      const lon = toNum(place.lon);
      if (lat === null || lon === null) continue;

      processed += 1;
      const resolved = await reverseWithPhoton(lat, lon);

      if (!resolved) {
        report.push({ file, name: place.name || '(unnamed)', status: 'no-match' });
        continue;
      }

      if (write) {
        place.address = resolved;
      }

      updatedCount += 1;
      report.push({ file, name: place.name || '(unnamed)', status: 'updated', address: resolved });
      await new Promise((resolve) => setTimeout(resolve, 140));
    }

    if (write) {
      writeFileSync(path, JSON.stringify(list), 'utf8');
    }
  }

  console.log(`Mode: ${write ? 'WRITE' : 'DRY-RUN'}`);
  console.log(`Processed: ${processed}`);
  console.log(`Resolved: ${updatedCount}`);

  report.slice(0, 120).forEach((item) => {
    if (item.status === 'updated') {
      console.log(`✓ ${item.file} :: ${item.name} -> ${item.address}`);
    } else {
      console.log(`- ${item.file} :: ${item.name} (no address found)`);
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
