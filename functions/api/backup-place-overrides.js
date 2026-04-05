import { json, loadPlaceOverrides, savePlaceOverrides } from "../_lib/state.js";

export async function onRequest(context) {
  try {
    if (context.request.method === "GET") {
      const placeOverrides = await loadPlaceOverrides(context.env);
      return json({ ok: true, placeOverrides });
    }

    if (context.request.method === "POST") {
      const incoming = await context.request.json().catch(() => ({}));
      await savePlaceOverrides(context.env, incoming);
      return json({ ok: true, message: "Place overrides saved.", count: incoming && typeof incoming === "object" && !Array.isArray(incoming) ? Object.keys(incoming).length : 0 });
    }

    return json({ ok: false, error: "Method not allowed" }, 405);
  } catch (error) {
    return json({ ok: false, error: error?.message || "Failed handling place overrides backup" }, 500);
  }
}