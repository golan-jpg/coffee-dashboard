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

const DELAY_MS = 140;
const STOP_WORDS = new Set([
  'coffee', 'cafe', 'café', 'espresso', 'roasters', 'roastery', 'specialty', 'bar', 'bakery',
  'shop', 'house', 'store', 'brunch', 'lab', 'kava', 'kaffee', 'koffie', 'kawiarnia', 'cafeteria'
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(' ')
    .filter(Boolean)
    .filter((token) => !STOP_WORDS.has(token));
}

function tokenJaccard(a, b) {
  const as = new Set(tokenize(a));
  const bs = new Set(tokenize(b));
  if (!as.size || !bs.size) return 0;
  let intersection = 0;
  for (const token of as) if (bs.has(token)) intersection++;
  const union = new Set([...as, ...bs]).size;
  return union ? intersection / union : 0;
}

function bigrams(value) {
  const s = normalizeText(value).replace(/\s+/g, '');
  if (s.length < 2) return new Set(s ? [s] : []);
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function diceCoefficient(a, b) {
  const as = bigrams(a);
  const bs = bigrams(b);
  if (!as.size || !bs.size) return 0;
  let overlap = 0;
  for (const x of as) if (bs.has(x)) overlap++;
  return (2 * overlap) / (as.size + bs.size);
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceScore(meters) {
  if (!Number.isFinite(meters)) return 0;
  if (meters <= 35) return 1;
  if (meters <= 75) return 0.95;
  if (meters <= 150) return 0.82;
  if (meters <= 250) return 0.68;
  if (meters <= 400) return 0.52;
  if (meters <= 700) return 0.25;
  return 0;
}

function cityNameFromFile(file) {
  return file.replace('.json', '').replace(/-/g, ' ');
}

function buildQuery(place, cityName) {
  const bits = [place.name];
  if (place.address) bits.push(place.address);
  else bits.push(cityName);
  bits.push('coffee');
  return bits.filter(Boolean).join(' ');
}

async function searchCandidates(place, cityName) {
  const body = {
    textQuery: buildQuery(place, cityName),
    maxResultCount: 5,
    languageCode: 'en',
  };

  if (Number.isFinite(place.lat) && Number.isFinite(place.lon)) {
    body.locationBias = {
      circle: {
        center: {
          latitude: place.lat,
          longitude: place.lon,
        },
        radius: 250,
      },
    };
  }

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.photos',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) return [];
  const data = await res.json();
  return data.places || [];
}

function scoreCandidate(place, candidate) {
  const candName = candidate.displayName?.text || '';
  const candAddress = candidate.formattedAddress || '';
  const nameDice = diceCoefficient(place.name, candName);
  const nameToken = tokenJaccard(place.name, candName);
  const nameScore = Math.max(nameDice, nameToken);
  const addrScore = place.address ? tokenJaccard(place.address, candAddress) : 0;

  let distMeters = Infinity;
  if (
    Number.isFinite(place.lat) &&
    Number.isFinite(place.lon) &&
    Number.isFinite(candidate.location?.latitude) &&
    Number.isFinite(candidate.location?.longitude)
  ) {
    distMeters = haversineMeters(place.lat, place.lon, candidate.location.latitude, candidate.location.longitude);
  }

  const total = nameScore * 0.62 + distanceScore(distMeters) * 0.28 + addrScore * 0.10;
  return { total, nameScore, addrScore, distMeters, candName, candAddress };
}

function isStrongMatch(metrics) {
  return (
    (metrics.nameScore >= 0.88 && metrics.distMeters <= 500) ||
    (metrics.nameScore >= 0.78 && metrics.distMeters <= 180) ||
    (metrics.total >= 0.84 && metrics.distMeters <= 250)
  );
}

async function resolvePhotoUrl(photoName) {
  const apiUrl = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=900&key=${API_KEY}`;
  const res = await fetch(apiUrl, { redirect: 'follow' });
  if (!res.ok) return null;
  return res.url && !res.url.includes('googleapis.com/v1/') ? res.url : null;
}

async function processCity(file) {
  const filePath = path.join(SEEDED_DIR, file);
  const cityName = cityNameFromFile(file);
  const places = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  let updated = 0;
  let checked = 0;
  let noMatch = 0;
  let noPhoto = 0;
  let unchanged = 0;

  for (const place of places) {
    if (!place.name || !place.photoUrl) continue;
    checked++;
    process.stdout.write(`${file} :: ${place.name} ... `);

    try {
      const candidates = await searchCandidates(place, cityName);
      if (!candidates.length) {
        noMatch++;
        console.log('no candidates');
        await sleep(DELAY_MS);
        continue;
      }

      const ranked = candidates
        .map((candidate) => ({ candidate, metrics: scoreCandidate(place, candidate) }))
        .sort((a, b) => b.metrics.total - a.metrics.total);

      const best = ranked[0];
      if (!best || !isStrongMatch(best.metrics)) {
        noMatch++;
        console.log(`weak match (${best?.metrics.total?.toFixed(2) || '0.00'})`);
        await sleep(DELAY_MS);
        continue;
      }

      if (!best.candidate.photos?.length) {
        noPhoto++;
        console.log('strong match but no photos');
        await sleep(DELAY_MS);
        continue;
      }

      const nextUrl = await resolvePhotoUrl(best.candidate.photos[0].name);
      if (!nextUrl) {
        noPhoto++;
        console.log('photo resolve failed');
        await sleep(DELAY_MS);
        continue;
      }

      if (nextUrl === place.photoUrl) {
        unchanged++;
        console.log(`same (${best.metrics.total.toFixed(2)})`);
      } else {
        place.photoUrl = nextUrl;
        updated++;
        console.log(`updated (${best.metrics.total.toFixed(2)}, ${Math.round(best.metrics.distMeters)}m)`);
      }
    } catch (error) {
      noMatch++;
      console.log(`error: ${error.message}`);
    }

    await sleep(DELAY_MS);
  }

  fs.writeFileSync(filePath, JSON.stringify(places, null, 2), 'utf8');
  console.log(`✓ ${file}: checked=${checked} updated=${updated} unchanged=${unchanged} noMatch=${noMatch} noPhoto=${noPhoto}`);
  return { checked, updated, unchanged, noMatch, noPhoto };
}

const args = process.argv.slice(2);
let files = [];
if (!args.length || args[0] === '--all') {
  files = fs.readdirSync(SEEDED_DIR).filter((f) => f.endsWith('.json')).sort();
} else {
  files = args.map((arg) => (arg.endsWith('.json') ? arg : `${arg}.json`));
}

let totals = { checked: 0, updated: 0, unchanged: 0, noMatch: 0, noPhoto: 0 };
for (const file of files) {
  const result = await processCity(file);
  for (const key of Object.keys(totals)) totals[key] += result[key];
}
console.log(`DONE checked=${totals.checked} updated=${totals.updated} unchanged=${totals.unchanged} noMatch=${totals.noMatch} noPhoto=${totals.noPhoto}`);
