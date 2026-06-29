// lib/redis.js — shared Redis helpers for the serverless functions.
// Connects via a standard connection string (REDIS_URL / KV_URL / REDIS_TLS_URL),
// so it works with any Redis provider on the Vercel Marketplace.

const { createClient } = require("redis");

const KEY = "timeoff";              // the live hash: field = entry id, value = JSON
const SNAP_KEY = "timeoff:snapshots"; // hash of snapshots: field = YYYY-MM-DD, value = JSON

function redisUrl() {
  return (
    process.env.REDIS_URL ||
    process.env.KV_URL ||
    process.env.REDIS_TLS_URL ||
    process.env.REDIS_URI ||
    null
  );
}

// Reuse the connection across warm invocations rather than reconnecting per call.
let clientPromise = null;
function getClient() {
  const url = redisUrl();
  if (!url) return Promise.reject(new Error("NO_REDIS_URL"));
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

// Read the live entries as an array of objects.
async function readEntries(client) {
  const obj = (await client.hGetAll(KEY)) || {};
  const out = [];
  for (const v of Object.values(obj)) {
    try { out.push(JSON.parse(v)); } catch (_) {}
  }
  return out;
}

module.exports = { getClient, redisUrl, readEntries, KEY, SNAP_KEY };
