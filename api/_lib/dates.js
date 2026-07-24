// Fixed backfill start — matches what's already loaded in the dashboard,
// even though some shows have Simplecast history going back further.
const FIXED_START = '2025-04-01';

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

function todayISO() {
  return toISODate(new Date());
}

function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return toISODate(d);
}

// Resolves a range key ('7d' | '30d' | '90d' | 'all') to a { start, end } pair.
function resolveRange(rangeKey) {
  const end = todayISO();
  if (rangeKey === 'all') return { start: FIXED_START, end };
  const days = { '7d': 7, '30d': 30, '90d': 90 }[rangeKey];
  if (!days) throw new Error(`Unknown range: ${rangeKey}`);
  const start = addDays(end, -(days - 1));
  return { start: start < FIXED_START ? FIXED_START : start, end };
}

module.exports = { FIXED_START, toISODate, todayISO, addDays, resolveRange };
