/* The toolbar popup: StatsActivity.kt + RevisionDialog.kt for Chrome. */
(async () => {
  const $ = (id) => document.getElementById(id);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab ? tab.id : null;

  const ask = (popup) => chrome.runtime.sendMessage({ popup, tabId }).then(render);
  $('snooze').onclick = () => ask('snooze');
  $('dismiss').onclick = () => ask('dismissNotice');
  $('reset').onclick = () => { if (confirm('Reset stats? This clears all ad-block counts for the last 30 days.')) ask('reset'); };
  ask('get');

  const avg = (d) => (d.videos === 0 ? 0 : d.adsBlocked / d.videos);
  const one = (v) => v.toFixed(1);
  const dayLabel = (day) =>
    new Date(day * 86400000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

  function render(r) {
    if (!r || r.error) { $('requests').textContent = 'Stats unavailable: ' + (r && r.error); return; }
    const t = r.today;
    $('current').textContent = r.currentVideoAds;
    $('todayAds').textContent = t.adsBlocked;
    $('todaySub').textContent = `${t.videos} video${t.videos === 1 ? '' : 's'} · ${one(avg(t))} per video`;
    $('requests').textContent = `Today: ${t.requestsBlocked} ad/tracker requests refused`;
    const ads = r.month.reduce((n, d) => n + d.adsBlocked, 0);
    const videos = r.month.reduce((n, d) => n + d.videos, 0);
    $('month').textContent = `Last 30 days: ${ads} ads · ${videos} videos · ${one(videos ? ads / videos : 0)} per video`;
    $('perVideo').textContent = t.perVideo.length
      ? 'Ads blocked per video today:  ' + t.perVideo.slice(-40).join('  ·  ')
      : 'No videos watched yet today.';
    $('rules').textContent = 'Rules version ' + r.rulesVersion;

    $('revision').hidden = r.issues.length === 0;
    $('snooze').hidden = !r.shouldPrompt;
    const list = $('issues');
    list.replaceChildren(...r.issues.map((i) => {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = `${i.code} (reported ${i.total}×)`;
      li.append(b, ' ', i.hint);
      i.details.slice(-3).forEach((d) => {
        const div = document.createElement('div');
        div.className = 'detail';
        div.textContent = '– ' + d;
        li.append(div);
      });
      return li;
    }));
    $('notice').hidden = !r.installNotice;
    drawChart(r.month);
  }

  // Port of TrendChartView.kt: bars for ads blocked per day, a line for average ads per video (right scale).
  function drawChart(days) {
    const canvas = $('chart');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const color = (name) => css.getPropertyValue(name).trim();
    const total = days.reduce((n, d) => n + d.adsBlocked, 0);
    canvas.setAttribute('aria-label', `Ads blocked over the last ${days.length} days: ${total} in total`);

    const niceCeil = (v) => {
      const mag = Math.pow(10, Math.ceil(Math.log10(v)) - 1);
      return [1, 2, 5, 10].map((m) => m * mag).find((x) => x >= v);
    };
    const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
    const left = 34, right = W - 30, top = 30, bottom = H - 20, h = bottom - top;
    const maxAds = niceCeil(Math.max(1, ...days.map((d) => d.adsBlocked)));
    const maxAvg = niceCeil(Math.max(1, ...days.map(avg)));
    g.font = '11px system-ui, "Segoe UI", sans-serif';

    // Legend
    g.fillStyle = color('--bar');
    g.fillRect(left, 6, 10, 10);
    g.fillStyle = color('--muted');
    g.fillText('Ads blocked per day', left + 15, 15);
    const l2 = left + 15 + g.measureText('Ads blocked per day').width + 20;
    g.strokeStyle = color('--line');
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(l2, 11); g.lineTo(l2 + 14, 11); g.stroke();
    g.fillText('Avg ads per video', l2 + 19, 15);

    // Grid and scales
    g.lineWidth = 1;
    for (let i = 0; i <= 2; i++) {
      const y = bottom - (h * i) / 2;
      g.strokeStyle = color('--grid');
      g.beginPath(); g.moveTo(left, y); g.lineTo(right, y); g.stroke();
      g.fillStyle = color('--muted');
      g.textAlign = 'right'; g.fillText(fmt((maxAds * i) / 2), left - 5, y + 4);
      g.textAlign = 'left'; g.fillText(fmt((maxAvg * i) / 2), right + 5, y + 4);
    }

    const slot = (right - left) / days.length;
    const barW = slot * 0.62;
    const points = [];
    g.textAlign = 'center';
    days.forEach((d, i) => {
      const cx = left + slot * (i + 0.5);
      const barH = (h * d.adsBlocked) / maxAds;
      g.fillStyle = color('--bar');
      if (barH > 0) g.fillRect(cx - barW / 2, bottom - barH, barW, barH);
      if (d.videos > 0) points.push([cx, bottom - (h * avg(d)) / maxAvg]);
      const last = i === days.length - 1;
      if (last || (days.length - 1 - i) % 7 === 0) {
        g.fillStyle = color('--muted');
        g.fillText(last ? 'Today' : dayLabel(d.day), cx, bottom + 14);
      }
    });
    g.strokeStyle = g.fillStyle = color('--line');
    g.lineWidth = 2;
    g.lineJoin = 'round';
    g.beginPath();
    points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    points.forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2); g.fill(); });
  }
})();
