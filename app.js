const state = { range: '30d' };

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const fmtMoney = (n) => `$${Number(n || 0).toLocaleString('en-US')}`;

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed: ${url}`);
  return data;
}

// ---------- SVG line chart (no chart library — keeps this a static site) ----------
function renderLineChart(svgEl, series) {
  const w = 640, h = 160, pad = 6;
  const max = Math.max(1, ...series.map((d) => d.downloads));
  const stepX = (w - pad * 2) / Math.max(1, series.length - 1);
  const points = series.map((d, i) => {
    const x = pad + i * stepX;
    const y = h - pad - (d.downloads / max) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const linePath = `M${points.join(' L')}`;
  const areaPath = `${linePath} L${w - pad},${h - pad} L${pad},${h - pad} Z`;

  svgEl.innerHTML = `
    <defs>
      <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#e8433b" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#e8433b" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${areaPath}" fill="url(#areaFill)" stroke="none"/>
    <path d="${linePath}" fill="none" stroke="#e8433b" stroke-width="2"/>
  `;
}

// ---------- Ticker ----------
function renderTicker(shows) {
  const items = shows
    .map((s) => `<span class="ticker-item"><span class="code">${s.short}</span><span class="val">${fmt(s.total)}</span> downloads</span>`)
    .join('');
  document.getElementById('ticker').innerHTML = items + items; // duplicated for seamless scroll
}

// ---------- Show bars ----------
function renderShowBars(shows) {
  const max = Math.max(1, ...shows.map((s) => s.total));
  document.getElementById('show-bars').innerHTML = shows
    .map(
      (s) => `
      <div class="show-bar-row">
        <span class="show-bar-name">${s.name}</span>
        <div class="show-bar-track"><div class="show-bar-fill" style="width:${(s.total / max) * 100}%"></div></div>
        <span class="show-bar-value">${fmt(s.total)}</span>
      </div>`
    )
    .join('');
}

// ---------- Leaderboard ----------
function renderLeaderboard(episodes) {
  document.getElementById('leaderboard-body').innerHTML = episodes
    .map(
      (ep, i) => `
      <tr>
        <td class="rank-col">${i + 1}</td>
        <td>
          <div class="ep-title">${escapeHtml(ep.title)}</div>
          <div class="ep-show">${escapeHtml(ep.showName)}</div>
        </td>
        <td class="ep-show">${escapeHtml(ep.showName)}</td>
        <td>${new Date(ep.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
        <td class="num-col">${fmt(ep.downloads)}</td>
      </tr>`
    )
    .join('');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Revenue ----------
function renderRevenue(data) {
  const { entries, placementTotals } = data;
  const totalAll = placementTotals.direct + placementTotals.blended || 1;
  const directPct = (placementTotals.direct / totalAll) * 100;
  const blendedPct = (placementTotals.blended / totalAll) * 100;

  document.getElementById('placement-bar').innerHTML = `
    <div class="direct" style="width:${directPct}%"></div>
    <div class="blended" style="width:${blendedPct}%"></div>
  `;
  document.getElementById('placement-legend').innerHTML = `
    <span><span class="swatch" style="background:var(--red)"></span>Direct (Shannon) — ${fmtMoney(placementTotals.direct)}</span>
    <span><span class="swatch" style="background:var(--gold)"></span>Blended Rolls (BlueWire) — ${fmtMoney(placementTotals.blended)}</span>
  `;

  const recent = entries.slice(-6);
  const maxMonthly = Math.max(1, ...recent.map((e) => e.shannon + e.bluewireAmount));
  document.getElementById('revenue-trend').innerHTML = recent
    .map((e) => {
      const total = e.shannon + e.bluewireAmount || 1;
      const dH = (e.shannon / maxMonthly) * 90;
      const bH = (e.bluewireAmount / maxMonthly) * 90;
      const label = new Date(e.month + '-01').toLocaleDateString('en-US', { month: 'short' });
      const badge = e.bluewireAmount > 0
        ? `<span class="badge ${e.bluewireStatus.toLowerCase()}">${e.bluewireStatus}</span>`
        : '';
      return `
        <div class="bar-col" title="${label}: Shannon ${fmtMoney(e.shannon)} + BlueWire ${fmtMoney(e.bluewireAmount)} ${e.bluewireStatus}">
          <div class="stack" style="height:90px">
            <div class="blended" style="height:${bH}px"></div>
            <div class="direct" style="height:${dH}px"></div>
          </div>
          <span class="month-label">${label}${badge}</span>
        </div>`;
    })
    .join('');
}

// ---------- Orchestration ----------
async function loadAll() {
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');
  try {
    const [downloads, episodes, revenue] = await Promise.all([
      fetchJSON(`/api/downloads?range=${state.range}`),
      fetchJSON(`/api/episodes?range=${state.range}&limit=25`),
      fetchJSON('/api/revenue'),
    ]);

    document.getElementById('total-downloads').textContent = fmt(downloads.grandTotal);
    document.getElementById('total-range-label').textContent = `${downloads.start} → ${downloads.end}`;
    renderLineChart(document.getElementById('agg-chart'), downloads.aggregateSeries);
    renderTicker(downloads.shows);
    renderShowBars(downloads.shows);
    renderLeaderboard(episodes.episodes);
    renderRevenue(revenue);

    document.getElementById('last-refreshed').textContent = downloads.dataStale
      ? `Showing cached data (Simplecast unavailable) — as of ${new Date().toLocaleTimeString('en-US')}`
      : `Updated ${new Date().toLocaleTimeString('en-US')}`;
  } catch (err) {
    document.getElementById('last-refreshed').textContent = `Error: ${err.message}`;
    console.error(err);
  } finally {
    btn.classList.remove('spinning');
  }
}

document.querySelectorAll('.pill').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.range = btn.dataset.range;
    loadAll();
  });
});
document.querySelector(`.pill[data-range="${state.range}"]`).classList.add('active');

document.getElementById('refresh-btn').addEventListener('click', loadAll);

document.getElementById('revenue-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const statusEl = document.getElementById('revenue-form-status');
  const body = {
    month: form.month.value,
    shannon: form.shannon.value,
    bluewireAmount: form.bluewireAmount.value,
    bluewireStatus: form.bluewireStatus.value,
  };
  try {
    await fetchJSON('/api/revenue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    statusEl.textContent = 'Saved.';
    statusEl.style.color = 'var(--green)';
    const revenue = await fetchJSON('/api/revenue');
    renderRevenue(revenue);
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.style.color = 'var(--red)';
  }
});

loadAll();
