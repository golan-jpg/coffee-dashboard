export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: "Invalid lat/lon" });
  }

  try {
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=0`;
    const response = await fetch(nominatimUrl, {
      headers: {
        "Accept-Language": "en",
        "User-Agent": "cuproam/1.0 (vercel-production)",
      },
    });

    if (!response.ok) {
      return res.status(200).json({ display_name: "" });
    }

    const payload = await response.json();
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(200).json({ display_name: "" });
  }
}