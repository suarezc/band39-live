/* Page-level sections: animated counters, activity library, value calculator. */
(function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sc = window.VEXO_SCENARIO, A = window.VexoActivities;

  // ---------- counters ----------
  function runCounter(n) {
    if (n.dataset.done) return; n.dataset.done = 1;
    const to = +n.dataset.count, dec = +(n.dataset.dec || 0), pre = n.dataset.prefix || '', suf = n.dataset.suffix || '';
    const t0 = performance.now(), ms = 1100;
    (function f(now) {
      const t = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - t, 3);
      n.textContent = pre + (to * e).toFixed(dec) + suf;
      if (t < 1) requestAnimationFrame(f);
    })(t0);
  }
  const counters = document.querySelectorAll('[data-count]');
  counters.forEach(n => (n.textContent = (n.dataset.prefix || '') + (+n.dataset.count).toFixed(+(n.dataset.dec || 0)) + (n.dataset.suffix || '')));
  const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && runCounter(e.target)), { threshold: .4 });
  counters.forEach(n => io.observe(n));

  // ---------- activity library ----------
  let filter = 'all';
  const FILTERS = [['all', 'All'], ['alz', '🧠 Best for Alzheimer’s'], ['core', 'Buildable now'], ['sep'], ...Object.entries(sc.cats).map(([k, v]) => [k, v.label])];
  function renderFilters() {
    $('#actFilters').innerHTML = FILTERS.map(([k, l]) => k === 'sep' ? '<span class="sep"></span>' : `<button data-f="${k}" class="${filter === k ? 'on' : ''}">${esc(l)}</button>`).join('');
    $('#actFilters').querySelectorAll('button').forEach(b => b.onclick = () => { filter = b.dataset.f; renderFilters(); renderActs(); });
  }
  const TIER = { core: 'Buildable now', support: 'Needs sensor data', vision: 'Vision' };
  function renderActs() {
    const list = A.ACTIVITIES.filter(a => filter === 'all' || (filter === 'alz' ? a.alz : filter === 'core' ? a.tier === 'core' : a.cat === filter));
    $('#actGrid').innerHTML = list.map(a => {
      const col = sc.cats[a.cat].color;
      return `<div class="act" style="--c:${col}">
        <div class="act-h"><div class="act-ic">${a.icon}</div><div><b>${esc(a.title)}</b><small>${esc(a.when)} · ${esc(sc.cats[a.cat].label)}</small></div></div>
        <div class="act-tags"><span class="tag ${a.tier}">${TIER[a.tier]}</span>${a.alz ? '<span class="tag alz">🧠 Alzheimer’s</span>' : ''}<span class="tag">${esc(a.level)}</span></div>
        <div class="sens">${a.sensors.map(s => `<span title="${esc(A.SENSORS[s].label)}">${A.SENSORS[s].icon} ${esc(A.SENSORS[s].label.split(' (')[0])}</span>`).join('')}</div>
        <p>${esc(a.vexo)}</p>
        <div class="vals"><div><b>For her</b>${esc(a.her)}</div><div><b>For family</b>${esc(a.family)}</div></div>
        <div class="stat-line">📊 ${esc(a.stat)}</div>
        ${a.sim ? `<button class="try" data-sim="${a.sim}">▶ in simulator</button>` : ''}
      </div>`;
    }).join('');
    $('#actGrid').querySelectorAll('.try').forEach(b => b.onclick = () => {
      const idx = sc.events.findIndex(e => e.id === b.dataset.sim);
      document.getElementById('sim').scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => window.VexoSim && window.VexoSim.jump(idx, true), 450);
    });
  }
  renderFilters(); renderActs();

  // ---------- value calculator ----------
  const NH_MONTH = 127800 / 12, HOUR_VALUE = 413e9 / 19.2e9; // ≈ $10,650/mo, ≈ $21.5/hr
  const money = v => '$' + Math.round(v).toLocaleString();
  function calc() {
    const nh = +$('#sNH').value, hr = +$('#sHR').value, scam = +$('#sSC').value, sub = +$('#sSUB').value;
    $('#vNH').textContent = nh; $('#vHR').textContent = hr; $('#vSC').textContent = money(scam); $('#vSUB').textContent = money(sub);
    const parts = [
      ['🏠 Nursing-home delay', nh * NH_MONTH, '#6C4DF6'],
      ['👩 Caregiver time', hr * 52 * HOUR_VALUE, '#EE7DB0'],
      ['🛡️ Scams prevented', scam, '#E8646A'],
    ];
    const total = parts.reduce((s, p) => s + p[1], 0), cost = sub * 12;
    $('#oVal').textContent = money(total);
    $('#oCost').textContent = money(cost);
    $('#oRoi').textContent = cost ? (total / cost).toFixed(1) + '×' : '–';
    const max = Math.max(1, ...parts.map(p => p[1]));
    $('#calcBars').innerHTML = parts.map(([l, v, c]) => `<div class="cb"><span>${l}</span><div class="bar"><i style="width:${(v / max * 100).toFixed(1)}%;background:${c}"></i></div><b>${money(v)}</b></div>`).join('');
  }
  ['#sNH', '#sHR', '#sSC', '#sSUB'].forEach(s => $(s).addEventListener('input', calc));
  calc();

  // nav highlight
  const links = [...document.querySelectorAll('.nav-links a')];
  const secIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) links.forEach(a => a.style.color = a.getAttribute('href') === '#' + e.target.id ? 'var(--violet)' : ''); }), { rootMargin: '-45% 0px -50% 0px' });
  document.querySelectorAll('section[id]').forEach(s => secIO.observe(s));
})();
