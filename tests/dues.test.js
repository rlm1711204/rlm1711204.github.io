// Run with:  node tests/dues.test.js
// Monthly payments you mark as paid yourself: rent due, two months together,
// part payments, paying in advance, skipping a month.
const assert = require('assert');
const mem = {};
global.localStorage = { getItem: (k) => mem[k] || null, setItem: (k, v) => { mem[k] = v; } };
const Store = require('../js/store.js');
Store.load();

const day = (s) => new Date(s + 'T10:00:00');
Store.add({ type: 'income', amount: 50000, category: 'Salary', note: 'Salary', date: '2026-10-01' });
const rent = Store.addRule({ type: 'expense', amount: 12000, category: 'Rent', note: 'House rent', day: 1, startMonth: '2026-10' });
const salary = Store.addRule({ type: 'income', amount: 50000, category: 'Salary', note: 'Salary', day: 1, startMonth: '2026-11' });
assert.strictEqual(rent.askPaid, true);          // payments ask by default
assert.strictEqual(salary.askPaid, false);       // income is added as received

// 1 Oct: rent is due, but not counted as spent
Store.applyRecurring(day('2026-10-01'));
let d = Store.dues(day('2026-10-01'));
assert.strictEqual(d.length, 1); assert.strictEqual(d[0].left, 12000);
assert.strictEqual(Store.totals('2026-10-01', '2026-10-31').expense, 0);

// not paid in October -> November shows both months together
Store.applyRecurring(day('2026-11-02'));
d = Store.dues(day('2026-11-02'));
assert.strictEqual(d.length, 1);
assert.strictEqual(d[0].bills.length, 2); assert.strictEqual(d[0].left, 24000);
assert.strictEqual(Store.duesTotal(day('2026-11-02')), 24000);
// salary (automatic) was added as a real entry
assert.strictEqual(Store.totals('2026-11-01', '2026-11-30').income, 50000);

// part payment on 3 Nov: oldest month first, counted in November (the day paid)
const p1 = Store.payDues(rent.id, 18000, '2026-11-03', 'UPI');
assert.strictEqual(p1.length, 2);                                   // all of Oct + 6000 of Nov
assert.deepStrictEqual(p1.map((t) => [t.forMonth, t.amount]), [['2026-10', 12000], ['2026-11', 6000]]);
assert.strictEqual(Store.totals('2026-10-01', '2026-10-31').expense, 0);
assert.strictEqual(Store.totals('2026-11-01', '2026-11-30').expense, 18000);
d = Store.dues(day('2026-11-03'));
assert.strictEqual(d[0].bills.length, 1); assert.strictEqual(d[0].left, 6000); assert.strictEqual(d[0].bills[0].paid, 6000);

// deleting a payment makes it due again
Store.remove(p1[1].id);
assert.strictEqual(Store.duesTotal(day('2026-11-03')), 12000);
Store.restore(p1[1].id);
assert.strictEqual(Store.duesTotal(day('2026-11-03')), 6000);

// pay the rest -> nothing due
Store.payDues(rent.id, 6000, '2026-11-05', 'UPI');
assert.strictEqual(Store.dues(day('2026-11-05')).length, 0);

// pay December and January in advance on 20 Nov
const adv = Store.payAdvance(rent.id, 2, '2026-11-20', 'UPI');
assert.deepStrictEqual(adv.months, ['2026-12', '2027-01']);
assert.strictEqual(Store.paidTill(rent, day('2026-11-20')), '2027-01');
assert.strictEqual(Store.totals('2026-11-01', '2026-11-30').expense, 48000);   // 12k Oct + 12k Nov + 24k ahead
// when December comes, nothing new is added and nothing is due
Store.applyRecurring(day('2026-12-02'));
assert.strictEqual(Store.dues(day('2026-12-02')).length, 0);
assert.strictEqual(Store.get().txns.filter((t) => t.recurId === rent.id && t.recurMonth === '2026-12').length, 1);
// February is due again
Store.applyRecurring(day('2027-02-01'));
assert.strictEqual(Store.duesTotal(day('2027-02-01')), 12000);

// skipping a month
const feb = Store.dues(day('2027-02-01'))[0].bills[0].bill;
Store.skipBill(feb.id);
assert.strictEqual(Store.dues(day('2027-02-01')).length, 0);

// a rule switched to "added as paid" behaves like before
Store.updateRule(rent.id, { askPaid: false });
Store.applyRecurring(day('2027-03-01'));
assert.strictEqual(Store.dues(day('2027-03-01')).length, 0);
assert.strictEqual(Store.totals('2027-03-01', '2027-03-31').expense, 12000);

// two phones: the same bill is never added twice
const a = JSON.parse(JSON.stringify(Store.get())), b = JSON.parse(JSON.stringify(Store.get()));
const merged = Store.merge(a, b);
assert.strictEqual(merged.txns.length, Store.get().txns.length);
console.log('dues ok');
