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

The function looks for either `KV_REST_API_URL` + `KV_REST_API_TOKEN` or
`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`. The Upstash integration
provides one of these pairs. If yours uses different names, add aliases under
Settings → Environment Variables.

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
To line it up with your roadmap timeline, append the window, e.g.:

```
https://YOUR-APP.vercel.app/?months=3&start=2026-07-01
```

---

## Customizing

- **Team roster** (the "Who" dropdown): edit the `TEAM` array near the top of the
  `<script>` in `index.html`, then redeploy.
- **View on load:** add `?view=team` to the embed URL to open in Team view.
- **Access:** as built, anyone with the URL can read/write. For an internal tool
  behind a shared Notion page that's usually fine. To lock it down, set
  `ALLOWED_ORIGIN` to your Vercel URL, or enable Vercel's password protection
  (Project → Settings → Deployment Protection).

## Notes

- "Remove" deletes the entry from Redis. There's no trash/undo, unlike the
  earlier Notion design — removed entries are gone.
- The app polls every 30s to pick up teammates' changes, and refreshes
  immediately after you add or remove something.
