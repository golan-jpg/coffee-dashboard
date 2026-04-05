import { json, loadManualPlaces, saveManualPlaces } from "../_lib/state.js";

export async function onRequest(context) {
  try {
    if (context.request.method === "GET") {
      const manualPlaces = await loadManualPlaces(context.env);
      return json({ ok: true, manualPlaces });
    }

    if (context.request.method === "POST") {
      const incoming = await context.request.json().catch(() => []);
      await saveManualPlaces(context.env, incoming);
      return json({ ok: true, message: "Manual places saved.", count: Array.isArray(incoming) ? incoming.length : 0 });
    }

    return json({ ok: false, error: "Method not allowed" }, 405);
  } catch (error) {
    return json({ ok: false, error: error?.message || "Failed handling manual places backup" }, 500);
  }
}