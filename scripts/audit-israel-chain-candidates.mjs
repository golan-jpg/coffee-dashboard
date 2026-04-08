import { writeFileSync } from "node:fs";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

const cities = [
  { name: "Tel Aviv", lat: 32.0853, lon: 34.7818, radius: 9000 },
  { name: "Jerusalem", lat: 31.7683, lon: 35.2137, radius: 9000 },
  { name: "Haifa", lat: 32.794, lon: 34.9896, radius: 8500 },
  { name: "Ramat Gan", lat: 32.0684, lon: 34.8248, radius: 7000 },
  { name: "Ra'anana", lat: 32.1848, lon: 34.8713, radius: 7000 },
  { name: "Beer Sheva", lat: 31.2518, lon: 34.7915, radius: 8000 },
  { name: "Eilat", lat: 29.5581, lon: 34.9482, radius: 7000 },
];

const removedNowKeywords = [
  "cafe cafe",
  "café café",
  "קפה קפה",
  "landwer",
  "cafe landwer",
  "café landwer",
  "לנדוור",
  "קפה לנדוור",
  "aroma espresso",
  "aroma espresso bar",
  "ארומה אספרסו",
  "ארומה אספרסו בר",
  "ארומה",
];

const similarReviewKeywords = [
  "greg",
  "גרג",
  "arcaffe",
  "ארקפה",
  "cofix",
  "קופיקס",
  "cafe joe",
  "קפה ג'ו",
  "coffee shop",
  "re:bar",
  "rebar",
  "ריבר",
];

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildQuery({ lat, lon, radius }) {
  return `
[out:json][timeout:25];
(
  node["amenity"="cafe"](around:${radius},${lat},${lon});
  way["amenity"="cafe"](around:${radius},${lat},${lon});
  relation["amenity"="cafe"](around:${radius},${lat},${lon});
  node["shop"="coffee"](around:${radius},${lat},${lon});
  way["shop"="coffee"](around:${radius},${lat},${lon});
  relation["shop"="coffee"](around:${radius},${lat},${lon});
);
out center tags;
`;
}

async function fetchOverpass(query) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: query,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }

  throw lastError || new Error("Failed all Overpass endpoints");
}

function placeName(tags = {}) {
  return [tags.name, tags["name:he"], tags["name:en"], tags.brand]
    .find((value) => typeof value === "string" && value.trim().length > 0) || null;
}

const perName = new Map();
const removedMatches = [];
const reviewMatches = [];
const cityErrors = [];

for (const city of cities) {
  let data = null;
  try {
    data = await fetchOverpass(buildQuery(city));
  } catch (error) {
    cityErrors.push({ city: city.name, error: error?.message || "Overpass failed" });
    continue;
  }

  const elements = Array.isArray(data?.elements) ? data.elements : [];

  for (const element of elements) {
    const name = placeName(element.tags || {});
    if (!name) continue;

    const normalized = normalizeName(name);
    if (!normalized) continue;

    const existing = perName.get(normalized) || {
      name,
      normalized,
      count: 0,
      cities: new Set(),
      ids: [],
    };

    existing.count += 1;
    existing.cities.add(city.name);
    existing.ids.push(`${element.type}-${element.id}`);
    if (!existing.name || existing.name.length < name.length) {
      existing.name = name;
    }

    perName.set(normalized, existing);

    const removedBy = removedNowKeywords.find((keyword) => normalized.includes(normalizeName(keyword)));
    if (removedBy) {
      removedMatches.push({
        city: city.name,
        name,
        id: `${element.type}-${element.id}`,
        matchedKeyword: removedBy,
      });
      continue;
    }

    const reviewBy = similarReviewKeywords.find((keyword) => normalized.includes(normalizeName(keyword)));
    if (reviewBy) {
      reviewMatches.push({
        city: city.name,
        name,
        id: `${element.type}-${element.id}`,
        matchedKeyword: reviewBy,
      });
    }
  }
}

const repeatedNames = Array.from(perName.values())
  .filter((entry) => entry.count >= 3 && entry.cities.size >= 2)
  .map((entry) => ({
    name: entry.name,
    count: entry.count,
    cities: Array.from(entry.cities).sort(),
  }))
  .sort((a, b) => b.count - a.count)
  .slice(0, 80);

const reviewCandidates = reviewMatches
  .reduce((acc, item) => {
    const key = `${item.name}__${item.matchedKeyword}`;
    if (!acc.has(key)) {
      acc.set(key, {
        name: item.name,
        matchedKeyword: item.matchedKeyword,
        cities: new Set(),
        ids: [],
      });
    }

    const target = acc.get(key);
    target.cities.add(item.city);
    target.ids.push(item.id);
    return acc;
  }, new Map());

const flattenedReviewCandidates = Array.from(reviewCandidates.values())
  .map((entry) => ({
    name: entry.name,
    matchedKeyword: entry.matchedKeyword,
    cities: Array.from(entry.cities).sort(),
    count: entry.ids.length,
  }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

const report = {
  generatedAt: new Date().toISOString(),
  scope: "Israel city centers (Overpass cafes/coffee shops)",
  cityErrors,
  removedNowKeywords,
  removedMatchesCount: removedMatches.length,
  removedMatches: removedMatches.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200),
  similarReviewKeywords,
  similarCandidatesCount: flattenedReviewCandidates.length,
  similarCandidates: flattenedReviewCandidates,
  repeatedNamesForManualReview: repeatedNames,
};

const outPath = "debug/israel-chain-candidates-report.json";
writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

console.log(`Report written: ${outPath}`);
console.log(`Removed-keyword matches found: ${report.removedMatchesCount}`);
console.log(`Similar candidates for review: ${report.similarCandidatesCount}`);
