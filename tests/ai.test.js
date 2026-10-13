// Run with:  node tests/ai.test.js
// Splitting an itemised bill into entries that add up exactly to the bill.
const assert = require('assert');
const mem = {};
global.self = global;
global.localStorage = { getItem: (k) => mem[k] || null, setItem: (k, v) => { mem[k] = v; } };
require('../js/ai.js');
const AI = global.AI;
const cats = ['Groceries', 'Food', 'Home', 'Other', 'Other income'];
const sum = (xs) => Math.round(xs.reduce((s, x) => s + x.amount, 0) * 100) / 100;

// The Instamart order from the screenshot: Basa fish (₹179) was unavailable, so not an item.
const r = AI._tidy({ kind: 'bill', entries: [{ date: '2026-10-12', amount: 492, direction: 'out', merchant: 'Instamart', description: 'Groceries', category: 'Groceries', head: 'need', mode: 'UPI', gst: 0, items: [
  { name: '1 x Daily Apple', qty: 1, amount: 94, category: 'Groceries', head: 'need' },
  { name: 'Peeled Garlic (Uritha Poondu)', qty: 1, amount: 60, category: 'Groceries', head: 'need' },
  { name: 'India Gate Everyday Basmati Rice | Fluffy...', qty: 1, amount: 90, category: 'Groceries', head: 'need' },
  { name: 'NOICE Whole Wheat bread (Zero Maida)', qty: 1, amount: 45, category: 'Groceries', head: 'need' },
  { name: 'NOICE Fresh Malai Paneer', qty: 1, amount: 109, category: 'Groceries', head: 'need' },
  { name: 'Scotch-Brite Scrub Sponge (Pack of 5)', qty: 1, amount: 81, category: 'Home', head: 'need' },
  { name: 'Arokya Full Cream Milk', qty: 1, amount: 1, category: 'Groceries', head: 'need' },
] }] }, cats);
const parts = AI.splitBill(r.entries[0]);
assert.strictEqual(parts.length, 8);                         // 7 items + fees
assert.strictEqual(parts[0].name, 'Daily Apple');            // "1 x" removed
assert.strictEqual(parts[2].name, 'India Gate Everyday Basmati Rice | Fluffy'); // trailing "..." removed
const fee = parts[parts.length - 1];
assert.ok(fee.isFee); assert.strictEqual(fee.amount, 12);    // 16 delivery + 11.98 handling − 16 discount, rounded to ₹492
assert.strictEqual(fee.category, 'Groceries'); assert.strictEqual(fee.head, 'need');
assert.strictEqual(sum(parts), 492);                         // adds up exactly to the Grand Total

// Discount bigger than fees: prices shrink in proportion, still exact.
const d = AI.splitBill({ amount: 450, items: [{ name: 'A', amount: 300, category: 'Food', head: 'want' }, { name: 'B', amount: 200, category: 'Food', head: 'want' }] });
assert.strictEqual(d.length, 2); assert.strictEqual(sum(d), 450); assert.strictEqual(d[0].amount, 270);

// Odd paise still exact
const o = AI.splitBill({ amount: 100, items: [{ name: 'A', amount: 33.33 }, { name: 'B', amount: 33.33 }, { name: 'C', amount: 40 }] });
assert.strictEqual(sum(o), 100);

// No items -> nothing to split
assert.deepStrictEqual(AI.splitBill({ amount: 50, items: [] }), []);

// Key choice
AI.addGeminiKey('AIzaKEYONE_aaaaaaaaaaaaaaaa'); AI.addGeminiKey('AIzaKEYTWO_bbbbbbbbbbbbbbbb');
assert.strictEqual(AI.pickedKey(), 0);                       // Auto
AI.pickKey(2); assert.strictEqual(AI.pickedKey(), 2);
AI.removeGeminiKey(1); assert.strictEqual(AI.pickedKey(), 0); // chosen key removed -> back to Auto
console.log('ai split & key choice ok');
