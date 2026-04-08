import { readFileSync } from "node:fs";

const defaultCities = ["london", "berlin", "new-york"];
const cliCities = process.argv.slice(2).map((value) => String(value || "").trim()).filter(Boolean);
const cities = cliCities.length > 0 ? cliCities : defaultCities;
const pattern = /starbucks|costa|nero|joe\s*&\s*the\s*juice|joe\s*&\s*juice|pret|blank street|paul|greggs|dunkin|mccafe|mcdonald|coffee fellows|espresso house|balzac|einstein|backwerk|tim hortons|panera|au bon pain|bakery|brunch|restaurant|bar\b/i;

for (const city of cities) {
  const filePath = `src/data/seeded-cities/${city}.json`;
  const places = JSON.parse(readFileSync(filePath, "utf8"));

  const chainHints = places
    .map((place) => ({
      name: String(place.name || "").trim(),
      address: String(place.address || "").trim(),
    }))
    .filter((place) => pattern.test(`${place.name} ${place.address}`));

  console.log(`\n${city.toUpperCase()} total=${places.length} chainHints=${chainHints.length}`);
  chainHints.slice(0, 80).forEach((place) => {
    console.log(`- ${place.name} | ${place.address}`);
  });
}
