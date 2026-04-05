import { useEffect, useMemo, useState } from "react";
import { loadManualPlaces, saveManualPlaces } from "../utils/manualPlacesStore";

const REMOTE_MANUAL_PLACES_URL = "/api/backup-manual-places";
const REMOTE_MANUAL_PLACES_MIGRATED_KEY = "scf_manual_places_remote_migrated_v1";

function hasRemoteManualPlacesMigration() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(REMOTE_MANUAL_PLACES_MIGRATED_KEY) === "1";
}

function markRemoteManualPlacesMigrated() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(REMOTE_MANUAL_PLACES_MIGRATED_KEY, "1");
}

export function useManualPlaces() {
  const [manualPlaces, setManualPlaces] = useState(() => loadManualPlaces());
  const [isRemoteReady, setIsRemoteReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const hydrateRemoteManualPlaces = async () => {
      try {
        const response = await fetch(REMOTE_MANUAL_PLACES_URL);
        if (!response.ok) return;

        const payload = await response.json();
        const remoteManualPlaces = Array.isArray(payload?.manualPlaces) ? payload.manualPlaces : [];

        if (cancelled) return;

        setManualPlaces((prev) => {
          if (
            remoteManualPlaces.length === 0
            && Array.isArray(prev)
            && prev.length > 0
            && !hasRemoteManualPlacesMigration()
          ) {
            return prev;
          }

          return remoteManualPlaces;
        });

        markRemoteManualPlacesMigrated();
      } catch {
        // ignore when backend is not running
      } finally {
        if (!cancelled) setIsRemoteReady(true);
      }
    };

    hydrateRemoteManualPlaces();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    saveManualPlaces(manualPlaces);
  }, [manualPlaces]);

  useEffect(() => {
    if (!isRemoteReady) return;

    fetch(REMOTE_MANUAL_PLACES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manualPlaces),
    })
      .then((response) => {
        if (!response.ok) return;
        markRemoteManualPlacesMigrated();
      })
      .catch(() => {});
  }, [manualPlaces, isRemoteReady]);

  return useMemo(
    () => ({
      manualPlaces,
      add(place) {
        setManualPlaces((prev) => [place, ...prev]);
      },
      update(id, patch) {
        setManualPlaces((prev) => prev.map((place) => (place.id === id ? { ...place, ...patch } : place)));
      },
      remove(id) {
        setManualPlaces((prev) => prev.filter((place) => place.id !== id));
      },
      setAll(places) {
        setManualPlaces(Array.isArray(places) ? places : []);
      },
    }),
    [manualPlaces]
  );
}
