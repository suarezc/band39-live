/* Band 39 care · Mom's safe card (Lisa's side).
 * A card with limits that freezes when the care engine raises a scam alert, and one-time cards for
 * the care shop. The card is SIMULATED in this page (js/card-rules.js): no Stripe call, no real money.
 * It listens to the care engine (alerts with key "scam") and adds nothing to app.js.
 * Plan and screens: mockups/financial-ui.html. Real cards: experiments/cards/card_demo.py (Stripe Issuing).
 */
(function () {
  'use strict';
  const R = window.CardRules;
  const care = window.VexoCare;
  const body = document.getElementById('moneyBody');
  if (!R || !care || !body) return;
  const engine = care.engine;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  let card = R.everydayCard();
  let once = null;                        // the latest one-time card
  let evidence = '';                      // why the card is frozen, in Lisa's words
  let lastScam = '';                      // the scam alert already acted on
  let busy = false;

  // ---- the care engine says "possible scam" -> freeze ---------------------------------------
  engine.subscribe(() => {
    if (busy) return;
    const a = engine.state.alerts.find((x) => x.key === 'scam');
    if (!a) return;
    const stamp = a.id + ':' + a.at;
    if (stamp === lastScam) return;
    lastScam = stamp;
    if (card.status !== 'active') return;
    R.freeze(card, 'possible scam');
    evidence = a.body || a.title;
    later(() => engine.note('💳', 'Mom’s card was frozen by the scam alert. Nothing can be charged until you unfreeze it.', 'money'));
    render();
  });
  // Calls back into the engine must wait until it has finished telling everyone about the current change.
  function later(fn) { setTimeout(() => { busy = true; try { fn(); } finally { busy = false; } render(); }, 0); }

  // ---- what Lisa can do ----------------------------------------------------------------------
  function freezeByLisa() { R.freeze(card, 'frozen by Lisa'); evidence = 'You froze the card.'; later(() => engine.note('💳', 'Lisa froze Mom’s card.', 'money')); }
  function unfreeze() {
    R.unfreeze(card, 'Lisa'); evidence = '';
    later(() => { engine.note('💳', 'Lisa unfroze Mom’s card.', 'money'); engine.sendMessage('Your card is working again 💛', 'Lisa'); });
  }
  function callMom() { later(() => engine.sendMessage('I’m calling you now 📞', 'Lisa')); }
  function buy(amount, shop, category) {
    const r = R.buy(card, { amount, shop, category });
    later(() => engine.note('💳', r.approved ? `Card: ${R.money(amount)} at ${shop}.` : `Card declined ${R.money(amount)} at ${shop}: ${r.reason}.`, 'money'));
  }
  function payOnce() {
    const ids = [...document.querySelectorAll('#shop input[data-pick]:checked')].map((i) => i.dataset.pick);
    const items = (window.VexoCatalog ? window.VexoCatalog.PRODUCTS : []).filter((p) => ids.includes(p.id));
    if (!items.length) return;
    const cents = items.reduce((t, p) => t + p.price, 0) * 100;
    once = R.oneTimeCard(cents, 'medical', items.map((p) => p.name).join(' + '));
    const r = R.buy(once, { amount: cents, shop: 'CareSupply Medical', category: 'medical' });
    later(() => engine.note('💳', r.approved ? `Paid ${R.money(cents)} to CareSupply Medical with a one-time card. The card closed itself.` : `One-time card declined: ${r.reason}.`, 'money'));
  }
  function chargeAgain() { if (once) { R.buy(once, { amount: once.total, shop: 'CareSupply Medical (charged again)', category: 'medical' }); render(); } }

  // ---- drawing -------------------------------------------------------------------------------
  function paycard(c, cls, who, sub, state) {
    const box = el('div', 'paycard ' + cls);
    box.append(el('span', 'st', state), el('div', 'who', who));
    const num = el('div', 'num', '•••• •••• •••• ' + c.last4);
    box.append(num, el('div', 'who', sub));
    return box;
  }
  function btn(cls, text, fn) { const b = el('button', 'pill ' + cls, text); b.type = 'button'; b.onclick = fn; return b; }
  function txList(log) {
    const ul = el('ul', 'money-tx');
    for (const p of log.slice(-5).reverse()) {
      const li = el('li');
      li.append(el('span', 'bd ' + (p.approved ? 'y' : 'n'), p.approved ? 'PAID' : 'DECLINED'), el('span', '', p.shop), el('b', '', R.money(p.amount)));
      if (!p.approved) li.append(el('span', 'why', p.reason.charAt(0).toUpperCase() + p.reason.slice(1) + '.'));
      ul.append(li);
    }
    return ul;
  }
  function render() {
    body.textContent = '';
    const frozen = card.status === 'frozen';
    const spent = R.weekSpent(card);
    if (frozen) {
      const a = el('div', 'money-alert');
      a.append(el('b', '', card.frozenBecause === 'possible scam' ? '⚠ Possible scam: card frozen' : 'Card frozen'), el('div', '', evidence));
      body.append(a);
    }
    body.append(paycard(card, frozen ? 'frozen' : '', 'Margaret · everyday card', frozen ? 'Frozen: nothing can be charged' : `${R.money(card.weekly - spent)} left this week`, frozen ? 'FROZEN' : 'ACTIVE'));
    const meter = el('div', 'money-meter'); const bar = el('i'); bar.style.width = Math.min(100, spent / card.weekly * 100) + '%'; meter.append(bar);
    const row = el('div', 'money-row'); row.append(el('span', '', `${R.money(spent)} of ${R.money(card.weekly)} used this week`), el('span', '', 'simulated card'));
    const chips = el('div', 'money-chips');
    for (const c of [`${R.money(card.perPurchase)} per purchase`, `${R.money(card.weekly)} a week`, 'no wires', 'no crypto', 'freezes on scam alert']) chips.append(el('span', '', c));
    const btns = el('div', 'money-btns');
    if (frozen) btns.append(btn('dark', '📞 Call Mom', callMom), btn('green', 'It’s fine, unfreeze', unfreeze));
    else btns.append(btn('', 'Freeze card', freezeByLisa));
    body.append(meter, row, chips, btns);
    if (card.log.length) body.append(txList(card.log));
    if (once) {
      const used = once.status === 'cancelled';
      body.append(paycard(once, 'once', 'One-time card · ' + once.for, `${R.money(once.total)} · medical supply shops · one purchase`, used ? 'USED · CLOSED' : 'ACTIVE'));
      if (used) { const ok = el('div', 'money-ok'); ok.append(el('b', '', `Paid ${R.money(once.total)} to CareSupply Medical`), el('div', '', 'This card closed itself after the payment, so nobody can charge it again.')); body.append(ok); }
      body.append(txList(once.log));
      const b2 = el('div', 'money-btns'); b2.append(btn('', 'Demo: the shop charges it again', chargeAgain)); body.append(b2);
    }
  }

  // ---- buttons outside the block -------------------------------------------------------------
  const foot = document.getElementById('shopFoot');
  if (foot) foot.append(btn('violet', 'Pay with a one-time card', payOnce));
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-buy], [data-card]'); if (!t) return;
    if (t.dataset.buy) { const [amount, shop, category] = t.dataset.buy.split('|'); buy(Number(amount), shop, category); }
    else if (t.dataset.card === 'scam') setTimeout(() => engine.raise('urgent', 'Possible scam: unknown voice', 'The band heard a voice that isn’t Mom’s asking her to buy gift cards and read out the numbers. Call Mom before she pays anyone.', 'scam'), 0);
  });

  window.VexoMoney = { get card() { return card; }, get once() { return once; }, render };
  render();
})();
