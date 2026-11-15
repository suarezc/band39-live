/* Band 39 care · demo layout for Lisa's column. Runs last, after every module has inserted its block.
 * Only moves existing nodes (ids, classes and handlers stay as they are); any missing block is skipped.
 * Order: header, Alerts, Mom's safe card, Live transcript, Today's summary, the two scores, then one
 * collapsed "More" holding the shop, Dr. Patel, Messages, Today and the band-free tools.
 */
(function () {
  'use strict';
  const card = document.querySelector('.carer .l-card');
  if (!card) return;
  const head = card.querySelector('.cg-head');
  const blockOf = (sel) => { const n = card.querySelector(sel); return n ? (n.matches('.block, .scores') ? n : n.closest('.block')) : null; };
  const lead = [
    blockOf('#cgAlerts'),
    card.querySelector('.block.money'),
    card.querySelector('.live-tx'),
    card.querySelector('.digest'),
    card.querySelector('.scores'),
  ].filter(Boolean);
  let at = head && head.parentNode === card ? head : null;
  for (const b of lead) {
    if (at) at.after(b); else card.prepend(b);
    at = b;
  }
  const rest = [
    blockOf('#shop'),
    card.querySelector('.block.doc'),
    blockOf('#cgThread'),
    blockOf('#cgTimeline'),
    document.getElementById('demo'),
  ].filter((b) => b && card.contains(b) && !lead.includes(b));
  if (!rest.length) return;
  const more = document.createElement('details');
  more.className = 'block cg-more';
  const sum = document.createElement('summary');
  sum.textContent = 'More';
  const bodyEl = document.createElement('div');
  bodyEl.className = 'cg-more-body';
  more.append(sum, bodyEl);
  for (const b of rest) bodyEl.append(b);
  card.append(more);
})();
