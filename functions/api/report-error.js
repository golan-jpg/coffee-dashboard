import { json } from "../_lib/state.js";

export async function onRequestPost(context) {
  try {
    const payload = await context.request.json().catch(() => ({}));
    const key = `runtime-error:${Date.now()}:${crypto.randomUUID()}`;

    if (context.env?.CUPROAM_STATE) {
      await context.env.CUPROAM_STATE.put(
        key,
        JSON.stringify({
          ts: new Date().toISOString(),
          ...payload,
        })
      );
    }

    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: error?.message || "Failed to report error" }, 500);
  }
}
