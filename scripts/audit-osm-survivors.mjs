import { classifyPlace } from '../src/utils/calculateSpecialtyScore.js';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
];

const cities = [
  { name: 'Berlin', lat: 52.52, lon: 13.405 },
  { name: 'Tel Aviv', lat: 32.0853, lon: 34.7818 },
  { name: 'Paris', lat: 48.8566, lon: 2.3522 },
  { name: 'Amsterdam', lat: 52.3676, lon: 4.9041 },
  { name: 'Copenhagen', lat: 55.6761, lon: 12.5683 },
  { name: 'Barcelona', lat: 41.3874, lon: 2.1686 },
  { name: 'London', lat: 51.5074, lon: -0.1278 },
];

const strictCoffeeKeywords = [
  'coffee', 'cafe', 'café', 'cafè', 'caffè', 'espresso', 'coffee shop',
  'kaffee', 'kafe', 'קפה', 'בית קפה', 'אספרסו',
];

const negativeKeywords = [
  'restaurant', 'bistro', 'grill', 'sushi', 'pizza', 'bar', 'pub', 'eatery', 'kitchen', 'diner',
  'burger', 'burgers', 'bubble tea', 'bubble_tea', 'boba', 'tea house', 'dessert',
  'ice cream', 'ice_cream', 'gelato', 'frozen yogurt', 'frozen_yogurt', 'yogurt',
  'mochi', 'waffle', 'crepe', 'donut', 'bakery', 'patisserie', 'pastry',
  'מסעדה', 'בר', 'פיצה', 'סושי', 'גריל', 'המבורגר',
];

function buildQuery(city) {
  const radius = city.name === 'Tel Aviv' ? 1200 : 2200;
  return `[out:json][timeout:30];(
    node["amenity"="cafe"](around:${radius},${city.lat},${city.lon});
    way["amenity"="cafe"](around:${radius},${city.lat},${city.lon});
    relation["amenity"="cafe"](around:${radius},${city.lat},${city.lon});
    node["shop"="coffee"](around:${radius},${city.lat},${city.lon});
    way["shop"="coffee"](around:${radius},${city.lat},${city.lon});
    relation["shop"="coffee"](around:${radius},${city.lat},${city.lon});
  );out center tags;`;
}

async function fetchWithFallback(query) {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ data: query }),
      });

      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        continue;
      }
    } catch {
      // try next endpoint
    }
  }

  return { elements: [] };
}

function isStrictOsmCoffeePlace(place) {
  const tags = place.osmTags || {};
  const amenity = String(tags.amenity || '').toLowerCase();
  const shop = String(tags.shop || '').toLowerCase();
  const cuisine = String(tags.cuisine || place.cuisine || '').toLowerCase();

  const text = [place.name, place.address, place.description, cuisine, amenity, shop]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const hasCoffeeKeyword = strictCoffeeKeywords.some((kw) => text.includes(kw));
  const hasShopCoffee = shop === 'coffee';
  const hasCoffeeCuisine = ['coffee', 'coffee_shop', 'espresso', 'קפה', 'אספרסו'].some((kw) =>
    cuisine.includes(kw)
  );

  const hasNonCoffeeSignal = negativeKeywords.some((kw) => text.includes(kw));

  return (
    (hasShopCoffee || hasCoffeeCuisine || hasCoffeeKeyword) &&
    !hasNonCoffeeSignal &&
    (amenity === 'cafe' || amenity === 'coffee' || hasShopCoffee)
  );
}

for (const city of cities) {
  const data = await fetchWithFallback(buildQuery(city));
  const places = (data.elements || [])
    .map((el) => ({
      name: el.tags?.name || '',
      address: '',
      description: el.tags?.description || '',
      cuisine: el.tags?.cuisine || '',
      osmTags: el.tags || {},
    }))
    .filter((place) => place.name);

  const survivors = places.filter((place) => {
    const placeType = classifyPlace(place.osmTags, place.name);
    return placeType === 'coffee' && isStrictOsmCoffeePlace(place);
  });

  const suspicious = survivors.filter((place) => {
    const text = `${place.name} ${place.cuisine}`.toLowerCase();
    return [
      'burger', 'sushi', 'pizza', 'bar', 'pub', 'dessert',
      'gelato', 'ice cream', 'yogurt', 'mochi', 'waffle', 'donut', 'bubble',
    ].some((keyword) => text.includes(keyword));
  });

  console.log(`\n${city.name}: raw=${places.length}, survivors=${survivors.length}, suspicious=${suspicious.length}`);
  if (suspicious.length > 0) {
    console.log('  suspicious names:', suspicious.slice(0, 12).map((place) => place.name));
  }
}
