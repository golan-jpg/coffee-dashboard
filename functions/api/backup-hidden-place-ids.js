import { json, loadHiddenPlaceIds, mergeAndSaveHiddenPlaceIds, saveHiddenPlaceIds } from "../_lib/state.js";

export async function onRequest(context) {
  try {
    if (context.request.method === "GET") {
      const hiddenPlaceIds = await loadHiddenPlaceIds(context.env);
      return json({ ok: true, hiddenPlaceIds });
    }

    if (context.request.method === "POST") {
      const incoming = await context.request.json().catch(() => []);
      const incomingIsExplicitEmptyArray = Array.isArray(incoming) && incoming.length === 0;

      if (incomingIsExplicitEmptyArray) {
        await saveHiddenPlaceIds(context.env, []);
        return json({ ok: true, message: "Hidden place IDs saved.", count: 0 });
      }

      const merged = await mergeAndSaveHiddenPlaceIds(context.env, incoming);
      return json({ ok: true, message: "Hidden place IDs saved.", count: merged.length });
    }

    return json({ ok: false, error: "Method not allowed" }, 405);
  } catch (error) {
    return json({ ok: false, error: error?.message || "Failed handling hidden place IDs backup" }, 500);
  }
}
