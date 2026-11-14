/* Band 39 · care shop catalog: HSA/FSA-eligible equipment matched to what the band noticed.
 * Generic product types with typical prices (USD), not endorsements. Eligibility is general
 * guidance: "hsa" = generally HSA/FSA eligible; "lmn" = usually needs a Letter of Medical
 * Necessity from a clinician. Plans differ, so the checkout says so too.
 */
(function (root) {
  'use strict';
  const PRODUCTS = [
    { id: 'spoon',    for: ['tremor'],              name: 'Tremor-stabilizing spoon',        price: 195, elig: 'lmn', icon: '🥄', why: 'Cancels hand shake while eating, so meals stay independent.' },
    { id: 'utensils', for: ['tremor'],              name: 'Weighted utensil set',            price: 34,  elig: 'hsa', icon: '🍴', why: 'Extra weight damps small tremors at the table.' },
    { id: 'cuff',     for: ['tremor'],              name: 'Weighted wrist cuffs',            price: 26,  elig: 'hsa', icon: '🎗️', why: 'Light wrist weights steady writing and buttoning.' },
    { id: 'rollator', for: ['balance', 'fall'],     name: 'Rollator walker with seat',       price: 119, elig: 'hsa', icon: '🦽', why: 'Four wheels, brakes and a seat for rests on longer walks.' },
    { id: 'cane',     for: ['balance'],             name: 'Quad-base cane',                  price: 39,  elig: 'hsa', icon: '🦯', why: 'A wider base when the gait gets irregular.' },
    { id: 'hip',      for: ['fall'],                name: 'Hip protector briefs',            price: 49,  elig: 'hsa', icon: '🛡️', why: 'Padding that lowers hip-fracture risk if another fall happens.' },
    { id: 'shower',   for: ['fall', 'balance'],     name: 'Shower chair with back',          price: 45,  elig: 'hsa', icon: '🚿', why: 'Sit, don’t stand, on wet floors.' },
    { id: 'bedalarm', for: ['wander', 'sleep'],     name: 'Bed-exit alarm pad',              price: 59,  elig: 'lmn', icon: '🛏️', why: 'A gentle chime when she gets up at night, before she wanders.' },
    { id: 'seizmat',  for: ['seizure'],             name: 'Seizure-alert bed monitor',       price: 199, elig: 'lmn', icon: '📟', why: 'Watches for rhythmic jerking at night and calls for help.' },
    { id: 'helmet',   for: ['seizure', 'fall'],     name: 'Soft protective headgear',        price: 89,  elig: 'lmn', icon: '⛑️', why: 'Protects the head during a seizure or fall.' },
    { id: 'seaband',  for: ['nausea'],              name: 'Acupressure wristbands (nausea)', price: 12,  elig: 'hsa', icon: '〰️', why: 'Drug-free help with nausea from new medicines.' },
    { id: 'pillbox',  for: ['meds'],                name: 'Alarm pill dispenser',            price: 69,  elig: 'hsa', icon: '💊', why: 'Opens and beeps at pill time; works with the band’s reminder.' },
  ];
  const CONDITIONS = {
    tremor:  { label: 'Hand tremor',            doctor: 'Rest tremor at {hz} Hz (score {score}/4) for {min} min today. Consider a movement-disorder review.' },
    balance: { label: 'Unsteady walking',       doctor: 'Gait regularity fell to {score}/100 on recent walks. Consider a PT/fall-risk assessment.' },
    fall:    { label: 'A fall',                 doctor: 'Probable fall at {time} (impact {g} g){answered}. Check for injury and review fall risk.' },
    wander:  { label: 'Night walking',          doctor: '{n} night-walking episode(s), longest {min} min. Consider sleep and medication review.' },
    sleep:   { label: 'Restless sleep',         doctor: 'Restless night: {pct}% of epochs scored awake (Cole–Kripke actigraphy).' },
    seizure: { label: 'Seizure-like movement',  doctor: 'Rhythmic {hz} Hz high-amplitude movement for ≥{s} s at {time}. Not EEG-confirmed; please review urgently.' },
    nausea:  { label: 'Nausea (she said so)',   doctor: 'Margaret reported nausea in a voice note.' },
    meds:    { label: 'Missed pills',           doctor: 'Pill reminders unconfirmed: {which}.' },
  };
  const ELIG = { hsa: 'HSA/FSA eligible', lmn: 'HSA/FSA with a doctor’s letter (LMN)' };
  const forConditions = (conds) => PRODUCTS.filter((p) => p.for.some((c) => conds.includes(c)));
  const VexoCatalog = { PRODUCTS, CONDITIONS, ELIG, forConditions };
  if (typeof module !== 'undefined' && module.exports) module.exports = VexoCatalog;
  else root.VexoCatalog = VexoCatalog;
})(typeof window !== 'undefined' ? window : globalThis);
