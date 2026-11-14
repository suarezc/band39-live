// node experiments/cards/test_card_rules.cjs
const assert = require('node:assert');
const R = require('../../care/web/js/card-rules.js');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const T0 = Date.UTC(2026, 10, 14, 18);
ok('ordinary purchases go through', () => { const c = R.everydayCard(); assert.ok(R.buy(c, { amount: 1840, shop: 'Pharmacy', category: 'pharmacy' }, T0).approved); });
ok('a purchase over $50 is declined', () => { const c = R.everydayCard(); const r = R.buy(c, { amount: 45000, shop: 'Electronics', category: 'electronics' }, T0); assert.ok(!r.approved); assert.match(r.reason, /\$50\.00 limit/); });
ok('wire transfers are declined', () => { const c = R.everydayCard(); assert.match(R.buy(c, { amount: 4000, shop: 'QuickWire', category: 'wire' }, T0).reason, /wire transfers/); });
ok('the weekly limit holds, and frees up a week later', () => {
  const c = R.everydayCard();
  for (let i = 0; i < 4; i++) assert.ok(R.buy(c, { amount: 5000, shop: 'Market', category: 'grocery' }, T0 + i * 1000).approved);
  assert.match(R.buy(c, { amount: 100, shop: 'Market', category: 'grocery' }, T0 + 5000).reason, /weekly limit/);
  assert.ok(R.buy(c, { amount: 100, shop: 'Market', category: 'grocery' }, T0 + 8 * 24 * 3600 * 1000).approved);
});
ok('a frozen card declines everything; unfreezing restores it', () => {
  const c = R.everydayCard(); R.freeze(c, 'scam alert from the band');
  const r = R.buy(c, { amount: 500, shop: 'Market', category: 'grocery' }, T0); assert.ok(!r.approved); assert.match(r.reason, /frozen: scam alert/);
  R.unfreeze(c, 'Lisa'); assert.ok(R.buy(c, { amount: 500, shop: 'Market', category: 'grocery' }, T0).approved);
});
ok('a declined purchase does not count toward the limits', () => { const c = R.everydayCard(); R.buy(c, { amount: 45000, shop: 'X', category: 'electronics' }, T0); assert.equal(R.weekSpent(c, T0), 0); });
ok('a one-time card pays once, at its kind of shop only', () => {
  const c = R.oneTimeCard(3900, 'medical', 'cane');
  assert.match(R.buy(c, { amount: 500, shop: 'Other', category: 'general' }, T0).reason, /one kind of shop/);
  assert.match(R.buy(c, { amount: 4500, shop: 'CareSupply', category: 'medical' }, T0).reason, /limit for one purchase/);
  assert.ok(R.buy(c, { amount: 3900, shop: 'CareSupply', category: 'medical' }, T0).approved);
  assert.equal(c.status, 'cancelled');
  assert.match(R.buy(c, { amount: 3900, shop: 'CareSupply', category: 'medical' }, T0 + 30 * 24 * 3600 * 1000).reason, /cancelled/);
});
console.log(`\n${n} card-rule checks passed`);
