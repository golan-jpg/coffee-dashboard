import { useEffect, useMemo, useState } from "react";
import { loadManualPlaces, saveManualPlaces } from "../utils/manualPlacesStore";

export function useManualPlaces() {
  const [manualPlaces, setManualPlaces] = useState(() => loadManualPlaces());

  useEffect(() => {
    saveManualPlaces(manualPlaces);
  }, [manualPlaces]);

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
