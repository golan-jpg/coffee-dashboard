import fs from "fs";
import path from "path";
import readline from "readline/promises";

const cwd = process.cwd();
const seededCitiesMeta = JSON.parse(
  fs.readFileSync(path.resolve(cwd, "src/data/seededCitiesMeta.json"), "utf8")
);

function parseArgs(argv) {
  const args = {
    file: "userRatings.json",
    write: false,
    auto: false,
    dryRun: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--write") args.write = true;
    else if (value === "--auto") args.auto = true;
    else if (value === "--dry-run") args.dryRun = true;
    else if (value === "--file" && argv[index + 1]) {
      args.file = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function normalizeCity(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeIdPart(value, fallback = "na") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u0590-\u05ff-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || fallback;
}

function toNum(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSeededStableId(cityName, place) {
  const cityKey = normalizeIdPart(cityName, "city");
  const nameKey = normalizeIdPart(place?.name, "unnamed");
  const lat = toNum(place?.lat);
  const lon = toNum(place?.lon);
  const latKey = lat === null ? "na" : lat.toFixed(5);
  const lonKey = lon === null ? "na" : lon.toFixed(5);
  return `seeded-${cityKey}-${nameKey}-${latKey}-${lonKey}`;
}

function buildNameAliasId(cityName, placeName) {
  const cityKey = normalizeIdPart(cityName, "city");
  const nameKey = normalizeIdPart(placeName, "unnamed");
  return `seeded-name-${cityKey}-${nameKey}`;
}

function parseLegacyIndexedSeededId(id) {
  if (!String(id).startsWith("seeded-")) return null;
  if (String(id).startsWith("seeded-name-")) return null;

  const withoutPrefix = id.slice("seeded-".length);
  const lastDash = withoutPrefix.lastIndexOf("-");
  if (lastDash <= 0) return null;

  const cityRaw = withoutPrefix.slice(0, lastDash);
  const indexRaw = withoutPrefix.slice(lastDash + 1);
  if (!/^\d+$/.test(indexRaw)) return null;

  return {
    cityRaw,
    legacyIndex: Number(indexRaw),
  };
}

function getCityFileByName(cityRaw) {
  const cities = Array.isArray(seededCitiesMeta?.cities) ? seededCitiesMeta.cities : [];
  const normalizedRaw = normalizeCity(cityRaw);

  const direct = cities.find((city) => normalizeCity(city.name) === normalizedRaw);
  if (direct?.file) return direct;

  const byTokenSubset = cities.find((city) => {
    const cityNorm = normalizeCity(city.name);
    return cityNorm.includes(normalizedRaw) || normalizedRaw.includes(cityNorm);
  });

  return byTokenSubset || null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function printCandidateList(cityName, cityPlaces, aroundIndex = 0, span = 12) {
  const start = Math.max(0, aroundIndex - Math.floor(span / 2));
  const end = Math.min(cityPlaces.length, start + span);
  console.log(`\nCandidates in ${cityName} (indices ${start}-${Math.max(start, end - 1)}):`);
  for (let index = start; index < end; index += 1) {
    const place = cityPlaces[index];
    const coords = [place?.lat, place?.lon].every((v) => Number.isFinite(Number(v)))
      ? ` (${Number(place.lat).toFixed(5)}, ${Number(place.lon).toFixed(5)})`
      : "";
    console.log(`  [${index}] ${place?.name || "(unnamed)"}${coords}`);
  }
}

async function resolveTargetIndex({
  rl,
  auto,
  cityName,
  cityPlaces,
  legacyIndex,
  legacyId,
  rating,
}) {
  if (auto) return cityPlaces[legacyIndex] ? legacyIndex : null;

  console.log(`\nLegacy rating: ${legacyId} -> ${rating}★`);
  const defaultPlace = cityPlaces[legacyIndex];
  if (defaultPlace) {
    console.log(`Default current index [${legacyIndex}]: ${defaultPlace.name}`);
  } else {
    console.log(`Default index [${legacyIndex}] is out of range for ${cityName}`);
  }

  printCandidateList(cityName, cityPlaces, Number.isFinite(legacyIndex) ? legacyIndex : 0, 14);
  console.log("Choose: [Enter]=default, number=index, l=list more, s=skip");

  while (true) {
    const answer = (await rl.question("> ")).trim().toLowerCase();
    if (!answer) return defaultPlace ? legacyIndex : null;
    if (answer === "s" || answer === "skip") return null;

    if (answer === "l" || answer === "list") {
      printCandidateList(cityName, cityPlaces, Number.isFinite(legacyIndex) ? legacyIndex : 0, 30);
      continue;
    }

    if (/^\d+$/.test(answer)) {
      const parsed = Number(answer);
      if (cityPlaces[parsed]) return parsed;
      console.log("Index out of range.");
      continue;
    }

    console.log("Invalid input.");
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const ratingsPath = path.resolve(cwd, args.file);

  if (!fs.existsSync(ratingsPath)) {
    console.error(`Ratings file not found: ${ratingsPath}`);
    process.exit(1);
  }

  const ratings = readJson(ratingsPath);
  if (!ratings || typeof ratings !== "object" || Array.isArray(ratings)) {
    console.error("Ratings file must be a JSON object.");
    process.exit(1);
  }

  const legacyEntries = Object.entries(ratings)
    .map(([id, rating]) => ({ id, rating: Number(rating || 0), parsed: parseLegacyIndexedSeededId(id) }))
    .filter((entry) => entry.parsed && entry.rating > 0);

  if (legacyEntries.length === 0) {
    console.log("No legacy seeded-City-index ratings found.");
    return;
  }

  const cityCache = new Map();
  const rl = args.auto ? null : readline.createInterface({ input: process.stdin, output: process.stdout });

  const migrated = { ...ratings };
  const changes = [];
  let skipped = 0;

  try {
    for (const entry of legacyEntries) {
      const { cityRaw, legacyIndex } = entry.parsed;
      const cityMeta = getCityFileByName(cityRaw);
      if (!cityMeta?.file) {
        console.log(`Skipping ${entry.id}: city not found (${cityRaw})`);
        skipped += 1;
        continue;
      }

      const cityName = cityMeta.name;
      const cityKey = cityMeta.file;

      if (!cityCache.has(cityKey)) {
        const cityFilePath = path.resolve(cwd, "src/data/seeded-cities", cityMeta.file);
        if (!fs.existsSync(cityFilePath)) {
          cityCache.set(cityKey, null);
        } else {
          cityCache.set(cityKey, readJson(cityFilePath));
        }
      }

      const cityPlaces = cityCache.get(cityKey);
      if (!Array.isArray(cityPlaces) || cityPlaces.length === 0) {
        console.log(`Skipping ${entry.id}: city file empty (${cityMeta.file})`);
        skipped += 1;
        continue;
      }

      const targetIndex = await resolveTargetIndex({
        rl,
        auto: args.auto,
        cityName,
        cityPlaces,
        legacyIndex,
        legacyId: entry.id,
        rating: entry.rating,
      });

      if (targetIndex === null) {
        skipped += 1;
        continue;
      }

      const targetPlace = cityPlaces[targetIndex];
      const stableId = buildSeededStableId(cityName, targetPlace);
      const nameAliasId = buildNameAliasId(cityName, targetPlace?.name);

      const currentStable = Number(migrated[stableId] || 0);
      const mergedRating = Math.max(currentStable, entry.rating);
      migrated[stableId] = mergedRating;
      migrated[nameAliasId] = mergedRating;
      delete migrated[entry.id];

      changes.push({
        legacyId: entry.id,
        stableId,
        aliasId: nameAliasId,
        rating: mergedRating,
        placeName: targetPlace?.name || "(unnamed)",
      });
    }
  } finally {
    if (rl) rl.close();
  }

  console.log(`\nRecovered: ${changes.length}, skipped: ${skipped}`);
  changes.slice(0, 30).forEach((change) => {
    console.log(`- ${change.legacyId} -> ${change.stableId} (${change.placeName}, ${change.rating}★)`);
  });
  if (changes.length > 30) {
    console.log(`...and ${changes.length - 30} more`);
  }

  const shouldWrite = args.write && !args.dryRun;
  if (!shouldWrite) {
    console.log("\nDry result only (no file written). Use --write to persist changes.");
    return;
  }

  const backupPath = `${ratingsPath}.before-legacy-recovery-${Date.now()}.bak`;
  fs.copyFileSync(ratingsPath, backupPath);
  writeJson(ratingsPath, migrated);
  console.log(`\nSaved migrated ratings to: ${ratingsPath}`);
  console.log(`Backup created: ${backupPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
