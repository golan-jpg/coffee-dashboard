import fs from 'fs';

const coffees = [
  { name: '15grams Coffee House', address: '28 Greenwich Church St, London, UK', lat: 51.4853, lon: -0.0023 },
  { name: 'Climpson & Sons Café', address: '67 Broadway Market, London, UK', lat: 51.5413, lon: -0.0748 },
  { name: 'Kaffeine | Fitzrovia', address: '66 Great Titchfield St., London, UK', lat: 51.5169, lon: -0.1388 },
  { name: 'Monmouth Coffee Company', address: '27 Monmouth St, London, UK', lat: 51.5106, lon: -0.1234 },
  { name: 'Origin Coffee', address: '65 Charlotte Rd, London, UK', lat: 51.5272, lon: -0.0734 },
  { name: 'Paradox Design and Coffee', address: '13-23 Westgate St, London, UK', lat: 51.5406, lon: -0.0768 }
];

// Load existing London places
const londonPath = 'src/data/seeded-cities/london.json';
let existing = [];
try {
  existing = JSON.parse(fs.readFileSync(londonPath, 'utf8'));
} catch {
  existing = [];
}

const existingNames = new Set(existing.map(p => (p.name || '').toLowerCase().trim()));
console.log(`Existing London places: ${existing.length}`);

async function main() {
  const toAdd = [];

  for (const cafe of coffees) {
    const cleanName = cafe.name.toLowerCase().trim();
    if (existingNames.has(cleanName)) {
      console.log(`⊘ Skip (exists): ${cafe.name}`);
      continue;
    }

    const place = {
      id: `seeded-london-${cafe.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      name: cafe.name,
      lat: cafe.lat,
      lon: cafe.lon,
      address: cafe.address,
      city: 'London',
      cityName: 'London',
      source: 'specialty-finder',
      placeType: 'coffee',
      isSpecialty: true,
      confidence: 95,
      specialty: true
    };

    toAdd.push(place);
    console.log(`✓ Added: ${cafe.name} (${cafe.lat.toFixed(4)}, ${cafe.lon.toFixed(4)})`);
  }

  const updated = [...existing, ...toAdd];
  fs.writeFileSync(londonPath, JSON.stringify(updated, null, 2), 'utf8');
  console.log(`\n✓ London places updated: ${existing.length} → ${updated.length}`);
  console.log(`  Added: ${toAdd.length} new places`);
}

main().catch(console.error);
