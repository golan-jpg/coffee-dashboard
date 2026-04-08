import { kv } from "@vercel/kv";

const RATINGS_KEY = "userRatings";
const HIDDEN_PLACE_IDS_KEY = "hiddenPlaceIds";
const MANUAL_PLACES_KEY = "manualPlaces";
const PLACE_OVERRIDES_KEY = "placeOverrides";

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

function asManualPlacesArray(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();

  return value.reduce((acc, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return acc;

    const id = String(item.id || "").trim();
    const name = String(item.name || "").trim();
    const lat = Number(item.lat);
    const lon = Number(item.lon);

    if (!id || seen.has(id) || !name || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return acc;
    }

    seen.add(id);
    acc.push({
      ...item,
      id,
      name,
      lat,
      lon,
      notes: String(item.notes || ""),
      cityName: String(item.cityName || ""),
      source: String(item.source || "manual"),
      updatedAt: Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : undefined,
    });
    return acc;
  }, []);
}

function asPlaceOverrideEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const next = {};

  if (Object.prototype.hasOwnProperty.call(value, "name")) next.name = String(value.name || "").trim();
  if (Object.prototype.hasOwnProperty.call(value, "address")) next.address = String(value.address || "").trim();
  if (Object.prototype.hasOwnProperty.call(value, "notes")) next.notes = String(value.notes || "").trim();
  if (Object.prototype.hasOwnProperty.call(value, "cityName")) next.cityName = String(value.cityName || "").trim();
  if (Object.prototype.hasOwnProperty.call(value, "source")) next.source = String(value.source || "").trim();

  if (Object.prototype.hasOwnProperty.call(value, "lat")) {
    const lat = Number(value.lat);
    if (Number.isFinite(lat)) next.lat = lat;
  }

  if (Object.prototype.hasOwnProperty.call(value, "lon")) {
    const lon = Number(value.lon);
    if (Number.isFinite(lon)) next.lon = lon;
  }

  if (Object.prototype.hasOwnProperty.call(value, "specialtyScore")) {
    const specialtyScore = Number(value.specialtyScore);
    if (Number.isFinite(specialtyScore)) next.specialtyScore = Math.max(0, Math.min(100, specialtyScore));
  }

  if (value.deleted === true) next.deleted = true;

  if (Object.prototype.hasOwnProperty.call(value, "updatedAt")) {
    const updatedAt = Number(value.updatedAt);
    if (Number.isFinite(updatedAt)) next.updatedAt = updatedAt;
  }

  return Object.keys(next).length > 0 ? next : null;
}

function asPlaceOverridesMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.entries(value).reduce((acc, [id, entry]) => {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) return acc;

    const normalizedEntry = asPlaceOverrideEntry(entry);
    if (!normalizedEntry) return acc;

    acc[normalizedId] = normalizedEntry;
    return acc;
  }, {});
}

function normalizeIncomingRatings(incoming) {
  const payload = asObject(incoming);
  if (payload.ratings && typeof payload.ratings === "object" && !Array.isArray(payload.ratings)) {
    return asObject(payload.ratings);
  }
  return payload;
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
  const normalized = normalizeIncomingRatings(incomingRatings);
  await saveRatings(normalized);
  return normalized;
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

export async function loadManualPlaces() {
  if (!hasKv()) return [];
  const data = await kv.get(MANUAL_PLACES_KEY);
  return asManualPlacesArray(data);
}

export async function saveManualPlaces(manualPlaces) {
  if (!hasKv()) return;
  await kv.set(MANUAL_PLACES_KEY, asManualPlacesArray(manualPlaces));
}

export async function loadPlaceOverrides() {
  if (!hasKv()) return {};
  const data = await kv.get(PLACE_OVERRIDES_KEY);
  return asPlaceOverridesMap(data);
}

export async function savePlaceOverrides(placeOverrides) {
  if (!hasKv()) return;
  await kv.set(PLACE_OVERRIDES_KEY, asPlaceOverridesMap(placeOverrides));
}
