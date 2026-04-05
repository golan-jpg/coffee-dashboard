import fs from "fs";

const filePath = "src/data/seededPlaces.json";
const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

const provenanceRegex = /\s*\|?\s*(?:imported from european coffee trip\s*\([^)]*\)|geocoded\s*\(ect[^)]*\))\s*/gi;

let touched = 0;
let removedNotes = 0;

for (const cityPlaces of Object.values(data)) {
  if (!Array.isArray(cityPlaces)) continue;

  for (const place of cityPlaces) {
    if (!place || typeof place !== "object" || typeof place.notes !== "string") continue;

    const cleaned = place.notes
      .replace(provenanceRegex, " ")
      .replace(/\s*\|\s*/g, " | ")
      .replace(/\s+/g, " ")
      .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
      .trim();

    if (cleaned === place.notes.trim()) continue;

    touched += 1;
    if (cleaned) {
      place.notes = cleaned;
    } else {
      delete place.notes;
      removedNotes += 1;
    }
  }
}

fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
console.log(`Updated notes in ${touched} places; removed notes field from ${removedNotes} places.`);
