# RotoWire Podcast Network Dashboard

Downloads (live from Simplecast) + ad revenue (manually entered) for the 8 network shows.

## Deploy to Vercel

1. **Push this folder to a GitHub repo** (or drag-and-drop deploy via the Vercel dashboard —
   either works, GitHub makes future updates easier).

2. **Import the project in Vercel** (vercel.com → Add New → Project → select the repo).
   Framework preset: "Other". No build command needed.

3. **Add a KV store**: In the Vercel project → Storage tab → Create Database → KV.
   Connect it to this project. This automatically sets the `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` environment variables — you don't need to touch those.

4. **Add your Simplecast token**: Project → Settings → Environment Variables →
   add `SIMPLECAST_API_TOKEN` with the value from Simplecast's Private Apps page.
   Apply it to Production (and Preview, if you want preview deploys to work too).

5. **Redeploy** (Deployments tab → ⋯ → Redeploy) so the new env vars take effect.

That's it — open the deployed URL and the dashboard loads live.

## How it works

- `api/downloads.js` — pulls daily download counts per show from Simplecast,
  caches them in KV, and only re-fetches new/recent days on subsequent loads
  (see `REFRESH_TTL_MS`). Backfills from **April 1, 2025** the first time it runs.
- `api/episodes.js` — episode-level leaderboard. Only considers episodes published
  in the last 6 months (older episodes rarely move the needle on a 7/30/90-day view),
  and caches per-episode download counts for an hour at a time.
- `api/revenue.js` — ad revenue is manual (Shannon + BlueWire don't have an API),
  stored directly in KV via the form on the dashboard.
- `api/shows.js` — static registry of the 8 show IDs/names (edit `api/_lib/shows.js`
  if a show is added, renamed, or removed).

## Adding a 9th show later

Add an entry to `api/_lib/shows.js` with its Simplecast podcast ID (find it via
`GET https://api.simplecast.com/podcasts` with your token). No other changes needed —
downloads and episodes will start populating on the next load.

## Notes

- The Simplecast API token only ever lives server-side (Vercel env var) — it's
  never sent to the browser.
- If a dashboard load looks stale, hit the ↻ button; caches refresh hourly on
  their own regardless.
