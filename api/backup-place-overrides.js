import { isKvConfigured, loadPlaceOverrides, savePlaceOverrides } from "./_lib/state.js";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const placeOverrides = await loadPlaceOverrides();
      return res.status(200).json({ ok: true, placeOverrides, storage: isKvConfigured() ? "vercel-kv" : "none" });
    }

    if (req.method === "POST") {
      const incoming = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
      await savePlaceOverrides(incoming);
      return res.status(200).json({ ok: true, message: "Place overrides saved.", count: Object.keys(incoming).length, storage: isKvConfigured() ? "vercel-kv" : "none" });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed handling place overrides backup" });
  }
}