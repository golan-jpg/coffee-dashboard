/**
 * fetch-place-photos.mjs
 * Fetches real Google Places photos for seeded city JSON files and writes
 * the final CDN URL (no API key needed at runtime) back into the JSON.
 *
 * Usage:
 *   node scripts/fetch-place-photos.mjs tel-aviv
 *   node scripts/fetch-place-photos.mjs prague
 *   node scripts/fetch-place-photos.mjs --all
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Load .env.local
const envPath = path.join(ROOT, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) {
  console.error('ERROR: GOOGLE_PLACES_API_KEY not set in .env.local');
  process.exit(1);
}

const SEEDED_DIR = path.join(ROOT, 'src/data/seeded-cities');
const DELAY_MS = 300; // be polite to the API

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Text-search for a cafe by name + city, returns the first Place result or null.
 */
async function searchPlace(name, cityName) {
  const query = `${name} coffee ${cityName}`;
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.photos',
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1, languageCode: 'en' }),
  });
  if (!res.ok) {
    console.warn(`  searchText HTTP ${res.status} for "${name}"`);
    return null;
  }
  const data = await res.json();
  return data.places?.[0] ?? null;
}

/**
 * Given a photo resource name like "places/ChIJ.../photos/AXCi...",
 * follow the redirect and return the final public CDN URL.
 */
async function resolvePhotoUrl(photoName) {
  const apiUrl = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=800&key=${API_KEY}`;
  const res = await fetch(apiUrl, { redirect: 'follow' });
  if (!res.ok) return null;
  // After redirect, the response URL is the public CDN URL (no key needed)
  return res.url && !res.url.includes('googleapis.com/v1/') ? res.url : apiUrl;
}

async function processCity(cityFile) {
  const filePath = path.join(SEEDED_DIR, cityFile);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return;
  }

  const places = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const cityName = cityFile.replace('.json', '').replace(/-/g, ' ');

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < places.length; i++) {
    const place = places[i];
    if (place.photoUrl) {
      // Already has a photo — skip
      skipped++;
      continue;
    }
    if (!place.name) continue;

    process.stdout.write(`[${i + 1}/${places.length}] ${place.name} ... `);

    try {
      const result = await searchPlace(place.name, cityName);
      if (!result || !result.photos?.length) {
        console.log('no photo found');
        failed++;
        await sleep(DELAY_MS);
        continue;
      }

      const photoName = result.photos[0].name;
      const photoUrl = await resolvePhotoUrl(photoName);

      if (!photoUrl) {
        console.log('photo URL failed');
        failed++;
      } else {
        place.photoUrl = photoUrl;
        updated++;
        console.log(`OK → ${photoUrl.substring(0, 60)}...`);
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  fs.writeFileSync(filePath, JSON.stringify(places, null, 2), 'utf8');

  console.log(`\n✓ ${cityFile}: ${updated} updated, ${skipped} already had photos, ${failed} failed`);
}

// --- Main ---
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: node scripts/fetch-place-photos.mjs <city-slug>  OR  --all');
  console.log('Example: node scripts/fetch-place-photos.mjs tel-aviv');
  process.exit(0);
}

if (args[0] === '--all') {
  const files = fs.readdirSync(SEEDED_DIR).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    console.log(`\n=== Processing ${f} ===`);
    await processCity(f);
  }
} else {
  const slug = args[0].endsWith('.json') ? args[0] : `${args[0]}.json`;
  await processCity(slug);
}
