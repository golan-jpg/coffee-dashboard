// Geocode Mae Cafe branches via Nominatim
const branches = [
  { name: 'Mae - בית הקלייה', query: 'Tobol 15, Ramat Gan, Israel', city: 'Ramat Gan', address: 'תובל 15, רמת גן' },
  { name: 'Mae - המגדל', query: 'Hahalzon 9, Ramat Gan, Israel', city: 'Ramat Gan', address: 'החילזון 9, רמת גן' },
  { name: 'Mae - רעננה', query: 'Zarchin 13, Raanana, Israel', city: "Ra'anana", address: 'זרחין 13, רעננה' },
  { name: 'Mae - אבן גבירול', query: 'Ibn Gabirol 98, Tel Aviv, Israel', city: 'Tel Aviv', address: 'אבן גבירול 98, תל אביב' },
  { name: 'Mae - מונטיפיורי', query: 'Montefiore 3, Tel Aviv, Israel', city: 'Tel Aviv', address: 'מונטיפיורי 3, תל אביב' },
  { name: 'Mae - שרונה', query: 'David Elazar 17, Tel Aviv, Israel', city: 'Tel Aviv', address: 'דוד אלעזר 17, שרונה, תל אביב' },
];

for (const b of branches) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(b.query)}&format=json&limit=1`;
  const r = await fetch(url, { headers: { 'User-Agent': 'coffee-dashboard-geocoder/1.0' } });
  const d = await r.json();
  const hit = d[0];
  if (hit) {
    console.log(`OK   ${b.city} | ${b.name}`);
    console.log(`     lat: ${hit.lat}, lon: ${hit.lon}`);
    console.log(`     display: ${hit.display_name}`);
  } else {
    console.log(`FAIL ${b.city} | ${b.name} | query: ${b.query}`);
  }
  await new Promise(r => setTimeout(r, 1100)); // Nominatim rate limit
}
