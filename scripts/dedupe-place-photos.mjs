import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SEEDED_DIR = path.join(ROOT, 'src/data/seeded-cities');

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DELAY_MS = 220;

function normalizeCityName(fileName) {
  return fileName.replace('.json', '').replace(/-/g, ' ');
}

function placeQuery(place, cityName) {
  const address = typeof place.address === 'string' ? place.address : '';
  const core = [place.name, address, cityName].filter(Boolean).join(' ');
  return `${core} coffee`;
}

async function searchCandidates(place, cityName) {
  const query = placeQuery(place, cityName);
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.photos',
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 4,
      languageCode: 'en',
    }),
  });

  if (!res.ok) return [];
  const data = await res.json();
  return data.places || [];
}

async function resolvePhotoUrl(photoName) {
  const apiUrl = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=900&key=${API_KEY}`;
  const res = await fetch(apiUrl, { redirect: 'follow' });
  if (!res.ok) return null;
  return res.url && !res.url.includes('googleapis.com/v1/') ? res.url : null;
}

async function findAlternativePhoto(place, cityName, usedUrls, currentUrl) {
  const candidates = await searchCandidates(place, cityName);
  if (!candidates.length) return null;

  for (const cand of candidates) {
    if (!cand.photos?.length) continue;

    const orderedPhotos = [];
    for (let i = 0; i < cand.photos.length; i++) {
      if (i >= 5) break;
      orderedPhotos.push(cand.photos[i]);
    }

    for (const photo of orderedPhotos) {
      const url = await resolvePhotoUrl(photo.name);
      if (!url) continue;
      if (url === currentUrl) continue;
      if (usedUrls.has(url)) continue;
      return url;
    }
  }

  return null;
}

async function processCity(cityFile) {
  const filePath = path.join(SEEDED_DIR, cityFile);
  const cityName = normalizeCityName(cityFile);
  const places = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const byPhoto = new Map();
  places.forEach((p, idx) => {
    if (!p.photoUrl) return;
    if (!byPhoto.has(p.photoUrl)) byPhoto.set(p.photoUrl, []);
    byPhoto.get(p.photoUrl).push(idx);
  });

  const duplicateGroups = [...byPhoto.entries()].filter(([, idxs]) => idxs.length > 1);
  if (!duplicateGroups.length) {
    console.log(`✓ ${cityFile}: no duplicates`);
    return { changed: 0, unresolved: 0, groups: 0 };
  }

  const usedUrls = new Set(places.map((p) => p.photoUrl).filter(Boolean));
  let changed = 0;
  let unresolved = 0;

  for (const [photoUrl, idxs] of duplicateGroups) {
    const keep = idxs[0];
    for (const idx of idxs.slice(1)) {
      const place = places[idx];
      process.stdout.write(`  ${cityFile} :: ${place.name} ... `);
      try {
        const alt = await findAlternativePhoto(place, cityName, usedUrls, photoUrl);
        if (alt) {
          places[idx].photoUrl = alt;
          usedUrls.add(alt);
          changed++;
          console.log('replaced');
        } else {
          unresolved++;
          console.log('no alternative');
        }
      } catch {
        unresolved++;
        console.log('error');
      }
      await sleep(DELAY_MS);
    }
    if (!places[keep]?.photoUrl) {
      unresolved++;
    }
  }

  if (changed > 0) {
    fs.writeFileSync(filePath, JSON.stringify(places, null, 2), 'utf8');
  }

  console.log(`✓ ${cityFile}: changed=${changed} unresolved=${unresolved} duplicateGroups=${duplicateGroups.length}`);
  return { changed, unresolved, groups: duplicateGroups.length };
}

async function main() {
  const args = process.argv.slice(2);
  let files = [];

  if (args[0] === '--all' || !args[0]) {
    files = fs.readdirSync(SEEDED_DIR).filter((f) => f.endsWith('.json')).sort();
  } else {
    files = [args[0].endsWith('.json') ? args[0] : `${args[0]}.json`];
  }

  let totalChanged = 0;
  let totalUnresolved = 0;
  let totalGroups = 0;

  for (const file of files) {
    const fp = path.join(SEEDED_DIR, file);
    if (!fs.existsSync(fp)) {
      console.log(`Skipping missing file: ${file}`);
      continue;
    }
    const res = await processCity(file);
    totalChanged += res.changed;
    totalUnresolved += res.unresolved;
    totalGroups += res.groups;
  }

  console.log(`\nDONE changed=${totalChanged} unresolved=${totalUnresolved} groups=${totalGroups}`);
}

await main();
