// Check OSM cafes in Jerusalem and Haifa
const cities = [
  { name: 'Jerusalem', lat: 31.7800, lon: 35.2240, radius: 3500 },
  { name: 'Haifa',     lat: 32.7940, lon: 34.9896, radius: 3000 },
];

const specialtyKeywords = [
  'specialty','roaster','third wave','single origin','filter coffee',
  'ספשיאלטי','קלייה','רוסטר','מיישן','third-wave',
];

for (const city of cities) {
  const q = `[out:json][timeout:25];(
    node["amenity"="cafe"](around:${city.radius},${city.lat},${city.lon});
    node["shop"="coffee"](around:${city.radius},${city.lat},${city.lon});
    way["amenity"="cafe"](around:${city.radius},${city.lat},${city.lon});
  );out center tags;`;

  const r = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: new URLSearchParams({ data: q }),
  });
  const d = await r.json();

  const places = (d.elements || [])
    .map(e => ({
      name: e.tags?.name || '',
      lat: e.lat ?? e.center?.lat,
      lon: e.lon ?? e.center?.lon,
      cuisine: e.tags?.cuisine || '',
      description: e.tags?.description || '',
      tag_str: JSON.stringify(e.tags || '').toLowerCase(),
    }))
    .filter(e => e.name);

  const spec = places.filter(p =>
    specialtyKeywords.some(k => p.tag_str.includes(k) || p.name.toLowerCase().includes(k))
  );

  console.log(`\n=== ${city.name}  (total OSM cafes: ${places.length})`);
  console.log('Specialty-tagged:');
  spec.forEach(p => console.log(`  ${p.name}  (${p.lat?.toFixed(5)}, ${p.lon?.toFixed(5)})`));
  console.log('All places (first 20):');
  places.slice(0, 20).forEach(p => console.log(`  ${p.name}  (${p.lat?.toFixed(5)}, ${p.lon?.toFixed(5)})`));
}
