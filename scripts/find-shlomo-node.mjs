// Find the unnamed OSM cafe at Shlomo HaMelech 12 Tel Aviv
const q = `[out:json][timeout:25];
(
  node["addr:street"~"שלמה המלך|Shlomo HaMelech|Shlomo Hamelech",i](around:500,32.0774,34.7767);
  node["amenity"="cafe"](around:300,32.0774,34.7767);
  node["shop"="coffee"](around:300,32.0774,34.7767);
);out center tags;`;

const r = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  body: new URLSearchParams({ data: q }),
});
const d = await r.json();
for (const e of d.elements || []) {
  console.log({
    id: `${e.type}/${e.id}`,
    lat: e.lat,
    lon: e.lon,
    name: e.tags?.name || '(no name)',
    addr: e.tags?.['addr:street'] || '',
    housenumber: e.tags?.['addr:housenumber'] || '',
    amenity: e.tags?.amenity || '',
    shop: e.tags?.shop || '',
    opening_hours: e.tags?.opening_hours || '',
  });
}
