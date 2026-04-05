import { kv } from "@vercel/kv";

const RATINGS_KEY = "userRatings";
const HIDDEN_PLACE_IDS_KEY = "hiddenPlaceIds";

function hasKv() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asIdArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(Boolean).map((item) => String(item))));
}

function mergeRatings(existing, incoming) {
  const merged = { ...asObject(existing) };

  Object.entries(asObject(incoming)).forEach(([id, value]) => {
    const current = Number(merged[id] || 0);
    const next = Number(value || 0);
    if (next > current) {
      merged[id] = next;
    }
  });

  return merged;
}

export function isKvConfigured() {
  return hasKv();
}

export async function loadRatings() {
  if (!hasKv()) return {};
  const data = await kv.get(RATINGS_KEY);
  return asObject(data);
}

export async function saveRatings(ratings) {
  if (!hasKv()) return;
  await kv.set(RATINGS_KEY, asObject(ratings));
}

export async function mergeAndSaveRatings(incomingRatings) {
  const existing = await loadRatings();
  const merged = mergeRatings(existing, incomingRatings);
  await saveRatings(merged);
  return merged;
}

export async function loadHiddenPlaceIds() {
  if (!hasKv()) return [];
  const data = await kv.get(HIDDEN_PLACE_IDS_KEY);
  return asIdArray(data);
}

export async function saveHiddenPlaceIds(hiddenPlaceIds) {
  if (!hasKv()) return;
  await kv.set(HIDDEN_PLACE_IDS_KEY, asIdArray(hiddenPlaceIds));
}

export async function mergeAndSaveHiddenPlaceIds(incomingHiddenPlaceIds) {
  const existing = await loadHiddenPlaceIds();
  const merged = asIdArray([...existing, ...asIdArray(incomingHiddenPlaceIds)]);
  await saveHiddenPlaceIds(merged);
  return merged;
}
