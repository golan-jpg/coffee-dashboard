import { isKvConfigured, loadRatings, mergeAndSaveRatings } from "./_lib/state.js";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const ratings = await loadRatings();
      return res.status(200).json({ ok: true, ratings, storage: isKvConfigured() ? "vercel-kv" : "none" });
    }

    if (req.method === "POST") {
      const incoming = req.body && typeof req.body === "object" ? req.body : {};
      const merged = await mergeAndSaveRatings(incoming);
      return res.status(200).json({ ok: true, message: "Ratings saved.", count: Object.keys(merged).length, storage: isKvConfigured() ? "vercel-kv" : "none" });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed handling ratings backup" });
  }
}
