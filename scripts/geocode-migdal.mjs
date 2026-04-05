const tries = [
  'HaHilzon 9 Ramat Gan',
  'Hilzon 9 Ramat Gan Israel',
  'HaChilzon 9, Ramat Gan',
  'Hagilzon 9, Ramat Gan, Israel',
  'Ha-Hilzon 9, Ramat Gan',
  'Migdal One Ramat Gan',
  'One Tower Ramat Gan Israel',
];
for (const q of tries) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`;
  const r = await fetch(url, { headers: { 'User-Agent': 'coffee-dashboard-geocoder/1.0' } });
  const d = await r.json();
  const hit = d[0];
  if (hit) console.log(`HIT "${q}" → ${hit.lat}, ${hit.lon} | ${hit.display_name.slice(0,80)}`);
  else console.log(`miss "${q}"`);
  await new Promise(res => setTimeout(res, 1100));
}
