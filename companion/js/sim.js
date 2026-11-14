/* Simulator UI: isometric day board, data-flow animation, family app, memory graph. */
(function () {
  const sc = window.VEXO_SCENARIO, E = window.VexoEngine;
  const $ = s => document.querySelector(s);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- geometry ----------
  const S = 58, CELL = 86, COLS = 5, ROWS = 3, BW = COLS * CELL, BH = ROWS * CELL, TILT = 58;
  const PATH = [[0,0],[1,0],[2,0],[3,0],[4,0],[4,1],[3,1],[2,1],[1,1],[0,1],[0,2],[1,2],[2,2],[3,2]];
  const START = [-0.9, 0];
  const cubeH = i => 20 + (i % 3) * 6;
  const center = ([c, r]) => [c * CELL + CELL / 2, r * CELL + CELL / 2];
  const BILL = `rotateZ(45deg) rotateX(-${TILT}deg)`;

  // ---------- state ----------
  let mode = 'with', stage = 'mild', speed = 1;
  let state, plan, pi = 0, token = 0, playing = false, started = false, stopAfterEv = null;
  let avatarPos = { x: center(START)[0], y: center(START)[1], z: 0 };
  let sharing = { alerts: true, messages: true, meds: true, appts: true, digest: true, trends: true, location: true };
  const newFeed = new Set(), newMem = new Set();

  // ---------- helpers ----------
  const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255; r = Math.round(r * f); g = Math.round(g * f); b = Math.round(b * f); return `rgb(${r},${g},${b})`; };
  const catColor = c => (sc.cats[c] || {}).color || '#8B6CF0';
  function sleep(ms, my) {
    return new Promise(res => {
      let left = ms, last = performance.now();
      (function tick() {
        if (my !== token) return res(false);
        const now = performance.now();
        if (playing) left -= (now - last);
        last = now;
        if (left <= 0) return res(true);
        setTimeout(tick, 30);
      })();
    });
  }
  const dur = ms => ms / speed;
  const wait = (ms, my) => new Promise(r => setTimeout(() => r(my === token), ms)); // real time, ignores pause

  // ---------- board ----------
  const board = $('#board');
  const cubes = [];
  function block(x, y, w, d, h, color, cls) {
    const b = el('div', 'cube' + (cls ? ' ' + cls : ''));
    Object.assign(b.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: d + 'px' });
    const top = el('div', 'face top'); top.style.transform = `translateZ(${h}px)`; top.style.background = color;
    const sy = el('div', 'face side-y'); Object.assign(sy.style, { top: d + 'px', height: h + 'px', background: shade(color.startsWith('#') ? color : '#8B6CF0', .82), transform: 'rotateX(90deg)' });
    const sx = el('div', 'face side-x'); Object.assign(sx.style, { left: -h + 'px', width: h + 'px', background: shade(color.startsWith('#') ? color : '#8B6CF0', .68), transform: 'rotateY(90deg)' });
    b.append(sy, sx, top);
    return { b, top };
  }
  function buildBoard() {
    board.innerHTML = '';
    Object.assign(board.style, { width: BW + 'px', height: BH + 'px', left: -BW / 2 + 'px', top: -BH / 2 + 'px' });
    const ground = el('div', 'ground');
    Object.assign(ground.style, { left: '-46px', top: '-26px', width: BW + 70 + 'px', height: BH + 46 + 'px' });
    board.append(ground);
    // path dots between consecutive cubes
    const pts = [START, ...PATH];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = center(pts[i]), [x2, y2] = center(pts[i + 1]);
      for (let t = 1; t <= 3; t++) {
        const d = el('div', 'path-dot');
        d.style.left = (x1 + (x2 - x1) * t / 4 - 4) + 'px'; d.style.top = (y1 + (y2 - y1) * t / 4 - 4) + 'px';
        board.append(d);
      }
    }
    // start mat (home)
    const home = block(center(START)[0] - 22, center(START)[1] - 22, 44, 44, 6, '#FFFFFF');
    home.top.innerHTML = '<span class="tlabel" style="color:#8B6CF0;font-size:10px">START</span>';
    board.append(home.b);
    // trees in the empty cell + a couple outside
    [[4.15, 2.2], [4.55, 2.6], [4.3, 2.75], [-0.75, 1.55], [5.1, 0.8]].forEach(([c, r], i) => {
      const x = c * CELL, y = r * CELL, s = 14 + (i % 2) * 4;
      const trunk = block(x + s / 2 - 3, y + s / 2 - 3, 6, 6, 10, '#9C7A55', 'tree'); board.append(trunk.b);
      const leaf = block(x, y, s, s, 10 + s, '#7CC46B', 'tree'); leaf.b.style.transform = 'translateZ(10px)'; board.append(leaf.b);
    });
    // event cubes
    sc.events.forEach((ev, i) => {
      const [c, r] = PATH[i], col = catColor(ev.cat), h = cubeH(i);
      const { b, top } = block(c * CELL + (CELL - S) / 2, r * CELL + (CELL - S) / 2, S, S, h, col);
      top.innerHTML = `<span class="tlabel">${ev.time}</span><span class="done-badge">✓</span>`;
      const bb = el('div', 'billboard'); bb.style.transform = `translateZ(${h + 4}px) ${BILL}`;
      bb.append(el('div', 'bb-inner', `<div class="cube-icon">${ev.icon}</div>`));
      b.append(bb);
      b.dataset.ev = i; b.dataset.h = h;
      b.addEventListener('click', () => jump(i, true));
      b.addEventListener('mousemove', e => showTip(e, `<b>${esc(ev.time)} · ${esc(ev.title)}</b>${esc(ev.summary)}`));
      b.addEventListener('mouseleave', hideTip);
      board.append(b); cubes.push(b);
    });
    // avatar
    const av = el('div', 'avatar'); av.id = 'avatar';
    av.innerHTML = `<div class="bb-inner"><div class="emote" id="emote" style="visibility:hidden">🙂</div>${AVATAR_SVG}</div>`;
    board.append(av);
    placeAvatar();
    // legend
    $('#legend').innerHTML = Object.values(sc.cats).map(c => `<span><i style="background:${c.color}"></i>${c.label}</span>`).join('');
    fitBoard();
  }
  const AVATAR_SVG = `<svg viewBox="0 0 46 64"><ellipse cx="23" cy="61" rx="12" ry="3" fill="rgba(0,0,0,.15)"/>
    <path d="M10 58 Q10 36 23 34 Q36 36 36 58 Z" fill="#8B6CF0"/><path d="M23 35 L23 58" stroke="#6C4DF6" stroke-width="1.5"/>
    <circle cx="19" cy="44" r="1.2" fill="#E6DEFF"/><circle cx="19" cy="50" r="1.2" fill="#E6DEFF"/>
    <path d="M12 42 Q8 50 12 55" stroke="#8B6CF0" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M34 42 Q38 50 34 55" stroke="#8B6CF0" stroke-width="5" fill="none" stroke-linecap="round"/>
    <circle cx="12" cy="56" r="2.6" fill="#F3C9A8"/><circle cx="34" cy="56" r="2.6" fill="#F3C9A8"/>
    <rect class="wrist" x="30.5" y="51" width="7" height="3.2" rx="1.6" fill="#B9A6FF" stroke="#6C4DF6" stroke-width=".8"/>
    <circle cx="23" cy="24" r="10" fill="#F3C9A8"/>
    <path d="M12.6 24 Q12 11 23 11.5 Q34 11 33.4 24 Q31 16.5 23 16.5 Q15 16.5 12.6 24Z" fill="#DADAE6"/><circle cx="23" cy="9.5" r="4.6" fill="#DADAE6"/>
    <circle cx="19" cy="25" r="3" fill="none" stroke="#5a5470" stroke-width="1"/><circle cx="27" cy="25" r="3" fill="none" stroke="#5a5470" stroke-width="1"/>
    <line x1="22" y1="25" x2="24" y2="25" stroke="#5a5470" stroke-width="1"/>
    <path d="M20 30 Q23 32.2 26 30" stroke="#B5746A" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    <circle cx="16.5" cy="28.5" r="1.6" fill="#F2A7A0" opacity=".6"/><circle cx="29.5" cy="28.5" r="1.6" fill="#F2A7A0" opacity=".6"/></svg>`;

  function fitBoard() {
    const card = $('#boardCard'); if (!card) return;
    const projW = (BW + BH) * Math.SQRT1_2 + 90;
    const s = Math.max(.55, Math.min(1.25, (card.clientWidth - 20) / projW, (card.clientHeight - 60) / 330));
    board.style.transform = `rotateX(${TILT}deg) rotateZ(-45deg) scale(${s.toFixed(3)})`;
  }
  function placeAvatar() {
    const av = $('#avatar'); if (!av) return;
    av.style.transform = `translate3d(${avatarPos.x}px, ${avatarPos.y}px, ${avatarPos.z}px) ${BILL}`;
  }
  function hopTo(evIdx, ms) {
    const target = evIdx < 0 ? START : PATH[evIdx];
    const [tx, ty] = center(target), tz = evIdx < 0 ? 6 : cubeH(evIdx) + 2;
    const from = { ...avatarPos };
    if (!ms) { avatarPos = { x: tx, y: ty, z: tz }; placeAvatar(); return Promise.resolve(); }
    const my = token;
    return new Promise(res => {
      const t0 = performance.now();
      (function frame(now) {
        if (my !== token) return res();
        const t = Math.min(1, (now - t0) / ms), e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        avatarPos = { x: from.x + (tx - from.x) * e, y: from.y + (ty - from.y) * e, z: from.z + (tz - from.z) * e + Math.sin(Math.PI * t) * 46 };
        placeAvatar();
        t < 1 ? requestAnimationFrame(frame) : res();
      })(t0);
    });
  }
  function setEmote(ch) {
    const e = $('#emote'); if (!e) return;
    if (!ch) { e.style.visibility = 'hidden'; return; }
    e.style.visibility = 'visible'; e.textContent = ch;
    e.style.animation = 'none'; void e.offsetWidth; e.style.animation = '';
  }

  // ---------- sky / clock ----------
  const SKY = [
    [6 * 60, '#FFD2A6', '#FFF1E2'], [8.5 * 60, '#BFE3FF', '#F3FAFF'], [13 * 60, '#B6DDFF', '#F5FBFF'],
    [17 * 60, '#FFD9AE', '#FFF3E6'], [19 * 60, '#B49AE6', '#F7D9E6'], [20.5 * 60, '#3A3A78', '#6B5B9C'],
    [22 * 60, '#23264F', '#3A3B70'], [30 * 60, '#1C1E44', '#33346A'],
  ];
  const lerpHex = (a, b, t) => { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); const c = [16, 8, 0].map(s => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * t)); return `rgb(${c.join(',')})`; };
  function paintSky(min) {
    let i = 0; while (i < SKY.length - 2 && min > SKY[i + 1][0]) i++;
    const [m0, a0, b0] = SKY[i], [m1, a1, b1] = SKY[i + 1], t = Math.max(0, Math.min(1, (min - m0) / (m1 - m0)));
    $('#sky').style.background = `linear-gradient(180deg, ${lerpHex(a0, a1, t)}, ${lerpHex(b0, b1, t)})`;
    const night = min >= 20 * 60;
    $('#sky .stars').style.opacity = night ? 1 : 0;
    const sun = $('#sun'), card = $('#boardCard');
    const w = card.clientWidth, h = card.clientHeight;
    let p = night ? (min - 20 * 60) / (10 * 60) : (min - 6 * 60) / (14 * 60);
    p = Math.max(0, Math.min(1, p));
    sun.classList.toggle('moon', night);
    sun.style.left = (30 + p * (w - 110)) + 'px';
    sun.style.top = (h * .34 - Math.sin(Math.PI * p) * h * .26) + 'px';
    document.querySelector('.legend').style.color = night ? '#4A4566' : '';
  }
  function setClock(min) {
    $('#clock').textContent = E.fmtClock(min);
    $('#clockDay').textContent = min >= 24 * 60 ? 'Fri' : 'Thu';
    paintSky(min);
  }
  function animateClock(from, to, ms) {
    if (!ms || to <= from) { setClock(to); return Promise.resolve(); }
    const my = token;
    return new Promise(res => {
      const t0 = performance.now();
      (function f(now) { if (my !== token) return res(); const t = Math.min(1, (now - t0) / ms); setClock(from + (to - from) * t); t < 1 ? requestAnimationFrame(f) : res(); })(t0);
    });
  }

  // ---------- timeline ----------
  function buildTimeline() {
    const tl = $('#timeline'); tl.innerHTML = '';
    sc.events.forEach((ev, i) => {
      const b = el('button', 'tl', `<span class="ic">${ev.icon}</span>${ev.time}`);
      b.style.setProperty('--c', catColor(ev.cat));
      b.title = `${ev.time} · ${ev.title}`;
      b.onclick = () => jump(i, true);
      tl.append(b);
    });
  }
  function markBoard() {
    const tls = document.querySelectorAll('.tl');
    cubes.forEach((c, i) => {
      const done = state.done.includes(i), act = state.evIdx === i;
      c.classList.toggle('done', done); c.classList.toggle('active', act);
      c.style.transform = act ? 'translateZ(8px)' : '';
      tls[i].classList.toggle('done', done); tls[i].classList.toggle('active', act);
    });
    if (state.evIdx >= 0 && !hopping) { avatarPos.z = cubeH(state.evIdx) + 10; placeAvatar(); } // ride the raised cube
  }
  let hopping = false;

  // ---------- narration ----------
  function setHeader(ev) {
    if (!ev) { $('#narrTime').textContent = '—'; $('#narrTitle').textContent = 'Press ▶ to start Margaret’s day'; ['#narrCat', '#narrLevel'].forEach(s => $(s).classList.remove('show')); return; }
    $('#narrTime').textContent = E.fmtClock(E.minutes(ev.time));
    $('#narrTitle').textContent = ev.title;
    const cat = $('#narrCat'); cat.textContent = sc.cats[ev.cat].label; cat.style.background = catColor(ev.cat); cat.classList.add('show');
    $('#narrLevel').classList.remove('show');
    $('#placeTag').textContent = ev.place;
  }
  const LEVEL_NAMES = { L0: 'L0 · Remember', L1: 'L1 · Remind', L2: 'L2 · Act + tell', L3: 'L3 · Ask first', L4: 'L4 · Escalate' };
  function setLevel(l) { const b = $('#narrLevel'); if (!l || mode === 'without') return; b.textContent = LEVEL_NAMES[l]; b.classList.add('show'); }
  function addBubble(say) {
    const [who, text] = say, sp = sc.speakers[who];
    const box = $('#bubbles');
    box.querySelectorAll('.bub').forEach(b => b.classList.add('old'));
    const b = el('div', `bub ${sp.side}`, `<span class="who" style="--c:${sp.color}" aria-hidden="true">${sp.icon}</span><div class="txt">${sp.name ? `<small>${esc(sp.name)}</small>` : ''}${esc(text)}</div>`);
    box.append(b); box.scrollTop = box.scrollHeight;
  }
  function renderActions() {
    const a = $('#actions');
    a.innerHTML = state.actions.length ? '<span class="lbl">Vexo did</span>' + state.actions.map(x => `<span class="act">${x.icon} ${esc(x.text)}</span>`).join('') : '';
  }

  // ---------- haptics & sensors ----------
  const PATTERNS = { 1: [320], 2: [170, 130, 170], 3: [560, 200, 560, 200, 560] };
  const PATTERN_NAMES = { 1: '1× gentle (reminder)', 2: '2× short (confirmed)', 3: '3× long (WARNING)' };
  async function playHaptic(n, my) {
    const seq = PATTERNS[n]; if (!seq) return;
    const dots = [...document.querySelectorAll('#hapticViz i')], band = document.querySelector('.band-mini'), av = $('#avatar'), rip = document.querySelector('.ripple');
    $('#sensorChips [data-s=haptic]').classList.add('on');
    let k = 0;
    for (let i = 0; i < seq.length; i++) {
      const on = i % 2 === 0;
      if (on) { dots[k % 3].classList.add('on'); band.classList.add('buzz'); av.classList.add('buzz'); rip.classList.remove('go'); void rip.offsetWidth; rip.classList.add('go'); k++; }
      await wait(seq[i], my);
      band.classList.remove('buzz'); av.classList.remove('buzz');
      if (my !== token) break;
    }
    await wait(250, my);
    dots.forEach(d => d.classList.remove('on'));
    $('#sensorChips [data-s=haptic]').classList.remove('on');
  }
  function sensorsOn(list) {
    document.querySelectorAll('#sensorChips span').forEach(s => s.classList.toggle('on', !!list && list.includes(s.dataset.s)));
  }

  // ---------- flights ----------
  const HOP = {
    'bracelet>phone': ['BLE 5 LE · GATT notify · AES-CCM', '#8B6CF0'],
    'phone>bracelet': ['BLE write · haptic command', '#F2A65A'],
    'phone>cloud': ['HTTPS · TLS 1.3', '#4F8EF0'],
    'cloud>phone': ['Push · TLS 1.3', '#F2A65A'],
    'cloud>cloud': ['Agent · LLM extraction', '#8B6CF0'],
    'cloud>cal': ['Google Calendar API', '#3FB3A3'], 'cloud>mail': ['Gmail API', '#3FB3A3'],
    'cloud>notion': ['Notion API', '#3FB3A3'], 'cloud>sms': ['Twilio SMS', '#3FB3A3'],
    'mail>family': ['Email → Lisa', '#EE7DB0'], 'sms>family': ['SMS → Lisa', '#EE7DB0'],
    'cloud>family': ['Push (APNs/FCM) → Lisa', '#EE7DB0'], 'family>cloud': ['HTTPS · from Lisa', '#EE7DB0'],
    'cube>bracelet': ['On-wrist sensing', '#8B6CF0'],
  };
  const anchorEl = key => key === 'cube' ? document.querySelector('#avatar svg') : document.querySelector(`[data-anchor="${key}"]`);
  const NODE_IDS = { bracelet: '#nodeBracelet', phone: '#nodePhone', cloud: '#nodeCloud', cal: '#nodeCal', mail: '#nodeMail', notion: '#nodeNotion', sms: '#nodeSms', family: '#lisaPhone' };
  function heat(key) { const n = NODE_IDS[key] && $(NODE_IDS[key]); if (!n || key === 'family') { if (key === 'family') { const d = $('#liveDot'); d.classList.remove('flash'); void d.offsetWidth; d.classList.add('flash'); } return; } n.classList.add('hot'); setTimeout(() => n.classList.remove('hot'), 700); }
  const rectC = (n, edge) => { const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: edge === 'top' ? r.top + 8 : r.top + r.height / 2, vis: r.bottom > 0 && r.top < innerHeight && r.width > 0 }; };
  function fly(f, my) {
    const key = `${f.from}>${f.to}`, [proto, color] = HOP[key] || ['', '#8B6CF0'];
    if (f.payload) logPacket(f, proto, color);
    heat(f.from);
    const a = anchorEl(f.from), b = anchorEl(f.to);
    const ms = dur(f.from === f.to ? 650 : 900);
    if (!a || !b || f.from === f.to) return wait(ms, my).then(() => heat(f.to));
    const p0 = rectC(a), p1 = rectC(b, f.to === 'family' ? 'top' : null);
    if (!p0.vis && !p1.vis) return wait(ms * .4, my).then(() => heat(f.to));
    const svg = $('#fxSvg'), NS = 'http://www.w3.org/2000/svg';
    const path = document.createElementNS(NS, 'path'); path.setAttribute('class', 'fx-path'); path.setAttribute('stroke', color);
    svg.append(path);
    const dot = el('div', 'fx-dot'); dot.style.setProperty('--c', color);
    const lab = el('div', 'fx-label', esc(f.label || '')); lab.style.setProperty('--c', color);
    document.body.append(dot, lab);
    return new Promise(res => {
      const t0 = performance.now();
      (function frame(now) {
        if (my !== token) { path.remove(); dot.remove(); lab.remove(); return res(); }
        const A = rectC(a), B = rectC(b, f.to === 'family' ? 'top' : null);
        const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
        const bend = Math.min(80, len * .25), cx = (A.x + B.x) / 2 - dy / len * bend, cy = (A.y + B.y) / 2 + dx / len * bend;
        path.setAttribute('d', `M${A.x},${A.y} Q${cx},${cy} ${B.x},${B.y}`);
        const t = Math.min(1, (now - t0) / ms), e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const x = (1 - e) * (1 - e) * A.x + 2 * (1 - e) * e * cx + e * e * B.x, y = (1 - e) * (1 - e) * A.y + 2 * (1 - e) * e * cy + e * e * B.y;
        dot.style.transform = `translate(${x}px, ${y}px)`;
        lab.style.transform = `translate(${x + 10}px, ${y - 26}px)`;
        if (t < 1) requestAnimationFrame(frame);
        else { heat(f.to); dot.remove(); lab.remove(); path.style.transition = 'opacity .4s'; path.style.opacity = 0; setTimeout(() => path.remove(), 420); res(); }
      })(t0);
    });
  }
  function fmtJSON(o) {
    let s = JSON.stringify(o);
    if (s.length > 230) s = s.slice(0, 227) + '…';
    return esc(s).replace(/&quot;([^&]*?)&quot;:/g, '<span class="k">"$1"</span>:').replace(/:(&quot;.*?&quot;)/g, ':<span class="s">$1</span>').replace(/:(-?\d+\.?\d*)/g, ':<span class="n">$1</span>');
  }
  function logPacket(f, proto, color) {
    const box = $('#packets'); const empty = box.querySelector('.empty'); if (empty) empty.remove();
    box.querySelectorAll('.pk').forEach(p => p.classList.add('old'));
    const pk = el('div', 'pk', `<div class="pk-h"><b>${esc(f.label || '')}</b><span style="color:${color}">${esc(f.from)} → ${esc(f.to)} · ${esc(proto)}</span></div>${fmtJSON(f.payload)}`);
    box.prepend(pk);
    while (box.children.length > 3) box.lastChild.remove();
  }

  // ---------- memory graph ----------
  const MEM_STYLE = {
    self: ['#6C4DF6', '👵'], person: ['#F2A65A', '👤'], med: ['#3FB3A3', '💊'], appt: ['#6C8BD8', '📅'], promise: ['#EE7DB0', '🤝'], episode: ['#E8646A', '⭐'],
  };
  const MEM_ICON = { lisa: '👩', ethan: '👦', patel: '🩺', joan: '👩‍🦳', scamcall: '🛡️', walk: '🚶', lisavisit: '🌷', tomatoes: '🍅' };
  function renderMemory() {
    const svg = $('#memSvg'), cx = 260, cy = 168, rx = 205, ry = 140;
    const ORDER = ['person', 'med', 'appt', 'promise', 'episode'];
    const others = state.memory.filter(n => n.type !== 'self').sort((x, y) => ORDER.indexOf(x.type) - ORDER.indexOf(y.type));
    const pos = { margaret: [cx, cy] };
    others.forEach((n, i) => {
      const ang = (-90 + i * 360 / others.length) * Math.PI / 180, ring = i % 2 ? .7 : 1;
      pos[n.id] = [cx + Math.cos(ang) * rx * ring, cy + Math.sin(ang) * ry * ring];
    });
    let html = '';
    state.memory.forEach(n => { if (n.id !== 'margaret' && pos[n.id]) html += `<line class="ml" x1="${cx}" y1="${cy}" x2="${pos[n.id][0]}" y2="${pos[n.id][1]}"/>`; });
    state.memory.forEach(n => {
      const p = pos[n.id]; if (!p) return;
      const [col, ic] = MEM_STYLE[n.type] || MEM_STYLE.episode, r = n.type === 'self' ? 22 : 15;
      const label = n.label.length > 17 ? n.label.slice(0, 16) + '…' : n.label;
      html += `<g class="mn" data-id="${n.id}" transform="translate(${p[0].toFixed(1)},${p[1].toFixed(1)})"><g class="${newMem.has(n.id) ? 'pop' : ''}"><circle r="${r}" fill="${col}"/><text class="e">${MEM_ICON[n.id] || ic}</text><text class="l" y="${r + 12}">${esc(label)}</text></g></g>`;
    });
    svg.innerHTML = html;
    svg.querySelectorAll('.mn').forEach(g => {
      const n = state.memory.find(x => x.id === g.dataset.id);
      g.addEventListener('mousemove', e => showTip(e, `<b>${esc(n.label)}</b>${esc(n.quote || '')}${n.seed ? '<br><i>added at onboarding</i>' : ''}`));
      g.addEventListener('mouseleave', hideTip);
    });
    newMem.clear();
  }

  // ---------- family feed ----------
  const FEED_COLOR = { alerts: '#E8646A', meds: '#3FB3A3', appts: '#6C8BD8', messages: '#EE7DB0', digest: '#8B6CF0', trends: '#F2A65A', location: '#73BF5F' };
  function renderFeed() {
    const box = $('#feed');
    const items = state.feed.filter(it => it.cat === 'out' || sharing[it.cat] !== false).slice().reverse();
    if (!items.length) { box.innerHTML = `<div class="empty">${mode === 'without' ? 'No updates. Lisa only knows what Mom remembers to tell her.' : 'Updates from Mom’s day show up here.'}</div>`; return; }
    box.innerHTML = items.map(it => {
      const t = E.fmtClock(it.at);
      if (it.cat === 'out') return `<div class="fi out${newFeed.has(it.id) ? ' new' : ''}"><div class="fi-h">You → Mom<span>${t}</span></div><p style="color:#fff">${esc(it.body)}</p><p>${esc(it.status || '')}</p></div>`;
      const body = it.lines ? `<ul>${it.lines.filter(l => ['alerts', 'messages'].includes(l.cat) || sharing[l.cat] !== false).map(l => `<li>${esc(l.text)}</li>`).join('')}</ul>` : `<p>${esc(it.body)}</p>`;
      return `<div class="fi${it.without ? ' worried' : ''}${newFeed.has(it.id) ? ' new' : ''}" style="--c:${FEED_COLOR[it.cat] || '#8B6CF0'}"><div class="fi-h">${it.icon} ${esc(it.title)}<span>${t}</span></div>${body}</div>`;
    }).join('');
    newFeed.clear();
  }
  const SHARE_ROWS = [
    ['alerts', 'Safety alerts', 'Scams, falls, door at night', true],
    ['messages', 'Messages', 'Two-way voice and text', true],
    ['meds', 'Medications', 'Taken / missed'],
    ['appts', 'Appointments & visits', 'Summaries, never transcripts'],
    ['digest', 'Daily digest', 'One summary each evening'],
    ['trends', 'Wellbeing trends', 'Sleep, activity, restlessness'],
    ['location', 'Location', 'Only when off her usual route'],
  ];
  function buildSharing() {
    $('#sharing').innerHTML = SHARE_ROWS.map(([k, t, s, locked]) => `<div class="sw"><div>${t}<small>${s}${locked ? ' · always on' : ''}</small></div><label class="toggle"><input type="checkbox" data-k="${k}" ${sharing[k] ? 'checked' : ''} ${locked ? 'disabled' : ''}/><span></span></label></div>`).join('');
    $('#sharing').addEventListener('change', e => { const k = e.target.dataset.k; if (k) { sharing[k] = e.target.checked; renderFeed(); } });
  }

  // ---------- metrics ----------
  let lastMetrics = null;
  function renderMetrics() {
    const fmt = (m, v) => m.money ? '$' + v.toLocaleString() : (m.of ? `${v}/${m.of}` : String(v));
    const doneAny = state.done.length > 0;
    $('#metrics').innerHTML = `<div class="mrow head"><span>So far today</span><span>With Vexo</span><span>Without</span></div>` +
      sc.metrics.map(m => {
        const w = state.metrics.with[m.key], wo = state.metrics.without[m.key];
        const bw = lastMetrics && lastMetrics.with[m.key] !== w, bwo = lastMetrics && lastMetrics.without[m.key] !== wo;
        return `<div class="mrow"><span>${m.label}</span><span class="mval w${bw ? ' bump' : ''}">${doneAny ? fmt(m, w) : '–'}</span><span class="mval wo${bwo ? ' bump' : ''}">${doneAny ? fmt(m, wo) : '–'}</span></div>`;
      }).join('');
    lastMetrics = JSON.parse(JSON.stringify(state.metrics));
  }

  // ---------- running the plan ----------
  async function runStep(step, my) {
    if (step.kind === 'travel') {
      const prevClock = state.clock, ev = sc.events[step.ev];
      E.applyStep(state, step, sc);
      $('#bubbles').innerHTML = ''; renderActions(); setHeader(ev); setEmote(null);
      hopping = true;
      cubes.forEach(c => { c.classList.remove('active'); c.style.transform = ''; });
      await Promise.all([hopTo(step.ev, dur(750)), animateClock(prevClock, state.clock, dur(750))]);
      hopping = false;
      if (my !== token) return;
      markBoard(); setEmote(ev.emote);
      await sleep(dur(350), my);
    } else if (step.kind === 'beat') {
      const b = step.beat;
      if (b.at) { await animateClock(state.clock, E.minutes(b.at), dur(400)); }
      if (b.say) addBubble(b.say);
      setLevel(b.level);
      const t0 = performance.now();
      const waits = [];
      if (b.sensors && mode === 'with') {
        sensorsOn(b.sensors);
        waits.push(fly({ from: 'cube', to: 'bracelet', label: b.sensors.map(s => ({ mic: 'mic', acc: 'motion', hr: 'heart rate', temp: 'skin temp', ble: 'Bluetooth' }[s])).join(', ') + ' sensing' }, my));
      }
      await Promise.all(waits);
      for (const f of (b.flows || [])) { if (my !== token) return; await fly(f, my); }
      if (b.haptic && mode === 'with') {
        if (!(b.flows || []).some(f => f.to === 'bracelet')) await fly({ from: 'phone', to: 'bracelet', label: 'haptic ×' + b.haptic, payload: { cmd: 'haptic', pattern: PATTERN_NAMES[b.haptic], then: b.say && b.say[0] === 'vexo' ? 'earbud_tts' : null } }, my);
        await playHaptic(b.haptic, my);
      }
      if (my !== token) return;
      const fx = E.applyStep(state, step, sc);
      fx.forEach(x => { if (x.type === 'feed') newFeed.add(x.item.id); if (x.type === 'mem') newMem.add(x.id); });
      if (fx.some(x => x.type === 'feed')) renderFeed();
      if (fx.some(x => x.type === 'mem') || (b.mem && b.mem.length)) renderMemory();
      if (b.actions) renderActions();
      const words = b.say ? b.say[1].split(/\s+/).length : 4;
      const read = Math.min(5600, Math.max(1500, words * 270));
      const spent = performance.now() - t0;
      await sleep(Math.max(dur(450), dur(read) - spent), my);
      sensorsOn(null);
    } else if (step.kind === 'done') {
      E.applyStep(state, step, sc);
      markBoard(); renderMetrics();
      await sleep(dur(500), my);
    } else if (step.kind === 'end') {
      E.applyStep(state, step, sc);
      showEnd();
    }
  }
  function showEnd() {
    setEmote('😴');
    $('#narrTitle').textContent = 'End of the day';
    const w = state.metrics.with, wo = state.metrics.without;
    addBubble(['narrator', mode === 'with'
      ? `With Vexo: ${w.meds}/2 meds, ${w.instr}/3 instructions remembered, $0 lost, ${w.calls} worried calls, ${w.family} family updates. Without it, the same day costs $${wo.lost.toLocaleString()}, ${wo.calls} worried calls, and ${wo.alone} frightening moments alone.`
      : `Without Vexo: $${wo.lost.toLocaleString()} lost, ${wo.calls} worried calls, ${wo.alone} frightening moments alone, and Lisa knew almost nothing. Switch to “With Vexo” to replay the same day.`]);
    if (mode === 'with') addBubble(['vexoPhone', '📈 Weekly card for Lisa (a vision, not a diagnosis): conversation minutes are steady, night wakes are up on 2 of 7 nights, and walks are steady. “Worth mentioning at the Dec 23 visit.”']);
    const a = $('#actions');
    a.innerHTML = `<button class="end-btn" type="button" id="replayBtn">Replay the day</button><button class="end-btn end-btn--dark" type="button" id="swapBtn">${mode === 'with' ? 'See it without Vexo' : 'See it with Vexo'}</button>`;
    $('#replayBtn').onclick = () => jump(0, true);
    $('#swapBtn').onclick = () => { setMode(mode === 'with' ? 'without' : 'with'); jump(0, true); };
    setPlaying(false);
  }

  async function loop() {
    const my = token;
    while (pi < plan.length) {
      if (my !== token) return;
      if (!playing) { await sleep(0, my); await new Promise(r => { const iv = setInterval(() => { if (playing || my !== token) { clearInterval(iv); r(); } }, 50); }); if (my !== token) return; }
      const step = plan[pi];
      await runStep(step, my);
      if (my !== token) return;
      pi++;
      if (step.kind === 'done' && stopAfterEv === step.ev) { stopAfterEv = null; setPlaying(false); }
    }
  }
  function cleanupFx() { document.querySelectorAll('.fx-dot,.fx-label').forEach(n => n.remove()); $('#fxSvg').innerHTML = ''; sensorsOn(null); document.querySelectorAll('.buzz').forEach(n => n.classList.remove('buzz')); }

  function reset(toEv) {
    token++; cleanupFx();
    state = E.initialState(sc, mode, stage); plan = E.buildPlan(sc, mode, stage); pi = 0; lastMetrics = null;
    while (pi < plan.length && !(plan[pi].kind === 'travel' && plan[pi].ev === toEv)) { E.applyStep(state, plan[pi], sc); pi++; }
    if (toEv > 0) state.clock = Math.max(state.clock, E.minutes(sc.events[toEv - 1].time));
    state.actions = [];
    $('#bubbles').innerHTML = ''; renderActions();
    setHeader(toEv > 0 ? sc.events[toEv - 1] : null);
    if (toEv > 0) { $('#narrTitle').textContent = `Next: ${sc.events[toEv].time} · ${sc.events[toEv].title}`; }
    hopTo(toEv - 1, 0); setEmote(null); setClock(state.clock);
    markBoard(); renderFeed(); renderMemory(); renderMetrics();
    $('#packets').innerHTML = '<div class="empty">Packets show up here while the day plays.</div>';
  }
  function jump(evIdx, autoplay) {
    evIdx = Math.max(0, Math.min(sc.events.length - 1, evIdx));
    reset(evIdx);
    started = true;
    if (autoplay) setPlaying(true);
    loop();
  }
  function setPlaying(p) {
    playing = p;
    $('#btnPlay').innerHTML = `<svg class="svgi" aria-hidden="true"><use href="#ic-${p ? 'pause' : 'play'}"/></svg>`; $('#btnPlay').setAttribute('aria-label', p ? 'Pause' : 'Play');
    if (p && !started) { started = true; loop(); }
    if (p && state.ended) jump(0, true);
  }
  function setMode(m) {
    mode = m; document.body.classList.toggle('without', m === 'without');
    document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === m));
  }
  const currentEv = () => Math.max(0, state.evIdx);

  // ---------- family composer ----------
  async function sendFromLisa(text) {
    text = text.trim(); if (!text) return;
    const my = token;
    const item = { cat: 'out', id: 'o' + Date.now(), body: text, at: state.clock, status: mode === 'with' ? 'Sending…' : 'Sent as a text message' };
    state.feed.push(item); newFeed.add(item.id); renderFeed();
    if (mode === 'without') {
      addBubble(['narrator', `Lisa texts “${text}”. It sits unread on Margaret’s phone; she doesn’t notice the tiny notification.`]);
      item.status = 'Not read'; renderFeed(); return;
    }
    const wasPlaying = playing; playing = false; // hold the story while the message travels
    const tok = token;
    await fly({ from: 'family', to: 'cloud', label: '💬 from Lisa', payload: { from: 'Lisa', msg: text } }, tok);
    const mem = E.parseFamilyMessage(text);
    if (mem) await fly({ from: 'cloud', to: 'cloud', label: 'extract', payload: { commitment: { who: 'Lisa', what: text, due: mem.due } } }, tok);
    await fly({ from: 'cloud', to: 'phone', label: '🔈 read aloud', payload: { tts: true, haptic: '1x' } }, tok);
    await fly({ from: 'phone', to: 'bracelet', label: 'haptic ×1', payload: { cmd: 'haptic', pattern: PATTERN_NAMES[1], then: 'earbud_tts' } }, tok);
    await playHaptic(1, tok);
    if (tok !== token) return;
    addBubble(['vexo', `Lisa says: “${text}”${mem ? ` I’ll remind you ${mem.due === 'tonight' ? 'tonight' : mem.due === 'tomorrow' ? 'tomorrow morning' : 'on ' + mem.due[0].toUpperCase() + mem.due.slice(1)}.` : ''}`]);
    if (mem && !state.memory.some(n => n.id === mem.id)) { state.memory.push(mem); newMem.add(mem.id); renderMemory(); }
    item.status = `Delivered · read aloud to Mom${mem ? ' · reminder saved' : ''}`; renderFeed();
    if (my === token) playing = wasPlaying;
  }

  // ---------- tooltip ----------
  const tip = $('#tip');
  function showTip(e, html) { tip.innerHTML = html; tip.classList.add('show'); tip.style.left = Math.min(innerWidth - 270, e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; }
  function hideTip() { tip.classList.remove('show'); }

  // ---------- wiring ----------
  function init() {
    const sel = $('#stageSel');
    sel.innerHTML = Object.entries(sc.stages).map(([k, v]) => `<option value="${k}" ${k === stage ? 'selected' : ''}>${v.label}</option>`).join('');
    const note = () => ($('#stageNote').textContent = sc.stages[stage].note);
    note();
    sel.onchange = () => { stage = sel.value; note(); const ev = currentEv(); jump(ev, playing); };
    $('#btnPlay').onclick = () => setPlaying(!playing);
    $('#btnNext').onclick = () => { const ev = Math.min(state.evIdx + 1, sc.events.length - 1); const was = playing; jump(ev, true); if (!was) stopAfterEv = ev; };
    $('#btnPrev').onclick = () => { const was = playing; const ev = Math.max(0, state.evIdx - 1); jump(ev, true); if (!was) stopAfterEv = ev; };
    document.querySelectorAll('#speedSeg button').forEach(b => b.onclick = () => { speed = +b.dataset.v; document.querySelectorAll('#speedSeg button').forEach(x => x.classList.toggle('on', x === b)); });
    document.querySelectorAll('#modeSeg button').forEach(b => b.onclick = () => { if (b.dataset.v === mode) return; setMode(b.dataset.v); jump(currentEv(), playing || !started ? true : false); });
    $('#composeForm').onsubmit = e => { e.preventDefault(); const v = $('#composeInput').value; $('#composeInput').value = ''; sendFromLisa(v); };
    document.querySelectorAll('#quick button').forEach(b => b.onclick = () => sendFromLisa(b.textContent));
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      const sim = $('#sim').getBoundingClientRect(); if (sim.bottom < 0 || sim.top > innerHeight) return;
      if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
      if (e.code === 'ArrowRight') $('#btnNext').click();
      if (e.code === 'ArrowLeft') $('#btnPrev').click();
    });
    buildBoard(); buildTimeline(); buildSharing();
    reset(0);
    new ResizeObserver(() => { fitBoard(); paintSky(state.clock); }).observe($('#boardCard'));
    // auto-start the first time the simulator scrolls into view
    const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting) && !started) { setPlaying(true); io.disconnect(); } }, { threshold: .35 });
    io.observe($('#boardCard'));
    window.VexoSim = { jump, setPlaying, setMode, setStage: s => { stage = s; sel.value = s; note(); }, get state() { return state; }, sendFromLisa };
  }
  init();
})();
