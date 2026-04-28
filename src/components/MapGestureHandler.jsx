import { useEffect } from "react";
import { useMap } from "react-leaflet";
import "leaflet-gesture-handling";

export default function MapGestureHandler() {
  const map = useMap();

  useEffect(() => {
    map.gestureHandling?.enable?.();
    map.doubleClickZoom?.disable?.();
    map.tap?.disable?.();

    return () => {
      try {
        map.gestureHandling?.disable?.();
      } catch {
        // no-op: map may already be disposed
      }
    };
  }, [map]);

  return null;
}
