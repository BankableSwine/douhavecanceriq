// functions/api/score.js
// Cloudflare Pages Function — handles POST /api/score
//
// Binds to a D1 database named "DB" (configured in the Pages dashboard
// under Settings → Functions → D1 database bindings, variable name DB).
//
// Request:  POST { "iq": 123 }
// Response: { "percentile": 87, "total": 1543 }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// Preflight
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "D1 binding 'DB' not configured" }, 500);

  let iq;
  try {
    const data = await request.json();
    iq = Math.round(Number(data.iq));
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  // sanity bounds — reject anything outside the test's possible range
  if (!Number.isFinite(iq) || iq < 40 || iq > 160) {
    return json({ error: "iq out of range" }, 400);
  }

  try {
    // Record this attempt.
    await env.DB.prepare("INSERT INTO results (iq) VALUES (?1)").bind(iq).run();

    // Percentile = (scores strictly below + half of ties) / total.
    // Using the mid-rank convention so identical scores aren't double-counted.
    const row = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM results WHERE iq < ?1) AS below,
         (SELECT COUNT(*) FROM results WHERE iq = ?1) AS eq,
         (SELECT COUNT(*) FROM results)               AS total`
    ).bind(iq).first();

    const total = row.total || 1;
    let pct = Math.round(((row.below + row.eq / 2) / total) * 100);
    pct = Math.max(1, Math.min(99, pct));

    return json({ percentile: pct, total });
  } catch (e) {
    return json({ error: "db error", detail: String(e) }, 500);
  }
}
