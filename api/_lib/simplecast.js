const { getJSON, setJSON } = require('./kv');

const BASE = 'https://api.simplecast.com';
const BREAKER_KEY = 'simplecast:blocked_until';
const BREAKER_COOLDOWN_MS = 30 * 60 * 1000; // 30 min pause after a quota error

function authHeader() {
  const token = process.env.SIMPLECAST_API_TOKEN;
  if (!token) {
    throw new Error('SIMPLECAST_API_TOKEN is not set in this deployment\'s environment variables.');
  }
  return { authorization: `Bearer ${token}` };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tripBreaker() {
  await setJSON(BREAKER_KEY, Date.now() + BREAKER_COOLDOWN_MS).catch(() => {});
}

async function checkBreaker() {
  const blockedUntil = await getJSON(BREAKER_KEY).catch(() => null);
  if (blockedUntil && Date.now() < blockedUntil) {
    const minsLeft = Math.ceil((blockedUntil - Date.now()) / 60000);
    throw new Error(`Simplecast quota cooldown active (~${minsLeft}m left) — skipping live fetch, using cache.`);
  }
}

async function scFetch(path, attempt = 0) {
  if (attempt === 0) await checkBreaker();

  const res = await fetch(`${BASE}${path}`, { headers: authHeader() });

  if (res.status === 429) {
    if (attempt < 2) {
      // A couple of quick retries absorb brief bursts; beyond that, this is
      // very likely a real quota ceiling rather than a transient blip —
      // trip the breaker instead of continuing to hammer it.
      const retryAfterHeader = Number(res.headers.get('retry-after'));
      const waitMs = retryAfterHeader > 0 ? retryAfterHeader * 1000 : 500 * 2 ** attempt;
      await sleep(waitMs);
      return scFetch(path, attempt + 1);
    }
    await tripBreaker();
    throw new Error('Simplecast API 429: quota exceeded — pausing live fetches for 30 minutes.');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Simplecast API ${res.status} for ${path}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Daily download series for a podcast over [startDate, endDate] (inclusive, YYYY-MM-DD).
async function getPodcastDownloads(podcastId, startDate, endDate) {
  const data = await scFetch(
    `/analytics/downloads?podcast=${podcastId}&start_date=${startDate}&end_date=${endDate}`
  );
  return data.by_interval.map((row) => ({ date: row.interval, downloads: row.downloads_total }));
}

// Download total for a single episode over [startDate, endDate].
async function getEpisodeDownloads(episodeId, startDate, endDate) {
  const data = await scFetch(
    `/analytics/downloads?episode=${episodeId}&start_date=${startDate}&end_date=${endDate}`
  );
  return data.total;
}

// Paginated list of episodes with lifetime totals + metadata, newest first.
async function listEpisodes(podcastId, { limit = 100, offset = 0 } = {}) {
  const safeLimit = Math.max(5, limit); // Simplecast rejects limit < 5
  const data = await scFetch(
    `/analytics/episodes?podcast=${podcastId}&limit=${safeLimit}&offset=${offset}`
  );
  return {
    count: data.count,
    hasMore: !!(data.pages && data.pages.next),
    episodes: data.collection.map((ep) => ({
      id: ep.id,
      title: ep.title,
      number: ep.number,
      publishedAt: ep.published_at,
      lifetimeDownloads: ep.downloads.total,
    })),
  };
}

// Fetches every episode published on/after `sinceISODate` for a podcast,
// paging until we hit episodes older than that date (episodes come back newest-first).
async function listEpisodesSince(podcastId, sinceISODate) {
  const results = [];
  let offset = 0;
  const limit = 100;
  for (let page = 0; page < 50; page++) {
    const { episodes, hasMore } = await listEpisodes(podcastId, { limit, offset });
    if (episodes.length === 0) break;
    for (const ep of episodes) {
      if (ep.publishedAt.slice(0, 10) < sinceISODate) return results;
      results.push(ep);
    }
    if (!hasMore) break;
    offset += limit;
  }
  return results;
}

module.exports = { getPodcastDownloads, getEpisodeDownloads, listEpisodes, listEpisodesSince };
