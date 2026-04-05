import { json } from "../_lib/state.js";

export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url);
  const lat = Number(requestUrl.searchParams.get("lat"));
  const lon = Number(requestUrl.searchParams.get("lon"));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return json({ error: "Invalid lat/lon" }, 400);
  }

  try {
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=0`;
    const response = await fetch(nominatimUrl, {
      headers: {
        "Accept-Language": "en",
      },
    });

    if (!response.ok) {
      return json({ display_name: "" });
    }

    const payload = await response.json();
    return json(payload);
  } catch {
    return json({ display_name: "" });
  }
}
