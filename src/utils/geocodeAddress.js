// src/utils/geocodeAddress.js
// Utility to geocode an address using Nominatim (OpenStreetMap)
// Returns { lat, lon } or null if not found

export async function geocodeAddress(address) {
  if (!address || typeof address !== "string" || address.length < 5) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`;
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'coffee-dashboard/1.0 (your-email@example.com)'
      }
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      const { lat, lon } = data[0];
      return { lat: parseFloat(lat), lon: parseFloat(lon) };
    }
    return null;
  } catch {
    return null;
  }
}
