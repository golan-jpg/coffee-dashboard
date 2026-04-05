import { isKvConfigured, loadManualPlaces, saveManualPlaces } from "./_lib/state.js";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const manualPlaces = await loadManualPlaces();
      return res.status(200).json({ ok: true, manualPlaces, storage: isKvConfigured() ? "vercel-kv" : "none" });
    }

    if (req.method === "POST") {
      const incoming = Array.isArray(req.body) ? req.body : [];
      await saveManualPlaces(incoming);
      return res.status(200).json({ ok: true, message: "Manual places saved.", count: incoming.length, storage: isKvConfigured() ? "vercel-kv" : "none" });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed handling manual places backup" });
  }
}