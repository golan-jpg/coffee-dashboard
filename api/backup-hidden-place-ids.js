import {
  isKvConfigured,
  loadHiddenPlaceIds,
  mergeAndSaveHiddenPlaceIds,
  saveHiddenPlaceIds,
} from "./_lib/state.js";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const hiddenPlaceIds = await loadHiddenPlaceIds();
      return res.status(200).json({ ok: true, hiddenPlaceIds, storage: isKvConfigured() ? "vercel-kv" : "none" });
    }

    if (req.method === "POST") {
      const incoming = Array.isArray(req.body) ? req.body : [];
      const incomingIsExplicitEmptyArray = Array.isArray(incoming) && incoming.length === 0;

      if (incomingIsExplicitEmptyArray) {
        await saveHiddenPlaceIds([]);
        return res.status(200).json({ ok: true, message: "Hidden place IDs saved.", count: 0, storage: isKvConfigured() ? "vercel-kv" : "none" });
      }

      const merged = await mergeAndSaveHiddenPlaceIds(incoming);
      return res.status(200).json({ ok: true, message: "Hidden place IDs saved.", count: merged.length, storage: isKvConfigured() ? "vercel-kv" : "none" });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed handling hidden place IDs backup" });
  }
}
