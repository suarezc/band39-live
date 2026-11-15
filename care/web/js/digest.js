/* Band 39 care · Today's summary for Lisa (server/digest.py).
 * Once a day the server condenses what the band heard into points for Lisa and for Dr. Patel,
 * reminders, flags and (only when a need is clear) HSA/FSA products. This block shows the saved
 * digest (GET api/digest), can build it now (POST api/digest/run), copies the doctor's part as plain
 * text and pays for checked products through the existing api/checkout route.
 * Everything from the server goes in with textContent: transcripts are untrusted.
 */
(function () {
  'use strict';
  const carer = document.querySelector('.carer');
  if (!carer) return;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (cls, text, fn) => { const b = el('button', 'pill ' + cls, text); b.type = 'button'; b.onclick = fn; return b; };
  const ELIG = { eligible: 'HSA/FSA eligible', lmn: 'Needs a doctor’s letter', dual: 'Dual use: may need a letter' };
  const FLAG = { scam: 'Possible scam', distress: 'Call for help', fall: 'Possible fall', medication: 'Medication' };
  const money = (n) => '$' + (Math.round(n) === n ? n : n.toFixed(2));
  const price = (r) => (r && r.length ? (r.length > 1 && r[1] !== r[0] ? `${money(r[0])}–${money(r[1])}` : money(r[0])) : '');

  const wrap = el('div', 'block digest'); wrap.setAttribute('aria-label', "Today's summary");
  const head = el('div', 'dg-head');
  const title = el('div', 'h', 'Today’s summary '); title.append(el('span', 'muted', '· made each night from Mom’s band'));
  const runBtn = btn('violet dg-small', 'Run tonight’s summary now', () => runNow());
  head.append(title, runBtn);
  const body = el('div', 'dg-body');
  const status = el('p', 'fine dg-status'); status.setAttribute('aria-live', 'polite');
  wrap.append(head, status, body);
  const anchor = carer.querySelector('.live-tx') || carer.querySelector('.scores') || carer.querySelector('.cg-head');
  if (anchor) anchor.after(wrap); else carer.append(wrap);

  let digest = null, busy = false;

  function doctorText(d) {
    const lines = [`Summary for Dr. Patel, ${d.date} (from Mom’s everyday speech, recorded by her band)`];
    for (const p of d.for_doctor.points) lines.push('- ' + p.text);
    const flags = (d.flags || []).filter((f) => f.kind !== 'scam');
    for (const f of flags) lines.push(`- ${FLAG[f.kind] || f.kind}: ${f.text}`);
    if (lines.length === 1) lines.push('- Nothing of health relevance was noted today.');
    lines.push(d.for_doctor.caveat || 'Signals from everyday speech, not a diagnosis.');
    return lines.join('\n');
  }

  function section(name, items) {
    const s = el('div', 'dg-sec'); s.append(el('div', 'dg-name', name));
    if (items) { const ul = el('ul', 'dg-list'); for (const it of items) ul.append(it); s.append(ul); }
    return s;
  }
  const li = (text, cls) => el('li', cls || '', text);
  // a section folded behind its name and count (closed)
  function folded(sec, label) {
    const d = el('details', 'dg-sec dg-fold'); const s = el('summary', 'dg-name', label);
    const name = sec.querySelector('.dg-name'); if (name) name.remove();
    d.append(s, ...sec.childNodes); return d;
  }

  function render() {
    body.textContent = '';
    runBtn.disabled = busy;
    const d = digest;
    if (!d || !d.date) {
      body.append(el('p', 'empty', 'No summary yet for today.'));
      return;
    }
    const c = d.coverage || {};
    const when = d.generated_at ? new Date(d.generated_at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
    body.append(el('p', 'dg-headline', d.for_caregiver.headline));

    if (d.for_caregiver.points.length) body.append(folded(section('For you', d.for_caregiver.points.map((p) => li(p.text))), 'For you · ' + d.for_caregiver.points.length));

    const doc = section('For Dr. Patel', d.for_doctor.points.length ? d.for_doctor.points.map((p) => li(p.text)) : [li('Nothing of health relevance today.', 'muted')]);
    doc.append(el('p', 'fine', d.for_doctor.caveat));
    const copied = el('span', 'fine dg-copied');
    const copy = btn('dg-small', 'Copy for the doctor', async () => {
      const text = doctorText(d);
      try { await navigator.clipboard.writeText(text); copied.textContent = 'Copied.'; }
      catch (_) { copied.textContent = 'Copy did not work here; select the text below.'; pre.hidden = false; }
    });
    const pre = el('pre', 'dg-pre', doctorText(d)); pre.hidden = true;
    const row = el('div', 'dg-row'); row.append(copy, copied);
    doc.append(row, pre);
    body.append(folded(doc, 'For Dr. Patel · ' + d.for_doctor.points.length));

    if (d.reminders.length) body.append(folded(section('Reminders', d.reminders.map((r) => { const x = li(''); x.append(el('b', '', r.what), document.createTextNode(' · ' + r.when)); return x; })), 'Reminders · ' + d.reminders.length));

    if (d.flags.length) {
      body.append(section('Flags', d.flags.map((f) => {
        const x = li('', 'dg-flag'); x.dataset.kind = f.kind;
        x.append(el('b', '', `${FLAG[f.kind] || f.kind} ${Math.round(f.probability * 100)}%`)); x.title = f.text; x.tabIndex = 0;
        return x;
      })));
      const fl = body.lastChild && body.lastChild.querySelector('.dg-list'); if (fl) fl.classList.add('dg-flags');
    }

    const shop = section('Suggested products');
    if (!d.recommended.length) shop.append(el('p', 'empty', 'Nothing to suggest today.'));
    else {
      const ul = el('ul', 'dg-prods');
      for (const r of d.recommended) {
        const x = el('li', 'dg-prod');
        const box = el('input'); box.type = 'checkbox'; box.dataset.product = r.product_id; box.setAttribute('aria-label', 'Choose ' + r.name);
        const info = el('div');
        const top = el('div', 'dg-ptop'); const chip = el('span', 'dg-elig', ELIG[r.eligibility] || r.eligibility_label || r.eligibility); chip.dataset.elig = r.eligibility; if (r.eligibility_label) chip.title = r.eligibility_label;
        top.append(el('b', '', r.name), chip, el('span', 'dg-price', price(r.price_usd)));
        info.append(top, el('div', 'fine', r.why));
        if (r.evidence_quote) info.append(el('q', 'dg-quote', r.evidence_quote));
        x.append(box, info); ul.append(x);
      }
      const note = el('span', 'fine dg-paynote');
      const pay = btn('dark', 'Pay with Stripe', () => payNow(note));
      const foot = el('div', 'dg-row'); foot.append(pay, note);
      shop.append(ul, foot, el('p', 'fine dg-elignote', 'Eligibility depends on the plan; items marked LMN need a doctor’s letter.'));
    }
    body.append(shop);

    const meta = el('p', 'fine dg-meta');
    meta.textContent = `Made from ${c.phrases || 0} phrases; ${c.uncertain || 0} were probably Mom but not certain.` + (when ? ` Generated ${when}.` : '');
    body.append(meta);
    if (d.errors && d.errors.length) body.append(el('p', 'fine dg-err', 'Partly made: ' + d.errors.join(' ')));
  }

  async function payNow(note) {
    const ids = [...body.querySelectorAll('input[data-product]:checked')].map((i) => i.dataset.product);
    const items = digest.recommended.filter((r) => ids.includes(r.product_id)).map((r) => ({ id: r.product_id, name: r.name, price: (r.price_usd || [0])[0], qty: 1 }));
    if (!items.length) { note.textContent = 'Tick at least one product.'; return; }
    note.textContent = 'Opening Stripe…';
    try {
      const r = await fetch('api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, origin: location.origin }) });
      const j = await r.json();
      if (j.url) { location.href = j.url; return; }
      note.textContent = j.message || j.error || 'Checkout is not available.';
    } catch (_) { note.textContent = 'Could not reach the server.'; }
  }

  async function load() {
    try {
      const r = await fetch('api/digest');
      digest = r.ok ? await r.json() : null;
      status.textContent = '';
    } catch (_) { digest = null; status.textContent = 'Could not reach the server.'; }
    render();
  }

  async function runNow() {
    if (busy) return;
    busy = true; status.textContent = 'Reading today’s transcript… this takes about ten seconds.'; render();
    try {
      const r = await fetch('api/digest/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json();
      if (r.ok && j.date) { digest = j; status.textContent = ''; } else status.textContent = 'The summary could not be made (' + (j.error || r.status) + ').';
    } catch (_) { status.textContent = 'Could not reach the server.'; }
    busy = false; render();
  }

  window.VexoDigest = { get digest() { return digest; }, load, runNow, doctorText };
  render();
  load();
})();
