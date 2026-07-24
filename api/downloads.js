const shows = require('./_lib/shows');
const { getPodcastDownloads } = require('./_lib/simplecast');
const { getJSON, setJSON } = require('./_lib/kv');
const { FIXED_START, todayISO, addDays, resolveRange } = require('./_lib/dates');

const REFRESH_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours — re-check Simplecast for new/corrected days

// Loads (and if stale, refreshes) the cached daily download series for one show.
// If Simplecast is unavailable (quota/rate limit, outage), falls back to
// whatever's cached — even if stale — rather than failing the whole dashboard.
async function loadSeries(showId) {
  const cacheKey = `series:${showId}`;
  const cached = await getJSON(cacheKey);
  const today = todayISO();

  if (!cached) {
    try {
      const rows = await getPodcastDownloads(showId, FIXED_START, today);
      const days = {};
      for (const r of rows) days[r.date] = r.downloads;
      const fresh = { updatedAt: Date.now(), lastDate: today, days, stale: false };
      await setJSON(cacheKey, fresh);
      return fresh;
    } catch (err) {
      console.error(`loadSeries initial backfill failed for ${showId}:`, err.message);
      return { updatedAt: 0, lastDate: null, days: {}, stale: true, unavailable: true };
    }
  }

  const isStale = Date.now() - cached.updatedAt > REFRESH_TTL_MS;
  if (isStale) {
    try {
      const refetchFrom = cached.lastDate < today ? addDays(cached.lastDate, -1) : addDays(today, -1);
      const rows = await getPodcastDownloads(showId, refetchFrom < FIXED_START ? FIXED_START : refetchFrom, today);
      for (const r of rows) cached.days[r.date] = r.downloads;
      cached.lastDate = today;
      cached.updatedAt = Date.now();
      cached.stale = false;
      await setJSON(cacheKey, cached);
    } catch (err) {
      // Simplecast unreachable/quota-exceeded — serve last-known-good data,
      // flagged as stale, instead of failing the request.
      console.error(`loadSeries refresh failed for ${showId}:`, err.message);
      cached.stale = true;
    }
  }

  return cached;
}

function sliceRange(days, start, end) {
  const out = [];
  let d = start;
  while (d <= end) {
    out.push({ date: d, downloads: days[d] || 0 });
    d = addDays(d, 1);
  }
  return out;
}

module.exports = async (req, res) => {
  try {
    const rangeKey = req.query.range || '30d';
    const { start, end } = resolveRange(rangeKey);

    const perShow = await Promise.all(
      shows.map(async (show) => {
        const series = await loadSeries(show.id);
        const slice = sliceRange(series.days, start, end);
        const total = slice.reduce((sum, r) => sum + r.downloads, 0);
        return {
          id: show.id,
          name: show.name,
          short: show.short,
          total,
          series: slice,
          stale: !!series.stale,
          unavailable: !!series.unavailable,
        };
      })
    );

    const dateList = perShow[0].series.map((r) => r.date);
    const aggregateSeries = dateList.map((date) => ({
      date,
      downloads: perShow.reduce((sum, s) => sum + (s.series.find((r) => r.date === date)?.downloads || 0), 0),
    }));
    const grandTotal = perShow.reduce((sum, s) => sum + s.total, 0);
    const anyStale = perShow.some((s) => s.stale || s.unavailable);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({
      range: rangeKey,
      start,
      end,
      grandTotal,
      aggregateSeries,
      shows: perShow.sort((a, b) => b.total - a.total),
      dataStale: anyStale,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
