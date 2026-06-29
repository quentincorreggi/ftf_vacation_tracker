// api/timeoff.js — Vercel serverless function (list / add / remove team time-off).
// Stores entries in Redis, connecting via a standard connection string. See
// lib/redis.js for the connection details. Optional: ALLOWED_ORIGIN to restrict
// which site may call this API.

const { getClient, redisUrl, readEntries, KEY } = require("../lib/redis");

const OFF_TYPE = "timeoff"; // single time-off category

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  if (!redisUrl()) {
    // Report which Redis-ish env keys ARE present (names only, never values).
    const seen = Object.keys(process.env).filter(k => /REDIS|UPSTASH|KV_/i.test(k)).sort();
    res.status(500).json({
      error: "Storage not configured: connect a Redis integration in Vercel and REDEPLOY (vercel --prod) so the function picks up the connection string.",
      redisEnvKeysFound: seen
    });
    return;
  }

  try {
    const client = await getClient();

    // ---- LIST ----
    if (req.method === "GET") {
      res.status(200).json(await readEntries(client));
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
        type: OFF_TYPE,
        note: b.note ? String(b.note).slice(0, 500) : ""
      };
      await client.hSet(KEY, entry.id, JSON.stringify(entry));
      res.status(200).json(entry);
      return;
    }

    // ---- REMOVE ----
    if (req.method === "DELETE") {
      const id = (req.query && req.query.id) || readBody(req).id;
      if (!id) { res.status(400).json({ error: "id required" }); return; }
      await client.hDel(KEY, id);
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
