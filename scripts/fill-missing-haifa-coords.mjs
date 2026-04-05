import fs from 'fs';

const FILE = 'src/data/seededPlaces.json';
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const haifa = Array.isArray(data.Haifa) ? data.Haifa : [];

const missing = haifa.filter((p) => p.needsCoords === true || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lon)));
if (missing.length === 0) {
  console.log('No missing coords in Haifa');
  process.exit(0);
}

const overpass = 'https://overpass-api.de/api/interpreter';

async function searchByName(name) {
  const escaped = name.replace(/"/g, '\\"');
  const q = `[out:json][timeout:25];(node["name"~"${escaped}",i](around:12000,32.80,35.00);way["name"~"${escaped}",i](around:12000,32.80,35.00););out center tags;`;
  const res = await fetch(overpass, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ data: q }),
  });
  const parsed = await res.json();
  const rows = (parsed.elements || []).map((e) => ({
    name: e.tags?.name || '',
    lat: e.lat ?? e.center?.lat,
    lon: e.lon ?? e.center?.lon,
    amenity: e.tags?.amenity || '',
    shop: e.tags?.shop || '',
  })).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));

  const coffeeish = rows.find((r) => ['cafe', 'coffee'].includes(String(r.amenity).toLowerCase()) || String(r.shop).toLowerCase() === 'coffee');
  return coffeeish || rows[0] || null;
}

const aliases = {
  'קפה סמי': ['סמי', 'Samy Coffee', 'קפה סמי'],
  'קפה אווא': ['אווא', 'Cafe Ava', 'קפה אווא'],
  'קפה נעימה': ['נעימה', 'Cafe Naima', 'קפה נעימה'],
};

for (const place of missing) {
  const terms = aliases[place.name] || [place.name];
  let hit = null;
  for (const term of terms) {
    try {
      hit = await searchByName(term);
      if (hit) break;
    } catch {
      // continue
    }
    await new Promise((r) => setTimeout(r, 900));
  }

  if (hit) {
    place.lat = hit.lat;
    place.lon = hit.lon;
    place.needsCoords = false;
    place.notes = `${place.notes || ''}${place.notes ? '; ' : ''}filled from OSM name match: ${hit.name}`;
    console.log(`OK ${place.name} -> ${hit.lat}, ${hit.lon}`);
  } else {
    console.log(`MISS ${place.name}`);
  }
}

fs.writeFileSync(FILE, `${JSON.stringify(data, null, 2)}\n`);
