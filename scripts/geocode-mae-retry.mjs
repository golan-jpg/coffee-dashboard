// Retry failed Mae Cafe geocodes with alternate queries
const tries = [
  { name: 'Mae - בית הקלייה (Ramat Gan Bursa)', queries: [
    'Tuval 15, Ramat Gan, Israel',
    'Tobal 15, Ramat Gan, Israel',
    'Bursa Mall, Ramat Gan, Israel',
    'Tuval Street 15 Ramat Gan',
  ]},
  { name: 'Mae - המגדל (Migdal One)', queries: [
    'Hahlason 9, Ramat Gan, Israel',
    'Hahalon 9, Ramat Gan, Israel',
    'Migdal One Tower, Ramat Gan, Israel',
    '9 HaHilzon Ramat Gan Israel',
    'HaHilzon 9, Ramat Gan',
  ]},
  { name: 'Mae - רעננה', queries: [
    'Zarhin 13, Raanana, Israel',
    'Zarhin 13, Ra\'anana, Israel',
    'I-Tech Park, Raanana, Israel',
    '13 Zarchin Ra\'anana Israel',
    'HaZarhin 13, Raanana',
  ]},
];

for (const t of tries) {
  console.log(`\n=== ${t.name}`);
  for (const q of t.queries) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`;
    const r = await fetch(url, { headers: { 'User-Agent': 'coffee-dashboard-geocoder/1.0' } });
    const d = await r.json();
    const hit = d[0];
    if (hit) {
      console.log(`  HIT "${q}" → lat: ${hit.lat}, lon: ${hit.lon}`);
      console.log(`       ${hit.display_name.slice(0, 100)}`);
    } else {
      console.log(`  miss "${q}"`);
    }
    await new Promise(res => setTimeout(res, 1100));
  }
}
