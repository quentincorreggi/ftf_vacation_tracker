# FTF Time Off — team holiday tracker (Vercel-hosted)

A single-page app embedded in Notion. Everything lives on Vercel: the page,
a small serverless function, and a Vercel-managed Redis store for the data.
No Notion integration or admin rights required.

```
ftf_vacation_tracker/
├─ index.html        the app (served at / )
├─ api/timeoff.js    serverless API: list / add / remove  (served at /api/timeoff )
├─ vercel.json       Vercel config (clean URLs, no-store on /api)
└─ README.md
```

Data flow: browser → /api/timeoff → Redis. The browser never holds any
credentials; the function reads them from environment variables that Vercel
injects when you add the storage integration.

---

## Deploy (≈10 min)

### 1. Push the project to Vercel
From inside this folder:

```bash
npm i -g vercel        # if you don't have the CLI
vercel                 # links/creates the project and does a first deploy
```
Accept the defaults — Vercel auto-detects the static page plus the /api function.

### 2. Add a Redis store
In the Vercel dashboard: open the project → **Storage** tab → **Create / Connect
Database** → choose **Redis (Upstash)** → pick the **free** plan → connect it to
this project. Vercel injects the credentials automatically (you don't copy
anything by hand).

> CLI alternative: `vercel install upstash` from the project folder.

The function connects using a standard Redis connection string, reading
`REDIS_URL` (or `KV_URL` / `REDIS_TLS_URL` / `REDIS_URI`). Every Redis store on
the Vercel Marketplace — Upstash, Redis Cloud, Vercel's own Redis — injects one
of these, so no manual setup is needed beyond connecting the store and
redeploying. If storage is still not detected, open `/api/timeoff` directly —
the error response lists the Redis-related env var names it can see, which makes
mismatches obvious.

> Note: the project now has one dependency (`redis`). Vercel installs it
> automatically from `package.json` during the build — nothing to do by hand.

### 3. Redeploy so the function sees the new credentials
```bash
vercel --prod
```

### 4. Verify
Open the production URL. The footer should read **"Synced — live for the team."**
Add an entry, then refresh the page: it should still be there (that confirms
the data persisted to Redis, not just the browser).

### 5. Embed in Notion
On your Notion page, type `/embed`, paste the Vercel URL, and resize the block.
The same app supports two embeds via URL parameters:

**Booking page** — full app (add + see everyone). Open in Team view:
```
https://YOUR-APP.vercel.app/?view=team
```

**Roadmap page** — read-only timeline only (no add form, list, or toggles),
aligned to a roadmap window:
```
https://YOUR-APP.vercel.app/?embed=timeline&months=3&start=2026-07-01
```

---

## Customizing

- **Team roster** (the "Who" dropdown): edit the `TEAM` array near the top of the
  `<script>` in `index.html`, then redeploy.
- **View on load:** add `?view=team` to the embed URL to open in Team view.
- **Roadmap embed:** add `?embed=timeline` for a read-only timeline (hides the
  add form, list, banner, and Person/Team toggle).
- **Access:** as built, anyone with the URL can read/write. For an internal tool
  behind a shared Notion page that's usually fine. To lock it down, set
  `ALLOWED_ORIGIN` to your Vercel URL, or enable Vercel's password protection
  (Project → Settings → Deployment Protection).

## Notes

- "Remove" deletes the entry from Redis. There's no trash/undo, unlike the
  earlier Notion design — removed entries are gone.
- The app polls every 30s to pick up teammates' changes, and refreshes
  immediately after you add or remove something.
