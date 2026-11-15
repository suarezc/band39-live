/* Band 39 care · Ask Pip (Margaret's side).
 * A card under Pip's bubble: a big "Ask Pip" button arms the server (POST api/ask/arm) so her next words are the
 * question; the server answers from her own transcript and tells every page {type:'ask', state:'answer', ...}.
 * This page shows the answer in large type and speaks it (POST api/tts, falling back to speechSynthesis).
 * A small text box asks by typing (POST api/ask), for when there is no band (the demo server).
 * Server side: care/server/ask.py.
 */
(function () {
  'use strict';
  // Embed mode (?embed=1, the deck's frame): show answers, never speak (the presenter's main tab speaks).
  const EMBED = /[?&]embed=1(?:&|$)/.test(location.search);
  const say = document.getElementById('pipSay');
  const col = say ? say.closest('.col') : document.querySelector('.col.margaret');
  if (!col) return;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const LISTEN = 'I’m listening… ask me anything about your day.';
  const state = { last: null, seen: new Set(), audio: null };
  window.VexoAsk = state;

  // ---- the card --------------------------------------------------------------------------------
  const card = el('div', 'ask-card');
  card.id = 'askCard';
  const btn = el('button', 'big ask-btn', '🎤 Ask Pip');
  btn.id = 'askBtn';
  btn.type = 'button';
  const area = el('div', 'ask-area');
  area.setAttribute('aria-live', 'polite');
  const asked = el('p', 'ask-q');
  const ans = el('p', 'ask-a');
  area.append(asked, ans);
  area.hidden = true;
  const form = el('form', 'ask-type');
  const input = el('input');
  input.type = 'text';
  input.placeholder = 'or type a question';
  input.id = 'askInput';
  input.setAttribute('aria-label', 'Type a question for Pip');
  const go = el('button', 'ask-go', 'Ask');
  go.type = 'submit';
  form.append(input, go);
  const typeBox = el('details', 'ask-more');
  typeBox.append(el('summary', '', 'Type instead'), form);
  card.append(btn, area, typeBox);
  const anchor = say ? (say.closest('.buddy') || say) : null;
  if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(card, anchor.nextSibling);
  else col.appendChild(card);

  function show(q, a, listening) {
    area.hidden = false;
    card.classList.toggle('listening', !!listening);
    asked.textContent = q ? 'You asked: ' + q : '';
    asked.hidden = !q;
    ans.textContent = a;
  }
  function listening() { show('', LISTEN, true); }

  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

  btn.addEventListener('click', () => {
    listening();
    post('api/ask/arm', { seconds: 12 }).catch(() => { show('', 'I can’t hear the band right now. You can type your question below.'); typeBox.open = true; });
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    show(q, 'Let me look…', true);
    post('api/ask', { question: q })
      .then((r) => r.json())
      .then((d) => { if (d && d.state === 'answer') onAnswer(d); else if (d && d.answer) show(q, d.answer); else show(q, 'I’m sorry, I couldn’t look that up just now.'); })
      .catch(() => show(q, 'I’m sorry, I couldn’t look that up just now.'));
  });

  // ---- answers ---------------------------------------------------------------------------------
  function speakFallback(text) {
    if (EMBED) return;
    try {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
      const u = new window.SpeechSynthesisUtterance(text);
      u.rate = 0.9;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { /* no voice: the words are on screen */ }
  }
  function speak(text) {
    if (EMBED) return;
    if (state.audio) { try { state.audio.pause(); } catch (e) { /* ignore */ } }
    post('api/tts', { text })
      .then((r) => { if (!r.ok) throw new Error('tts ' + r.status); return r.blob(); })
      .then((blob) => {
        const a = new Audio(URL.createObjectURL(blob));
        state.audio = a;
        const p = a.play();
        if (p && p.catch) p.catch(() => speakFallback(text));
      })
      .catch(() => speakFallback(text));
  }
  function onAnswer(d) {
    if (!d || !d.answer || state.seen.has(d.id)) return;
    state.seen.add(d.id);
    state.last = d;
    show(d.question || '', d.answer, false);
    speak(d.answer);
  }

  // ---- live events -----------------------------------------------------------------------------
  try {
    const es = new EventSource('api/live/events');
    es.onmessage = (m) => {
      let d;
      try { d = JSON.parse(m.data); } catch (e) { return; }
      if (!d || d.type !== 'ask') return;
      if (d.state === 'listening') listening();
      else if (d.state === 'answer') onAnswer(d);
    };
  } catch (e) { /* no live server: typing still works */ }
})();
