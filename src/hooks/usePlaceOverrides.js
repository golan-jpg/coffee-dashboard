import { useEffect, useMemo, useState } from "react";
import { isRemoteBackupEnabled } from "../utils/remoteBackupConfig";

const PLACE_OVERRIDES_STORAGE_KEY = "cuproam_place_overrides_v1";
const REMOTE_PLACE_OVERRIDES_URL = "/api/backup-place-overrides";
const REMOTE_PLACE_OVERRIDES_MIGRATED_KEY = "cuproam_place_overrides_remote_migrated_v1";

function loadStoredPlaceOverrides() {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(PLACE_OVERRIDES_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveStoredPlaceOverrides(placeOverrides) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PLACE_OVERRIDES_STORAGE_KEY, JSON.stringify(placeOverrides || {}));
}

function hasRemotePlaceOverridesMigration() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(REMOTE_PLACE_OVERRIDES_MIGRATED_KEY) === "1";
}

function markRemotePlaceOverridesMigrated() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(REMOTE_PLACE_OVERRIDES_MIGRATED_KEY, "1");
}

export function usePlaceOverrides() {
  const [placeOverrides, setPlaceOverrides] = useState(() => loadStoredPlaceOverrides());
  const [isRemoteReady, setIsRemoteReady] = useState(() => !isRemoteBackupEnabled);

  useEffect(() => {
    if (!isRemoteBackupEnabled) {
      setIsRemoteReady(true);
      return;
    }

    let cancelled = false;

    const hydrateRemotePlaceOverrides = async () => {
      try {
        const response = await fetch(REMOTE_PLACE_OVERRIDES_URL);
        if (!response.ok) return;

        const payload = await response.json();
        const remotePlaceOverrides = payload?.placeOverrides && typeof payload.placeOverrides === "object" && !Array.isArray(payload.placeOverrides)
          ? payload.placeOverrides
          : {};

        if (cancelled) return;

        setPlaceOverrides((prev) => {
          if (
            Object.keys(remotePlaceOverrides).length === 0
            && prev
            && Object.keys(prev).length > 0
            && !hasRemotePlaceOverridesMigration()
          ) {
            return prev;
          }

          return remotePlaceOverrides;
        });

        markRemotePlaceOverridesMigrated();
      } catch {
        // ignore when backend is not running
      } finally {
        if (!cancelled) setIsRemoteReady(true);
      }
    };

    hydrateRemotePlaceOverrides();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    saveStoredPlaceOverrides(placeOverrides);
  }, [placeOverrides]);

  useEffect(() => {
    if (!isRemoteBackupEnabled) return;
    if (!isRemoteReady) return;

    fetch(REMOTE_PLACE_OVERRIDES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(placeOverrides || {}),
    })
      .then((response) => {
        if (!response.ok) return;
        markRemotePlaceOverridesMigrated();
      })
      .catch(() => {});
  }, [placeOverrides, isRemoteReady]);

  return useMemo(
    () => ({
      placeOverrides,
      upsert(id, patch) {
        const normalizedId = String(id || "").trim();
        if (!normalizedId || !patch || typeof patch !== "object" || Array.isArray(patch)) return;

        setPlaceOverrides((prev) => ({
          ...(prev || {}),
          [normalizedId]: {
            ...(prev?.[normalizedId] || {}),
            ...patch,
          },
        }));
      },
      remove(id) {
        const normalizedId = String(id || "").trim();
        if (!normalizedId) return;

        setPlaceOverrides((prev) => {
          if (!prev || !Object.prototype.hasOwnProperty.call(prev, normalizedId)) return prev;
          const next = { ...prev };
          delete next[normalizedId];
          return next;
        });
      },
      setAll(nextPlaceOverrides) {
        setPlaceOverrides(nextPlaceOverrides && typeof nextPlaceOverrides === "object" && !Array.isArray(nextPlaceOverrides) ? nextPlaceOverrides : {});
      },
    }),
    [placeOverrides]
  );
}