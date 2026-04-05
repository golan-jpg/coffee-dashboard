import { useMapEvents } from "react-leaflet";

export function MapClickHandler({
  enabled,
  onPick,
}: {
  enabled: boolean;
  onPick: (p: { lat: number; lng: number }) => void;
}) {
  useMapEvents({
    click(e) {
      if (!enabled) return;
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });

  return null;
}