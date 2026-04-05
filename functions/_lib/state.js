const RATINGS_KEY = "userRatings";
const HIDDEN_PLACE_IDS_KEY = "hiddenPlaceIds";

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

function getKv(env) {
  return env?.CUPROAM_STATE || null;
}

export async function loadRatings(env) {
  const kv = getKv(env);
  if (!kv) return {};
  const data = await kv.get(RATINGS_KEY, { type: "json" });
  return asObject(data);
}

export async function saveRatings(env, ratings) {
  const kv = getKv(env);
  if (!kv) return;
  await kv.put(RATINGS_KEY, JSON.stringify(asObject(ratings)));
}

export async function mergeAndSaveRatings(env, incomingRatings) {
  const existing = await loadRatings(env);
  const merged = mergeRatings(existing, incomingRatings);
  await saveRatings(env, merged);
  return merged;
}

export async function loadHiddenPlaceIds(env) {
  const kv = getKv(env);
  if (!kv) return [];
  const data = await kv.get(HIDDEN_PLACE_IDS_KEY, { type: "json" });
  return asIdArray(data);
}

export async function saveHiddenPlaceIds(env, hiddenPlaceIds) {
  const kv = getKv(env);
  if (!kv) return;
  await kv.put(HIDDEN_PLACE_IDS_KEY, JSON.stringify(asIdArray(hiddenPlaceIds)));
}

export async function mergeAndSaveHiddenPlaceIds(env, incomingHiddenPlaceIds) {
  const existing = await loadHiddenPlaceIds(env);
  const merged = asIdArray([...existing, ...asIdArray(incomingHiddenPlaceIds)]);
  await saveHiddenPlaceIds(env, merged);
  return merged;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
