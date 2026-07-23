// Deletes form-check clips older than 30 days from the private `form-checks`
// bucket. Runs daily via pg_cron (see 20260722140100_form_checks_cron.sql).
//
// Layout is <athleteId>/<dayId>/<uid>.webm, so we walk two folder levels and
// remove any file whose created_at is past the retention window. Uses the
// Storage API (service role) so the backing blobs are actually freed, not just
// orphaned. The stale metadata entry in progress.form_checks is left to the app,
// which hides/prunes clips whose file no longer resolves.
//
// Callable only with the service-role JWT the cron sends (never from the app).

import { createClient } from "jsr:@supabase/supabase-js@2";

const RETENTION_DAYS = 30;
const BUCKET = "form-checks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Only the service role (cron) may run this — reject anon/coach/athlete JWTs.
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.includes(serviceKey)) return json({ error: "forbidden" }, 403);

    const sb = createClient(supabaseUrl, serviceKey);
    const store = sb.storage.from(BUCKET);
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

    const list = async (prefix: string) => {
      const { data, error } = await store.list(prefix, { limit: 1000 });
      if (error) { console.error("[prune] list", prefix, error.message); return []; }
      return data ?? [];
    };
    // A folder entry has a null id; a file entry has an id + created_at metadata.
    const isFolder = (e: { id: string | null }) => e.id === null;

    const stale: string[] = [];
    for (const athlete of await list("")) {
      if (!isFolder(athlete)) continue;
      for (const day of await list(athlete.name)) {
        if (!isFolder(day)) continue;
        const prefix = `${athlete.name}/${day.name}`;
        for (const file of await list(prefix)) {
          if (isFolder(file)) continue;
          const created = new Date(file.created_at ?? file.updated_at ?? 0).getTime();
          if (created && created < cutoff) stale.push(`${prefix}/${file.name}`);
        }
      }
    }

    let removed = 0;
    for (let i = 0; i < stale.length; i += 100) {
      const batch = stale.slice(i, i + 100);
      const { error } = await store.remove(batch);
      if (error) console.error("[prune] remove", error.message);
      else removed += batch.length;
    }

    return json({ ok: true, scanned: stale.length, removed });
  } catch (e) {
    console.error("[prune-form-checks] fatal:", e);
    return json({ ok: false, error: String(e) }, 500);
  }
});
