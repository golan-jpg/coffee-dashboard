const MANUAL_PLACES_STORAGE_KEY = "scf_manual_places_v1";

export function loadManualPlaces() {
  try {
    const raw = localStorage.getItem(MANUAL_PLACES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveManualPlaces(places) {
  localStorage.setItem(MANUAL_PLACES_STORAGE_KEY, JSON.stringify(places));
}
