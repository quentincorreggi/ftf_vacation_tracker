// api/timeoff.js — Vercel serverless function (CommonJS, zero dependencies)
// Stores team time-off in Vercel-managed Redis (Upstash, via the Vercel Marketplace).
//
// SETUP: in the Vercel dashboard, open your project > Storage > add a Redis
// (Upstash) integration on the free plan, and connect it to this project.
// Vercel injects the credentials automatically. This function reads whichever
// pair the integration provides:
//     KV_REST_API_URL        + KV_REST_API_TOKEN          (Vercel KV-compatible), or
//     UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
// Optional: ALLOWED_ORIGIN to restrict which site may call this API.

const KEY = "timeoff";
const VALID_TYPES = ["vacation", "rtt", "remote", "sick"];

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const RURL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const RTOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!RURL || !RTOKEN) {
    res.status(500).json({ error: "Storage not configured: add a Redis integration in Vercel and redeploy." });
    return;
  }

  // minimal Upstash REST client (command as a JSON array)
  const redis = async (cmd) => {
    const r = await fetch(RURL, {
      method: "POST",
      headers: { Authorization: "Bearer " + RTOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(cmd)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) throw new Error(data.error || ("Redis HTTP " + r.status));
    return data.result;
  };

  try {
    // ---- LIST ----
    if (req.method === "GET") {
      const flat = (await redis(["HGETALL", KEY])) || []; // [field, value, field, value, ...]
      const out = [];
      for (let i = 0; i < flat.length; i += 2) {
        try { out.push(JSON.parse(flat[i + 1])); } catch (_) {}
      }
      res.status(200).json(out);
      return;
    }

    // ---- ADD ----
    if (req.method === "POST") {
      const b = readBody(req);
      if (!b.name || !b.start) { res.status(400).json({ error: "name and start are required" }); return; }
      const entry = {
        id: b.id || ("e" + Date.now() + Math.random().toString(16).slice(2)),
        name: String(b.name).slice(0, 200),
        start: b.start,
        end: (b.end && b.end >= b.start) ? b.end : b.start,
        type: VALID_TYPES.includes(b.type) ? b.type : "vacation",
        note: b.note ? String(b.note).slice(0, 500) : ""
      };
      await redis(["HSET", KEY, entry.id, JSON.stringify(entry)]);
      res.status(200).json(entry);
      return;
    }

    // ---- REMOVE ----
    if (req.method === "DELETE") {
      const id = (req.query && req.query.id) || readBody(req).id;
      if (!id) { res.status(400).json({ error: "id required" }); return; }
      await redis(["HDEL", KEY, id]);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch (_) { return {}; } }
  return req.body;
}
