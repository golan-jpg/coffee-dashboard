// Find unnamed cafes around Shlomo HaMelech 12 with 07:00-19:00 hours
const q = `[out:json][timeout:25];
(
  node["amenity"="cafe"]["name"!~"."](around:2000,32.0800,34.7800);
  node["shop"="coffee"]["name"!~"."](around:2000,32.0800,34.7800);
);out center tags;`;

const r = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  body: new URLSearchParams({ data: q }),
});
const d = await r.json();
console.log('Unnamed cafes total:', d.elements?.length);
for (const e of d.elements || []) {
  const t = e.tags || {};
  console.log({
    id: `${e.type}/${e.id}`,
    lat: e.lat,
    lon: e.lon,
    addr_street: t['addr:street'] || '',
    addr_num: t['addr:housenumber'] || '',
    opening_hours: t.opening_hours || '',
    tags: t,
  });
}
