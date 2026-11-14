/* Scam-safe card rules, simulated in our own code (no Stripe call, no real money).
 * The same rules Stripe Issuing offers: a limit per purchase and per week, blocked kinds of shop,
 * freezing, and one-time cards. Runs in a page (window.CardRules) and in Node (module.exports).
 * The real Stripe version is card_demo.py; it is blocked until Stripe opens the financial account.
 */
(function (root) {
  'use strict';
  const WEEK = 7 * 24 * 3600 * 1000;
  const money = (cents) => '$' + (cents / 100).toFixed(2);
  const BLOCKED = { wire: 'wire transfers and money orders', crypto: 'crypto and stored-value loads' };
  let serial = 4200;

  /** Margaret's everyday card. Amounts are in cents. */
  function everydayCard(opts) {
    return Object.assign({ kind: 'everyday', last4: String(++serial), status: 'active', perPurchase: 5000, weekly: 20000,
                           blocked: ['wire', 'crypto'], allowed: null, total: null, singleUse: false, frozenBecause: null, log: [] }, opts || {});
  }
  /** A card that pays one thing: this much, at this kind of shop, once. */
  function oneTimeCard(cents, category, what) {
    return { kind: 'one-time', for: what, last4: String(++serial), status: 'active', perPurchase: cents, weekly: null,
             blocked: [], allowed: [category], total: cents, singleUse: true, frozenBecause: null, log: [] };
  }
  const spent = (card, since) => card.log.filter((p) => p.approved && p.at >= since).reduce((s, p) => s + p.amount, 0);

  /** A purchase attempt -> { approved, reason }. Also written to card.log. */
  function buy(card, purchase, now) {
    const at = now == null ? Date.now() : now;
    const { amount, shop, category } = purchase;
    let reason = null;
    if (card.status === 'cancelled') reason = 'this card has been cancelled';
    else if (card.status === 'frozen') reason = 'the card is frozen: ' + (card.frozenBecause || 'waiting for family approval');
    else if (card.allowed && !card.allowed.includes(category)) reason = 'this card only works at one kind of shop';
    else if (card.blocked.includes(category)) reason = 'the card does not allow ' + (BLOCKED[category] || category);
    else if (card.perPurchase != null && amount > card.perPurchase) reason = `over the ${money(card.perPurchase)} limit for one purchase`;
    else if (card.total != null && spent(card, 0) + amount > card.total) reason = `over this card's ${money(card.total)} total`;
    else if (card.weekly != null && spent(card, at - WEEK) + amount > card.weekly) reason = `over the ${money(card.weekly)} weekly limit (${money(spent(card, at - WEEK))} spent)`;
    const entry = { at, amount, shop, category, approved: !reason, reason };
    card.log.push(entry);
    if (entry.approved && card.singleUse) card.status = 'cancelled';      // a one-time card dies after its one purchase
    return entry;
  }
  /** The band flagged a likely scam: nothing goes through until someone the family trusts approves. */
  function freeze(card, why) { if (card.status === 'active') { card.status = 'frozen'; card.frozenBecause = why; } return card; }
  function unfreeze(card, who) { if (card.status === 'frozen') { card.status = 'active'; card.frozenBecause = null; card.unfrozenBy = who; } return card; }

  const CardRules = { everydayCard, oneTimeCard, buy, freeze, unfreeze, money, weekSpent: (card, now) => spent(card, (now == null ? Date.now() : now) - WEEK) };
  if (typeof module !== 'undefined' && module.exports) module.exports = CardRules;
  else root.CardRules = CardRules;
})(typeof window !== 'undefined' ? window : globalThis);
