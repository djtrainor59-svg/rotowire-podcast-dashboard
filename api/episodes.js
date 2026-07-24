const shows = require('./_lib/shows');
const { listEpisodesSince, getEpisodeDownloads } = require('./_lib/simplecast');
const { getJSON, setJSON } = require('./_lib/kv');
const { FIXED_START, todayISO, resolveRange } = require('./_lib/dates');
const { mapWithConcurrency } = require('./_lib/concurrency');

const EPLIST_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours — episode metadata changes rarely
const EPDL_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours — per-episode range download counts

const LOOKBACK_MONTHS = 6;

function sixMonthsAgoISO() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - LOOKBACK_MONTHS);
  const iso = d.toISOString().slice(0, 10);
  return iso < FIXED_START ? FIXED_START : iso;
}

// Episodes published in the last 6 months, per show, cached with metadata + lifetime totals.
// We don't bother going further back — a 2-year-old episode's contribution to a
// "last 7/30/90 days" leaderboard is negligible, and this keeps costs bounded.
async function loadEpisodeList(showId, sinceISO) {
  const cacheKey = `eplist:${showId}`;
  const cached = await getJSON(cacheKey);
  if (cached && Date.now() - cached.updatedAt < EPLIST_TTL_MS) return cached.episodes;

  try {
    const episodes = await listEpisodesSince(showId, sinceISO);
    await setJSON(cacheKey, { updatedAt: Date.now(), episodes });
    return episodes;
  } catch (err) {
    console.error(`loadEpisodeList failed for ${showId}:`, err.message);
    return cached ? cached.episodes : []; // stale-but-present beats nothing; nothing beats crashing
  }
}

async function downloadsInRange(episodeId, start, end, rangeKey, fallback) {
  const cacheKey = `epdl:${episodeId}:${rangeKey}`;
  const cached = await getJSON(cacheKey);
  if (cached && Date.now() - cached.updatedAt < EPDL_TTL_MS) return cached.value;

  try {
    const value = await getEpisodeDownloads(episodeId, start, end);
    await setJSON(cacheKey, { updatedAt: Date.now(), value });
    return value;
  } catch (err) {
    console.error(`downloadsInRange failed for episode ${episodeId}:`, err.message);
    return cached ? cached.value : fallback; // stale cache, else a rough fallback (lifetime total)
  }
}

module.exports = async (req, res) => {
  try {
    const rangeKey = req.query.range || '30d';
    const limit = Math.min(parseInt(req.query.limit || '25', 10), 100);
    const { start, end } = resolveRange(rangeKey);
    const sinceISO = sixMonthsAgoISO();

    const perShowEpisodes = await Promise.all(
      shows.map(async (show) => {
        const episodes = await loadEpisodeList(show.id, sinceISO);
        return episodes.map((ep) => ({ ...ep, showId: show.id, showName: show.name }));
      })
    );
    const candidates = perShowEpisodes.flat();

    const withRangeDownloads = await mapWithConcurrency(candidates, 5, async (ep) => {
      const downloads =
        rangeKey === 'all'
          ? ep.lifetimeDownloads
          : await downloadsInRange(ep.id, start, end, rangeKey, ep.lifetimeDownloads);
      return {
        id: ep.id,
        title: ep.title,
        number: ep.number,
        showName: ep.showName,
        publishedAt: ep.publishedAt,
        downloads,
      };
    });

    withRangeDownloads.sort((a, b) => b.downloads - a.downloads);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({
      range: rangeKey,
      start,
      end,
      lookbackSince: sinceISO,
      episodes: withRangeDownloads.slice(0, limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
