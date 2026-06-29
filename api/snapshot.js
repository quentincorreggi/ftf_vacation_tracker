// api/snapshot.js — daily backups of the team time-off data.
//
// Actions (all require auth — see authorized() below):
//   GET  /api/snapshot                         -> create today's snapshot (the daily cron hits this)
//   GET  /api/snapshot?action=list             -> list available snapshot dates
//   GET  /api/snapshot?action=get&date=YYYY-MM-DD   -> return one snapshot's entries
//   POST /api/snapshot?action=restore&date=YYYY-MM-DD -> replace live data with that snapshot
//
// AUTH: set SNAPSHOT_SECRET (and/or CRON_SECRET) in the Vercel environment.
// Vercel Cron automatically sends `Authorization: Bearer <CRON_SECRET>`. For
// manual calls from a browser, append `?key=<secret>`.
//
// NOTE: snapshots are stored in the same Redis as the live data, so they guard
// against accidental edits/deletes and let you roll back — but they would not
// survive a full database wipe. For that, also enable your provider's backups.

const { getClient, redisUrl, readEntries, KEY, SNAP_KEY } = require("../lib/redis");

const RETENTION_DAYS = 60;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function authorized(req) {
  const secrets = [process.env.SNAPSHOT_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (!secrets.length) return false; // fail closed until a secret is configured
  const hdr = String(req.headers["authorization"] || "");
  const bearer = hdr.replace(/^Bearer\s+/i, "").trim();
  const key = (req.query && req.query.key) || "";
  return secrets.includes(bearer) || secrets.includes(key);
}

function today() { return new Date().toISOString().slice(0, 10); }
function cutoffDate(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  if (!redisUrl()) {
    res.status(500).json({ error: "Storage not configured: connect a Redis integration in Vercel and redeploy." });
    return;
  }
  if (!authorized(req)) {
    res.status(401).json({ error: "Unauthorized. Set SNAPSHOT_SECRET (or CRON_SECRET) in Vercel, then pass it as ?key=<secret> or an Authorization: Bearer header." });
    return;
  }

  const action = (req.query && req.query.action) || (req.method === "GET" ? "create" : "");

  try {
    const client = await getClient();

    // ---- CREATE (daily cron) ----
    if (req.method === "GET" && action === "create") {
      const entries = await readEntries(client);
      const date = today();
      await client.hSet(SNAP_KEY, date, JSON.stringify({
        date, savedAt: new Date().toISOString(), count: entries.length, entries
      }));
      // prune snapshots older than the retention window
      const keys = (await client.hKeys(SNAP_KEY)) || [];
      const min = cutoffDate(RETENTION_DAYS);
      const stale = keys.filter(k => DATE_RE.test(k) && k < min);
      if (stale.length) await client.hDel(SNAP_KEY, stale);
      res.status(200).json({ ok: true, date, count: entries.length, pruned: stale.length, retentionDays: RETENTION_DAYS });
      return;
    }

    // ---- LIST ----
    if (action === "list") {
      const keys = (await client.hKeys(SNAP_KEY)) || [];
      const snapshots = keys.filter(k => DATE_RE.test(k)).sort();
      res.status(200).json({ snapshots, retentionDays: RETENTION_DAYS });
      return;
    }

    // ---- GET ONE ----
    if (action === "get") {
      const date = (req.query && req.query.date) || "";
      if (!DATE_RE.test(date)) { res.status(400).json({ error: "date required (YYYY-MM-DD)" }); return; }
      const raw = await client.hGet(SNAP_KEY, date);
      if (!raw) { res.status(404).json({ error: "No snapshot for " + date }); return; }
      res.status(200).json(JSON.parse(raw));
      return;
    }

    // ---- RESTORE ----
    if (req.method === "POST" && action === "restore") {
      const date = (req.query && req.query.date) || readBody(req).date || "";
      if (!DATE_RE.test(date)) { res.status(400).json({ error: "date required (YYYY-MM-DD)" }); return; }
      const raw = await client.hGet(SNAP_KEY, date);
      if (!raw) { res.status(404).json({ error: "No snapshot for " + date }); return; }
      const snap = JSON.parse(raw);
      const entries = Array.isArray(snap.entries) ? snap.entries : [];

      // Safety net: back up the CURRENT state before overwriting, so a mistaken
      // restore is itself reversible (kept under a single _prerestore slot).
      const current = await readEntries(client);
      await client.hSet(SNAP_KEY, "_prerestore", JSON.stringify({
        replacedAt: new Date().toISOString(), restoredFrom: date, count: current.length, entries: current
      }));

      // Replace the live data with the snapshot's entries.
      await client.del(KEY);
      const map = {};
      for (const e of entries) { if (e && e.id) map[e.id] = JSON.stringify(e); }
      if (Object.keys(map).length) await client.hSet(KEY, map);

      res.status(200).json({ ok: true, restored: date, count: entries.length, previousCount: current.length });
      return;
    }

    res.status(400).json({ error: "Unknown action. Use GET (create), ?action=list, ?action=get&date=, or POST ?action=restore&date=." });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch (_) { return {}; } }
  return req.body;
}
