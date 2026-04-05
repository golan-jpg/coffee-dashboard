import { useMapEvents } from "react-leaflet";

export function MapClickHandler({ enabled, onPick }) {
  useMapEvents({
    click(e) {
      if (!enabled) return;
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });

  return null;
}