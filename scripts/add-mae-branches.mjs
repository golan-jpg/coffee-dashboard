import fs from 'fs';
const path = 'src/data/seededPlaces.json';
const d = JSON.parse(fs.readFileSync(path, 'utf8'));

// Tel Aviv Mae branches
d['Tel Aviv'].push(
  {
    name: 'Mae - אבן גבירול',
    lat: 32.0833430,
    lon: 34.7815710,
    address: 'אבן גבירול 98, תל אביב',
    source: 'seeded',
    isSpecialty: true,
    needsCoords: false,
    notes: 'Mae Cafe branch, specialty roaster chain',
  },
  {
    name: 'Mae - מונטיפיורי',
    lat: 32.0648030,
    lon: 34.7692800,
    address: 'מונטיפיורי 3, תל אביב',
    source: 'seeded',
    isSpecialty: true,
    needsCoords: false,
    notes: 'Mae Cafe branch, specialty roaster chain',
  },
  {
    name: 'Mae - שרונה',
    lat: 32.0719550,
    lon: 34.7881810,
    address: 'רב אלוף דוד אלעזר 17, פארק שרונה, תל אביב',
    source: 'seeded',
    isSpecialty: true,
    needsCoords: false,
    notes: 'Mae Cafe branch, specialty roaster chain',
  }
);

// Ramat Gan Mae branches (new city)
d['Ramat Gan'] = [
  {
    name: 'Mae - בית הקלייה',
    lat: 32.0861469,
    lon: 34.8030371,
    address: 'תובל 15, רמת גן (הבורסה)',
    source: 'seeded',
    isSpecialty: true,
    needsCoords: false,
    notes: 'Mae Cafe flagship roastery branch',
  },
  {
    name: 'Mae - המגדל',
    lat: 32.0826,
    lon: 34.8037,
    address: 'החילזון 9, מגדל וואן, רמת גן',
    source: 'seeded',
    isSpecialty: true,
    needsCoords: false,
    notes: 'Mae Cafe branch, Migdal One tower — coords from known location',
  },
];

// Ra'anana Mae branch (new city)
d["Ra'anana"] = [
  {
    name: "Mae - רעננה",
    lat: 32.1976788,
    lon: 34.8811941,
    address: 'זרחין 13, I-TECH פארק, רעננה',
    source: 'seeded',
    isSpecialty: true,
    needsCoords: false,
    notes: 'Mae Cafe branch',
  },
];

fs.writeFileSync(path, JSON.stringify(d, null, 2));

// Verify
console.log('Tel Aviv total:', d['Tel Aviv'].length);
console.log('Ramat Gan:', d['Ramat Gan'].length, 'entries');
console.log("Ra'anana:", d["Ra'anana"].length, 'entries');
console.log('Mae TLV:', d['Tel Aviv'].filter(p => p.name.startsWith('Mae')).map(p=>p.name));
