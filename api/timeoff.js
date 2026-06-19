// api/timeoff.js — Vercel serverless function
// Stores team time-off in Redis, connecting via a standard connection string
// (REDIS_URL / KV_URL / REDIS_TLS_URL). Works with any Redis store added through
// the Vercel Marketplace — Upstash, Redis Cloud, Vercel's own Redis, etc.
//
// SETUP: connect a Redis store to the project in the Vercel dashboard, then
// redeploy (vercel --prod) so the function picks up the injected connection
// string. Optional: ALLOWED_ORIGIN to restrict which site may call this API.

const { createClient } = require("redis");

const KEY = "timeoff";
// Single time-off category — all entries are stored with this type.
const OFF_TYPE = "timeoff";

// Reuse the connection across warm invocations rather than reconnecting per call.
let clientPromise = null;
function getClient(url) {
  if (!clientPromise) {
    const client = createClient({ url });
    client.on("error", () => {}); // swallow transient errors so they don't crash the function
    clientPromise = client
      .connect()
      .then(() => client)
      .catch((e) => { clientPromise = null; throw e; }); // allow a retry next request
  }
  return clientPromise;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const url =
    process.env.REDIS_URL ||
    process.env.KV_URL ||
    process.env.REDIS_TLS_URL ||
    process.env.REDIS_URI;
  if (!url) {
    // Report which Redis-ish env keys ARE present (names only, never values).
    const seen = Object.keys(process.env).filter(k => /REDIS|UPSTASH|KV_/i.test(k)).sort();
    res.status(500).json({
      error: "Storage not configured: connect a Redis integration in Vercel and REDEPLOY (vercel --prod) so the function picks up the connection string.",
      redisEnvKeysFound: seen
    });
    return;
  }

  try {
    const client = await getClient(url);

    // ---- LIST ----
    if (req.method === "GET") {
      const obj = (await client.hGetAll(KEY)) || {}; // { field: jsonString, ... }
      const out = [];
      for (const v of Object.values(obj)) {
        try { out.push(JSON.parse(v)); } catch (_) {}
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
