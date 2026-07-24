const { getJSON, setJSON } = require('./_lib/kv');
const { FIXED_START } = require('./_lib/dates');

function monthKey(yyyyMm) {
  return `revenue:${yyyyMm}`;
}

// All calendar months from FIXED_START's month through the current month.
function monthList() {
  const months = [];
  const start = new Date(FIXED_START + 'T00:00:00Z');
  const now = new Date();
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  while (cursor <= end) {
    months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const months = monthList();
      const entries = await Promise.all(
        months.map(async (m) => {
          const data = await getJSON(monthKey(m));
          return {
            month: m,
            shannon: data?.shannon ?? 0,
            bluewireAmount: data?.bluewire?.amount ?? 0,
            bluewireStatus: data?.bluewire?.status ?? 'Estimated',
          };
        })
      );

      const totals = entries.reduce(
        (acc, e) => {
          acc.direct += e.shannon;
          acc.blended += e.bluewireAmount;
          return acc;
        },
        { direct: 0, blended: 0 }
      );

      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json({ entries, placementTotals: totals });
    }

    if (req.method === 'POST') {
      const { month, shannon, bluewireAmount, bluewireStatus } = req.body || {};
      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: 'month must be in YYYY-MM format' });
      }
      if (bluewireStatus && !['Estimated', 'Finalized'].includes(bluewireStatus)) {
        return res.status(400).json({ error: 'bluewireStatus must be Estimated or Finalized' });
      }
      await setJSON(monthKey(month), {
        shannon: Number(shannon) || 0,
        bluewire: { amount: Number(bluewireAmount) || 0, status: bluewireStatus || 'Estimated' },
      });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
