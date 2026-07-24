const { getJSON, setJSON } = require('./_lib/kv');

const INDEX_KEY = 'revenue:index';

function monthKey(yyyyMm) {
  return `revenue:${yyyyMm}`;
}

async function loadIndex() {
  const idx = await getJSON(INDEX_KEY);
  return Array.isArray(idx) ? idx : [];
}

async function addToIndex(month) {
  const idx = await loadIndex();
  if (!idx.includes(month)) {
    idx.push(month);
    idx.sort();
    await setJSON(INDEX_KEY, idx);
  }
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const months = await loadIndex();
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
      await addToIndex(month);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};