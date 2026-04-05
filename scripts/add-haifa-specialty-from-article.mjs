import fs from 'fs';

const FILE = 'src/data/seededPlaces.json';

const candidates = [
  {
    name: 'קפה ליבירה',
    address: 'הנמל 26, חיפה',
    queries: ['HaNamal 26, Haifa, Israel', 'הנמל 26 חיפה'],
  },
  {
    name: 'קפה סמי',
    address: 'דרך העצמאות 90, חיפה',
    queries: ['Derekh HaAtsmaut 90, Haifa, Israel', 'דרך העצמאות 90 חיפה'],
  },
  {
    name: 'קפה אווא',
    address: 'דרך העצמאות 53, חיפה',
    queries: ['Derekh HaAtsmaut 53, Haifa, Israel', 'דרך העצמאות 53 חיפה'],
  },
  {
    name: 'קפה נעימה',
    address: 'דרך יפו 49, חיפה',
    queries: ['Derekh Yafo 49, Haifa, Israel', 'דרך יפו 49 חיפה'],
  },
  {
    name: 'קפה נעימה - ואדי סאליב',
    address: 'ואדי סאליב 2, חיפה',
    queries: ['Wadi Salib 2, Haifa, Israel', 'ואדי סאליב 2 חיפה'],
  },
  {
    name: 'סמרה',
    address: 'הבנקים 11, חיפה',
    queries: ['HaBankim 11, Haifa, Israel', 'הבנקים 11 חיפה'],
  },
  {
    name: 'Tsafon Roasters',
    address: 'הנביאים 17, חיפה',
    queries: ['HaNeviim 17, Haifa, Israel', 'הנביאים 17 חיפה'],
  },
  {
    name: 'קפה טליק',
    address: 'סירקין 21, חיפה',
    queries: ['Sirkin 21, Haifa, Israel', 'סירקין 21 חיפה', 'Talek Cafe Haifa'],
  },
  {
    name: 'קפה דקל',
    address: 'נורדאו 26, חיפה',
    queries: ['Nordau 26, Haifa, Israel', 'נורדאו 26 חיפה'],
  },
  {
    name: 'קפה שכנים',
    address: 'שדרות הנשיא 116, חיפה',
    queries: ['Sderot HaNassi 116, Haifa, Israel', 'שדרות הנשיא 116 חיפה'],
  },
  {
    name: 'קפה בירדי',
    address: 'שדרות מוריה 9, חיפה',
    queries: ['Sderot Moriah 9, Haifa, Israel', 'שדרות מוריה 9 חיפה', 'Birdy cafe Haifa'],
  },
];

async function geocodeOne(queries) {
  for (const query of queries) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'coffee-dashboard-geocoder/1.0' } });
      const data = await res.json();
      const hit = data?.[0];
      if (hit?.lat && hit?.lon) {
        return { lat: Number(hit.lat), lon: Number(hit.lon), query, displayName: hit.display_name };
      }
    } catch {
      // continue
    }
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }
  return null;
}

const raw = fs.readFileSync(FILE, 'utf8');
const data = JSON.parse(raw);
const existing = Array.isArray(data.Haifa) ? data.Haifa : [];

const existingNames = new Set(existing.map((p) => String(p.name || '').trim().toLowerCase()));

const added = [];
const skipped = [];

for (const place of candidates) {
  if (existingNames.has(place.name.trim().toLowerCase())) {
    skipped.push({ name: place.name, reason: 'exists' });
    continue;
  }

  const geo = await geocodeOne(place.queries);
  const entry = {
    name: place.name,
    address: place.address,
    source: 'seeded',
    isSpecialty: true,
    needsCoords: !geo,
    lat: geo ? geo.lat : null,
    lon: geo ? geo.lon : null,
    notes: geo
      ? `added from hey-fa specialty list; geocoded by ${geo.query}`
      : 'added from hey-fa specialty list; needs exact coords',
  };

  existing.push(entry);
  existingNames.add(place.name.trim().toLowerCase());
  added.push({ name: place.name, geocoded: Boolean(geo), lat: entry.lat, lon: entry.lon });
}

data.Haifa = existing;
fs.writeFileSync(FILE, `${JSON.stringify(data, null, 2)}\n`);

console.log(JSON.stringify({ addedCount: added.length, skippedCount: skipped.length, added, skipped }, null, 2));
