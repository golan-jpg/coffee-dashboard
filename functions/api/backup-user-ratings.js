import { json, loadRatings, mergeAndSaveRatings } from "../_lib/state.js";

export async function onRequest(context) {
  try {
    if (context.request.method === "GET") {
      const ratings = await loadRatings(context.env);
      return json({ ok: true, ratings });
    }

    if (context.request.method === "POST") {
      const incoming = await context.request.json().catch(() => ({}));
      const merged = await mergeAndSaveRatings(context.env, incoming);
      return json({ ok: true, message: "Ratings saved.", count: Object.keys(merged).length });
    }

    return json({ ok: false, error: "Method not allowed" }, 405);
  } catch (error) {
    return json({ ok: false, error: error?.message || "Failed handling ratings backup" }, 500);
  }
}
