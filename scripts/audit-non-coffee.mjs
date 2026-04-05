import { readFileSync } from 'fs';

const googleListsData = JSON.parse(readFileSync('src/data/googleLists.json', 'utf8'));

const strictCoffeeKeywords = [
  'coffee', 'cafe', 'café', 'cafè', 'caffè', 'espresso', 'coffee shop',
  'kaffee', 'kafe', 'קפה', 'בית קפה', 'אספרסו',
];

const coffeeKeywords = [
  'coffee', 'cafe', 'café', 'cafè', 'caffè', 'espresso', 'roaster', 'roastery',
  'specialty', 'barista', 'קפה', 'בית קפה', 'אספרסו', 'קלייה', 'רוסטר',
];

const negativeKeywords = [
  'restaurant', 'bistro', 'grill', 'sushi', 'pizza', 'bar', 'pub',
  'eatery', 'kitchen', 'diner', 'burger', 'burgers',
  'bubble tea', 'bubble_tea', 'boba', 'tea house', 'dessert', 'ice cream',
  'gelato', 'frozen yogurt', 'yogurt', 'mochi', 'waffle', 'crepe', 'donut',
  'מסעדה', 'בר', 'פיצה', 'סושי', 'גריל', 'המבורגר',
];

const bakeryKeywords = [
  'bakery', 'patisserie', 'pastry', 'boulangerie', 'viennoiserie', 'croissant',
  'מאפיה', 'מאפייה', 'קונדיטוריה', 'פטיסרי', 'מאפים',
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

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function textOf(place) {
  return [place.name, place.address, place.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function isStrictCoffeePlace(place) {
  const text = textOf(place);
  return strictCoffeeKeywords.some((keyword) => text.includes(keyword));
}

function isCoffeePlace(place) {
  const text = textOf(place);
  return coffeeKeywords.some((keyword) => text.includes(keyword));
}

function isRestaurantOrBar(place) {
  const text = textOf(place);
  return negativeKeywords.some((keyword) => text.includes(keyword));
}

function isBakeryPlace(place) {
  const text = textOf(place);
  return bakeryKeywords.some((keyword) => text.includes(keyword));
}

const places = googleListsData.lists.flatMap((list, listIdx) =>
  list.places.map((place, placeIdx) => ({
    id: `google-${listIdx}-${placeIdx}`,
    name: place.name,
    lat: Number(place.latitude),
    lon: Number(place.longitude),
    address: place.address || '',
    description: '',
  }))
);

for (const city of cities) {
  const near = places.filter(
    (place) =>
      Number.isFinite(place.lat) &&
      Number.isFinite(place.lon) &&
      haversineKm(city.lat, city.lon, place.lat, place.lon) <= 40
  );

  const kept = near.filter((place) => {
    if (!isStrictCoffeePlace(place)) return false;
    const isCoffee = isCoffeePlace(place);
    const isBakery = isBakeryPlace(place);
    const isFood = isRestaurantOrBar(place);
    return (isCoffee || isBakery) && !isFood;
  });

  const suspiciousKept = kept.filter((place) => {
    const text = textOf(place);
    return [
      'burger', 'bistro', 'sushi', 'pizza', 'bar', 'pub',
      'dessert', 'gelato', 'ice cream', 'yogurt', 'mochi', 'waffle', 'donut',
    ].some((keyword) => text.includes(keyword));
  });

  console.log(`\n${city.name}: near=${near.length}, kept=${kept.length}, suspiciousKept=${suspiciousKept.length}`);
  if (suspiciousKept.length > 0) {
    console.log('  suspicious:', suspiciousKept.map((place) => place.name));
  }
}
