/* =====================================================================
 * app.js — the screens. Connects typing, scanning, lists, reports,
 * people balances, settings and Google Drive sync together.
 * ===================================================================== */
(function () {
  'use strict';

  const APP_VERSION = '1.16.1';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const inr = (n) => (n < 0 ? '−' : '') + '₹' + Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  /** Short Indian amounts for small tiles: ₹1.65 L, ₹2.1 Cr (smaller amounts in full). */
  const inrShort = (n) => {
    const a = Math.abs(n), sign = n < 0 ? '−' : '';
    if (a >= 1e7) return sign + '₹' + +(a / 1e7).toFixed(2) + ' Cr';
    if (a >= 1e5) return sign + '₹' + +(a / 1e5).toFixed(2) + ' L';
    return inr(Math.round(n));
  };
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const todayIso = () => iso(new Date());
  const monthStart = (y, m) => iso(new Date(y, m, 1));
  const monthEnd = (y, m) => iso(new Date(y, m + 1, 0));
  const monthName = (y, m, short) => new Date(y, m, 1).toLocaleString('en-IN', { month: short ? 'short' : 'long', year: 'numeric' });
  const niceDate = (s) => {
    const d = new Date(s + 'T00:00:00');
    const t = todayIso();
    if (s === t) return 'Today';
    if (s === iso(new Date(Date.now() - 864e5))) return 'Yesterday';
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  };
  const INFLOW = new Set(['income', 'borrowed', 'got_back']);
  const IS_IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const IS_STANDALONE = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ordinal = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
  const shortDate = (s) => new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const curYm = () => todayIso().slice(0, 7);
  /** "Oct" (or "Oct 2025" for another year / when asked) for a "YYYY-MM". */
  const monthShort = (ym, withYear) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString('en-IN', withYear || y !== new Date().getFullYear() ? { month: 'short', year: 'numeric' } : { month: 'short' });
  };

  /* ---------- Toast (small message at the bottom) ---------------------- */
  let toastTimer;
  function toast(msg, actionLabel, action) {
    const t = $('#toast');
    t.innerHTML = '<span>' + esc(msg) + '</span>' + (actionLabel ? '<button>' + esc(actionLabel) + '</button>' : '');
    t.hidden = false;
    if (actionLabel) $('button', t).onclick = () => { t.hidden = true; action(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, actionLabel ? 6000 : 3000);
  }

  function download(name, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    // iPhone: saving files works best through the Share sheet ("Save to Files", WhatsApp, Mail…)
    if (IS_IOS && navigator.canShare) {
      const file = new File([blob], name, { type: mime || blob.type });
      if (navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: name }).catch(() => {}); return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- Private entries ------------------------------------------ */
  // While locked, private entries are left out of lists (totals still count them).
  const isLocked = () => Store.isMasked();
  const hasPrivate = () => Store.active().some((t) => t.private);
  const visibleList = (list) => (isLocked() ? list.filter((t) => !t.private) : list);
  const lockedRow = (n) => (n ? `<button class="row locked-row" data-unlock><span class="ico">🔒</span><span class="what"><b>${n} private ${n === 1 ? 'entry' : 'entries'} hidden</b><span>Tap to unlock with your PIN</span></span></button>` : '');
  document.addEventListener('click', (e) => { if (e.target.closest('[data-unlock]')) Lock.unlockPrivate(); });
  /** Rows shown together in one rounded card, with thin lines between them. */
  const group = (html) => (html ? '<div class="group">' + html + '</div>' : '');

  /** Open a folded Settings section and scroll to it. */
  function openCard(id) {
    const el = $('#' + id);
    if (el.tagName === 'DETAILS') el.open = true;
    setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
  }
  /** Before a download that would show private entries: unlock first. */
  async function okToExport() {
    if (!isLocked() || !hasPrivate()) return true;
    return Lock.unlockPrivate('Enter your PIN — this file includes your private entries.');
  }

  /* ---------- Navigation (uses #hash so the phone's Back button works) - */
  const VIEWS = ['home', 'history', 'people', 'reports', 'settings'];
  let current = 'home';
  function show(view) {
    if (!VIEWS.includes(view)) view = 'home';
    current = view;
    VIEWS.forEach((v) => { $('#view-' + v).hidden = v !== view; });
    $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.go === view));
    $('#view-title').textContent = $('#view-' + view).dataset.title;
    render();
    window.scrollTo(0, 0);
  }
  function go(view) { if (location.hash !== '#' + view) location.hash = view === 'home' ? '' : view; else show(view); }
  window.addEventListener('hashchange', () => show(location.hash.slice(1) || 'home'));
  // the top bar gets a background once the page scrolls under it
  window.addEventListener('scroll', () => $('.topbar').classList.toggle('scrolled', window.scrollY > 8), { passive: true });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (b) go(b.dataset.go);
    const c = e.target.closest('[data-close]');
    if (c) c.closest('dialog').close();
  });

  /* ---------- Rings (Money left, budget heads) ------------------------- */
  /** A round progress ring. parts: [{ frac, cls }] drawn one after another. */
  function ring(parts, size, stroke, center) {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    let start = 0;
    const arcs = parts.filter((p) => p.frac > 0.001).map((p) => {
      const len = Math.min(p.frac, 1 - start) * c;
      const el = `<circle class="arc ${p.cls}" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" stroke-dasharray="${len} ${c}" stroke-dashoffset="${-start * c}"/>`;
      start = Math.min(1, start + p.frac);
      return el;
    }).join('');
    return `<svg class="ring-svg" viewBox="0 0 ${size} ${size}" style="width:${size}px;height:${size}px"><g transform="rotate(-90 ${size / 2} ${size / 2})">
      <circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>${arcs}</g></svg><span class="ring-center">${center}</span>`;
  }

  /* ---------- Rows (one record in a list) ------------------------------ */
  const ICO_TONE = { expense: 'out', income: 'in', saving: 'save', lent: 'ppl', borrowed: 'ppl', got_back: 'ppl', paid_back: 'ppl' };
  function describe(t) {
    const who = esc(t.person);
    switch (t.type) {
      case 'lent': return { title: 'Gave ' + who, sub: t.note ? esc(t.note) : 'They owe you' };
      case 'borrowed': return { title: 'Took from ' + who, sub: t.note ? esc(t.note) : 'You owe them' };
      case 'got_back': return { title: who + ' paid back', sub: t.note ? esc(t.note) : 'Money returned to you' };
      case 'paid_back': return { title: 'Paid back ' + who, sub: t.note ? esc(t.note) : 'You returned money' };
      default: return { title: esc(t.note || t.category), sub: esc(t.category) + (t.type === 'expense' && t.person ? ' · 🎁 ' + who : '') };
    }
  }
  function rowHTML(t, opts) {
    const d = describe(t);
    const sub = [t.private ? '🔒' : '', t.member ? '👤 ' + esc(t.member) : '', d.sub, t.forMonth ? '🔁 for ' + monthShort(t.forMonth) : t.recurId ? '🔁 monthly' : '', t.mode ? esc(t.mode) : '', opts && opts.showDate ? niceDate(t.date) : ''].filter(Boolean).join(' · ');
    const inflow = INFLOW.has(t.type);
    return `<button class="row" data-id="${t.id}">
      <span class="ico ${t.masked ? 'lock' : ICO_TONE[t.type] || ''}">${t.masked ? '🔒' : Parser.iconFor(t.type, t.category)}</span>
      <span class="what"><b>${d.title}</b><span>${sub}</span></span>
      <span class="amt ${inflow ? 'in' : ''}">${inflow ? '+' : '−'}${inr(t.amount)}${t.type === 'saving' ? '<small>saved</small>' : ''}</span>
    </button>`;
  }
  document.addEventListener('click', (e) => {
    const r = e.target.closest('.row[data-id]');
    if (r) {
      const t = Store.get().txns.find((x) => x.id === r.dataset.id);
      if (!t) return;
      if (t.private && isLocked()) {
        const sheetOpen = $('#person-sheet').open;
        Lock.unlockPrivate().then((ok) => { if (ok) { if (sheetOpen) $('#person-sheet').close(); openSheet({ mode: 'edit', rec: t }); } });
        return;
      }
      openSheet({ mode: 'edit', rec: t });
    }
  });

  /* =====================================================================
   * DUES — monthly payments (rent…) you mark as paid yourself.
   * Unpaid months add up; pay all, one month or any part; pay ahead.
   * ===================================================================== */
  function renderDues() {
    const ds = Store.dues();
    $('#dues-card').hidden = !ds.length;
    if (!ds.length) return;
    const today = todayIso();
    $('#dues-total').textContent = inr(Math.round(Store.duesTotal()));
    $('#dues-list').innerHTML = ds.map((g) => {
      const late = g.since < today;
      const months = g.bills.map((x) => monthShort(x.bill.recurMonth) + ' ' + inr(x.left) + (x.paid ? ' (' + inr(x.paid) + ' paid)' : '')).join(' · ');
      return `<div class="due-row ${late ? 'late' : ''}">
        <span class="ico out">${Parser.iconFor(g.type, g.category)}</span>
        <span class="what"><b>${esc(g.note || g.category)}${g.bills.length > 1 ? ' · ' + g.bills.length + ' months' : ''}</b><span>${months}</span>
          <span class="due-when">${late ? '⚠️ Overdue since ' + shortDate(g.since) : 'Due today'}</span></span>
        <span class="due-side"><b>${inr(g.left)}</b><button type="button" class="btn sm primary" data-pay="${esc(g.ruleId)}">Pay</button></span>
      </div>`;
    }).join('');
  }

  const paySheet = $('#pay-sheet');
  let payState = null;   // { mode: 'due' | 'advance', ruleId, total, n }
  const ruleById = (id) => Store.rules().find((x) => x.id === id);
  function payCheck() {
    const amt = parseFloat($('#pay-amount').value) || 0;
    const note = $('#pay-note');
    $('#pay-go').disabled = false;
    note.className = 'small pay-note';
    if (payState.mode === 'advance') { note.textContent = ''; return; }
    const g = Store.dues().find((x) => x.ruleId === payState.ruleId);
    if (!g) return;
    if (amt > g.left + 0.5) {
      note.textContent = 'That is more than the ' + inr(g.left) + ' due. To pay next months too, pay this first, then use "Pay in advance".';
      note.classList.add('neg-ink'); $('#pay-go').disabled = true;
    } else if (amt > 0 && amt < g.left - 0.5) {
      // what stays due after this part payment (oldest month is paid first)
      let rest = amt; const still = [];
      for (const x of g.bills) { const a = Math.min(rest, x.left); rest -= a; if (x.left - a >= 0.5) still.push(monthShort(x.bill.recurMonth) + ' ' + inr(Math.round((x.left - a) * 100) / 100)); }
      note.textContent = 'Part payment — still due after this: ' + still.join(' · ') + '.';
    } else note.textContent = amt > 0 ? 'This clears everything due for ' + (g.note || g.category) + ' ✓' : '';
    $('#pay-go').textContent = amt > 0 ? 'Pay ' + inr(amt) : 'Pay';
  }
  function openPay(ruleId) {
    const g = Store.dues().find((x) => x.ruleId === ruleId);
    if (!g) { toast('Nothing is due for this one now.'); return; }
    const rule = ruleById(ruleId);
    payState = { mode: 'due', ruleId, total: g.left };
    $('#pay-title').textContent = 'Pay ' + (g.note || g.category);
    $('#pay-info').innerHTML = `<div class="pay-list">${g.bills.map((x) => `<div class="pay-month"><span>${monthShort(x.bill.recurMonth, true)}${x.paid ? ' <small>· ' + inr(x.paid) + ' already paid</small>' : ''}</span><b>${inr(x.left)}</b></div>`).join('')}
      ${g.bills.length > 1 ? `<div class="pay-month total"><span>Total due</span><b>${inr(g.left)}</b></div>` : ''}</div>`;
    const quick = [['All ' + inr(g.left), g.left]];
    if (g.bills.length > 1) quick.push([monthShort(g.bills[0].bill.recurMonth) + ' only ' + inr(g.bills[0].left), g.bills[0].left]);
    quick.push(['Part…', '']);
    $('#pay-quick').innerHTML = quick.map(([label, v]) => `<button type="button" class="chip sm" data-amt="${v}">${label}</button>`).join('');
    $('#pay-quick').hidden = false;
    $('#pay-amount-label').textContent = 'Amount paying now (₹)';
    $('#pay-amount').readOnly = false;
    $('#pay-amount').value = g.left;
    $('#pay-date').value = todayIso();
    $('#pay-mode').value = (rule && rule.mode) || '';
    $('#pay-skip').hidden = false;
    payCheck();
    if (!paySheet.open) paySheet.showModal();
  }
  function openAdvance(ruleId) {
    const rule = ruleById(ruleId);
    if (!rule) return;
    const g = Store.dues().find((x) => x.ruleId === ruleId);
    if (g) { toast('First pay the ' + inr(g.left) + ' already due.'); openPay(ruleId); return; }
    payState = { mode: 'advance', ruleId, n: 1 };
    $('#pay-title').textContent = 'Pay ahead · ' + (rule.note || rule.category);
    $('#pay-quick').innerHTML = [1, 2, 3, 6].map((n) => `<button type="button" class="chip sm ${n === 1 ? 'on' : ''}" data-months="${n}">${n} month${n > 1 ? 's' : ''}</button>`).join('');
    $('#pay-quick').hidden = false;
    $('#pay-amount-label').textContent = 'Amount (₹)';
    $('#pay-amount').readOnly = true;
    $('#pay-date').value = todayIso();
    $('#pay-mode').value = rule.mode || '';
    $('#pay-skip').hidden = true;
    advanceInfo();
    if (!paySheet.open) paySheet.showModal();
  }
  function advanceInfo() {
    const rule = ruleById(payState.ruleId);
    const yms = Store.nextUnbilled(rule, payState.n);
    const span = yms.length > 1 ? monthShort(yms[0], true) + ' – ' + monthShort(yms[yms.length - 1], true) : monthShort(yms[0], true);
    $('#pay-info').innerHTML = `<div class="pay-list"><div class="pay-month"><span>Paying for <b>${span}</b></span><b>${inr(rule.amount * yms.length)}</b></div></div>`;
    $('#pay-amount').value = Math.round(rule.amount * yms.length * 100) / 100;
    $('#pay-go').textContent = 'Pay ' + inr(rule.amount * yms.length) + ' ahead';
    $('#pay-note').textContent = 'Those months will show as paid; nothing will be due for them.';
    $('#pay-note').className = 'small pay-note';
    $('#pay-go').disabled = false;
  }
  $('#pay-quick').addEventListener('click', (e) => {
    const m = e.target.closest('[data-months]');
    if (m) { payState.n = +m.dataset.months; $$('#pay-quick .chip').forEach((c) => c.classList.toggle('on', c === m)); advanceInfo(); return; }
    const b = e.target.closest('[data-amt]'); if (!b) return;
    if (b.dataset.amt === '') { $('#pay-amount').value = ''; $('#pay-amount').focus(); } else $('#pay-amount').value = b.dataset.amt;
    payCheck();
  });
  $('#pay-amount').addEventListener('input', payCheck);
  $('#pay-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const st = payState, date = $('#pay-date').value || todayIso(), mode = $('#pay-mode').value;
    const rule = ruleById(st.ruleId);
    const name = (rule && (rule.note || rule.category)) || 'Payment';
    if (st.mode === 'advance') {
      const res = Store.payAdvance(st.ruleId, st.n, date, mode);
      paySheet.close();
      toast('Paid ahead: ' + name + ' for ' + res.months.map((x) => monthShort(x)).join(', '), 'Undo', () => { res.payments.forEach((t) => Store.remove(t.id)); toast('Removed'); });
      return;
    }
    const amt = parseFloat($('#pay-amount').value);
    if (!(amt > 0)) { toast('Please enter the amount you paid.'); return; }
    const made = Store.payDues(st.ruleId, amt, date, mode);
    paySheet.close();
    const left = (Store.dues().find((x) => x.ruleId === st.ruleId) || { left: 0 }).left;
    toast('Paid ' + inr(amt) + ' · ' + name + ' for ' + made.map((t) => monthShort(t.forMonth)).join(' + ') + (left ? ' · ' + inr(left) + ' still due' : ' ✓'), 'Undo', () => { made.forEach((t) => Store.remove(t.id)); toast('Removed'); });
  });
  $('#pay-skip').addEventListener('click', () => {
    const g = Store.dues().find((x) => x.ruleId === payState.ruleId);
    if (!g) return;
    const x = g.bills[0];
    if (!confirm('Skip ' + monthShort(x.bill.recurMonth, true) + ' for ' + (g.note || g.category) + '? Its ' + inr(x.left) + ' will no longer show as due (nothing is recorded as paid).')) return;
    Store.skipBill(x.bill.id);
    paySheet.close();
    toast('Skipped ' + monthShort(x.bill.recurMonth), 'Undo', () => Store.update(x.bill.id, { skipped: false }));
  });
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-pay]'); if (b) openPay(b.dataset.pay); });

  /* =====================================================================
   * QUICK ADD — type a few words
   * ===================================================================== */
  const quick = $('#quick');
  let parsed = [];

  function ctx() {
    const people = Store.people();
    return { learned: Store.get().learned, members: Store.members(), owesMe: (n) => people.some((p) => p.key === n.toLowerCase() && p.balance > 0) };
  }

  function autoGrow() { quick.style.height = 'auto'; quick.style.height = Math.min(140, quick.scrollHeight) + 'px'; }

  function renderPreview() {
    const text = quick.value.trim();
    parsed = text ? Parser.parseMany(text, ctx()) : [];
    // the chips under the box: who spent it, private
    parsed.forEach((p) => { if (!p.ok) return; if (!p.member) p.member = qMember; if (qPrivate) p.private = true; });
    const good = parsed.filter((p) => p.ok);
    $('#btn-add').hidden = !good.length;
    $('#btn-add').textContent = good.length > 1 ? 'Add ' + good.length + ' entries' : 'Add';
    $('#preview').innerHTML = parsed.map((p, i) => {
      if (!p.ok) return `<div class="pv err"><span class="ico">⚠️</span><span class="what"><b>${esc(p.raw)}</b><span>${esc(p.error)}</span></span></div>`;
      const d = describe(p);
      const typeLabel = Parser.TYPES[p.type].label;
      const when = p.repeat ? '🔁 every month on the ' + ordinal(+p.date.slice(8)) : niceDate(p.date);
      const headTag = p.type === 'expense' ? (Store.headOf(p) === 'need' ? '🧱 Need' : '🎈 Want') : '';
      const bits = [p.private ? '🔒 Private' : '', p.member ? '👤 ' + esc(p.member) : '', p.type === 'expense' ? d.sub + ' · ' + headTag : typeLabel + (p.person ? '' : ' · ' + esc(p.category)), when, p.mode].filter(Boolean).join(' · ');
      return `<button class="pv" data-i="${i}"><span class="ico">${Parser.iconFor(p.type, p.category)}</span>
        <span class="what"><b>${d.title}</b><span>${bits}</span></span>
        <span class="amt">${inr(p.amount)}</span><span class="edit">Edit</span></button>`;
    }).join('');
  }
  /* Who spent it (family) + private, chosen with chips under the box. */
  let qMember = '', qPrivate = false;
  function renderQuickChips() {
    const mem = Store.members();
    const box = $('#q-member');
    box.hidden = !mem.length && !Lock.hasPin();
    box.innerHTML = (mem.length ? '<span class="muted small">Spent by</span>' + ['', ...mem].map((m) => `<button type="button" class="chip sm ${m === qMember ? 'on' : ''}" data-qm="${esc(m)}">${m ? esc(m) : '👤 Self'}</button>`).join('') : '') +
      `<button type="button" class="chip sm lock-chip ${qPrivate ? 'on' : ''}" data-qp aria-pressed="${qPrivate}">🔒 Private</button>` +
      (mem.length ? '<button class="tip-btn" data-tip="member"></button>' : '');
    Help.decorate(box);
  }
  $('#q-member').addEventListener('click', async (e) => {
    const m = e.target.closest('[data-qm]');
    if (m) { qMember = m.dataset.qm; renderQuickChips(); renderPreview(); return; }
    if (e.target.closest('[data-qp]')) {
      if (!qPrivate && !Lock.hasPin() && !(await Lock.ask({ mode: 'set', reason: 'Choose a PIN to hide private entries.' }))) return;
      qPrivate = !qPrivate; renderQuickChips(); renderPreview();
    }
  });

  let pvTimer;
  quick.addEventListener('input', () => { autoGrow(); clearTimeout(pvTimer); pvTimer = setTimeout(renderPreview, 150); });
  quick.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); renderPreview(); addParsed(); } });

  // Tap a preview line to adjust it before saving.
  $('#preview').addEventListener('click', (e) => {
    const b = e.target.closest('.pv[data-i]');
    if (!b) return;
    const i = +b.dataset.i;
    openSheet({ mode: 'draft', rec: Object.assign({ source: 'text' }, parsed[i]), draftIndex: i });
  });

  function removeDraftPiece(i) {
    quick.value = parsed.filter((_, j) => j !== i).map((p) => p.raw).join(', ');
    autoGrow(); renderPreview();
  }

  /* ---------- Home: Speak · Add · Scan ------------------------------- */
  const addSheet = $('#add-sheet');
  function openAdd(focus) {
    if (!addSheet.open) addSheet.showModal();
    if (focus !== false) setTimeout(() => quick.focus(), 150);
  }
  $('#ac-add').addEventListener('click', () => openAdd());
  $('#ac-mic').addEventListener('click', () => { openAdd(false); $('#btn-mic').click(); });   // start listening straight away
  $('#ac-scan').addEventListener('click', () => $('#btn-scan').click());
  $('.add-kinds').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]'); if (!b) return;
    addSheet.close();
    if (b.dataset.kind === 'scan') { $('#btn-scan').click(); return; }
    openSheet({ mode: 'new', rec: { type: b.dataset.kind, amount: null, date: todayIso(), member: qMember, source: 'manual', note: '' } });
  });
  /** After adding from the sheet, close it (unless some lines still need fixing). */
  const doneAdding = () => { if (addSheet.open && !quick.value.trim()) addSheet.close(); };

  async function addParsed() {
    const good = parsed.filter((p) => p.ok);
    if (!good.length) return;
    // a private entry needs a PIN on this phone to see it again
    if (good.some((p) => p.private) && !Lock.hasPin()) await Lock.ask({ mode: 'set', reason: 'Choose a PIN — you\'ll need it to see private entries.' });
    const resetChips = () => { if (qMember || qPrivate) { qMember = ''; qPrivate = false; renderQuickChips(); } };
    const bad = parsed.filter((p) => !p.ok);
    const monthly = good.filter((p) => p.repeat);
    for (const p of monthly) {
      Store.addRule({ type: p.type, amount: p.amount, category: p.category, note: p.note, mode: p.mode, day: +p.date.slice(8), startMonth: p.date.slice(0, 7) });
    }
    if (monthly.length) {
      Store.applyRecurring(); Store.save();
      if (monthly.length === good.length) {
        quick.value = bad.map((p) => p.raw).join(', ');
        autoGrow(); renderPreview();
        const m = monthly[0];
        resetChips(); doneAdding();
        toast(monthly.length === 1 ? '🔁 ' + (m.note || m.category) + ' ' + inr(m.amount) + ' will be added every month on the ' + ordinal(+m.date.slice(8)) : '🔁 ' + monthly.length + ' monthly entries set up');
        return;
      }
    }
    const added = Store.addMany(good.filter((p) => !p.repeat).map((p) => ({ type: p.type, amount: p.amount, category: p.category, person: p.person, note: p.note, date: p.date, mode: p.mode, bucket: p.bucket || '', member: p.member || '', private: !!p.private, raw: p.raw, source: p.source || 'text' })));
    resetChips();
    quick.value = bad.map((p) => p.raw).join(', ');
    autoGrow(); renderPreview(); doneAdding();
    const total = added.reduce((s, t) => s + t.amount, 0);
    toast(added.length === 1 ? 'Added ' + inr(total) + ' · ' + (added[0].private ? '🔒 private' : added[0].person || added[0].category) : 'Added ' + added.length + ' entries (' + inr(total) + ')', 'Undo', () => {
      added.forEach((t) => Store.remove(t.id));
      toast('Removed');
    });
  }
  $('#btn-add').addEventListener('click', addParsed);

  /* ---------- Voice input --------------------------------------------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  $('#btn-mic').addEventListener('click', () => {
    if (!SR) { toast('Voice typing is not available in this browser. Use the mic on your keyboard.'); return; }
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = 'en-IN';
    rec.interimResults = true;
    const before = quick.value.trim();
    rec.onresult = (e) => {
      const said = [...e.results].map((r) => r[0].transcript).join(' ');
      quick.value = (before ? before + ', ' : '') + said.replace(/\brupees?\b/gi, '').trim();
      autoGrow(); renderPreview();
    };
    rec.onerror = (e) => { if (e.error === 'not-allowed') toast('Please allow microphone access.'); };
    rec.onend = () => { rec = null; $('#btn-mic').classList.remove('rec'); };
    rec.start();
    $('#btn-mic').classList.add('rec');
    toast('Listening… say e.g. "lunch 150, auto 40"');
  });

  /* =====================================================================
   * BILL SCANNING
   * ===================================================================== */
  const scanSheet = $('#scan-sheet');
  $('#btn-scan').addEventListener('click', () => {
    $('#scan-choose').hidden = false; $('#scan-tip').hidden = false; $('#scan-progress').hidden = true;
    fillKeyPick($('#scan-key'), $('#scan-key-wrap'));
    $('#scan-ai').innerHTML = AI.isOn() ? '🤖 <b>AI reading is on</b> — photos and PDFs are read by ' + (AI.geminiKeys().length ? 'Gemini' : 'Claude') + '.'
      : '📱 Photos are read on this phone. <a href="#settings" id="scan-ai-link">Add a free AI key</a> for better accuracy and PDFs.';
    scanSheet.showModal();
  });
  $('#scan-camera').addEventListener('click', () => $('#file-camera').click());
  $('#scan-gallery').addEventListener('click', () => $('#file-gallery').click());
  $('#scan-pdf').addEventListener('click', () => {
    if (!AI.isOn()) { scanSheet.close(); go('settings'); openCard('ai-card'); toast('PDFs need a free Gemini key — add one here (2 minutes).'); return; }
    $('#file-pdf').click();
  });
  document.addEventListener('click', (e) => { if (e.target.id === 'scan-ai-link') { scanSheet.close(); openCard('ai-card'); } });

  let scanStop = null;
  $('#scan-stop').addEventListener('click', () => { if (scanStop) scanStop.abort(); });
  scanSheet.addEventListener('close', () => { if (scanStop) scanStop.abort(); }); // closing the sheet stops reading too

  /** A small preview picture (never the full camera photo, which can use a lot of memory). */
  async function smallPreview(file) {
    try {
      if (typeof createImageBitmap !== 'function') return null;
      const bmp = await createImageBitmap(file, { resizeWidth: 480, resizeQuality: 'medium' });
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0); bmp.close && bmp.close();
      const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
      return b ? URL.createObjectURL(b) : null;
    } catch (e) { return null; }
  }

  /** Every category name the AI may choose from. */
  const aiCategories = () => [...Object.keys(Parser.EXPENSE_CATEGORIES), ...Object.keys(Parser.INCOME_CATEGORIES)];

  /** A category you taught Kaasu for this shop/payee wins over the AI's guess. */
  function learnedFor(name) {
    const learned = Store.get().learned || {};
    const n = ' ' + String(name || '').toLowerCase() + ' ';
    const hit = Object.keys(learned).sort((a, b) => b.length - a.length).find((p) => p && n.includes(' ' + p + ' '));
    return hit ? learned[hit] : null;
  }

  /** AI result entry -> Kaasu record. */
  function fromAI(e, by) {
    const L = learnedFor(e.merchant) || learnedFor(e.description);
    let type = e.direction === 'in' ? 'income' : 'expense';
    let category = e.category;
    if (L) { type = L.type || type; category = L.category; }
    if (type === 'expense' && !Parser.EXPENSE_CATEGORIES[category]) category = 'Other';
    if (type === 'income' && !Parser.INCOME_CATEGORIES[category]) category = 'Other income';
    return { type, amount: e.amount, category, note: e.merchant || e.description || category, date: e.date, mode: e.mode, source: 'bill',
      bucket: type === 'expense' && !L ? (e.head || '') : '', raw: [e.merchant, e.description].filter(Boolean).join(' — ') + (by ? ' [' + by + ']' : '') };
  }

  /** One product line of an itemised bill -> its own expense record. */
  function itemRec(it, bill, by) {
    const L = learnedFor(it.name);
    const category = L && L.type === 'expense' ? L.category : (Parser.EXPENSE_CATEGORIES[it.category] ? it.category : 'Other');
    return { type: 'expense', amount: it.amount, category, note: it.name, date: bill.date, mode: bill.mode, source: 'bill',
      bucket: L ? '' : it.head, raw: (bill.merchant ? bill.merchant + ' — ' : '') + it.name + (it.qty > 1 ? ' ×' + it.qty : '') + (by ? ' [' + by + ']' : '') };
  }

  /** Same day, same amount, same direction already in Kaasu -> probably a duplicate. */
  function looksDuplicate(rec) {
    return Store.active().some((t) => t.date === rec.date && Math.abs(t.amount - rec.amount) < 0.5 && (INFLOW.has(t.type) === (rec.type === 'income')));
  }

  ['#file-camera', '#file-gallery', '#file-pdf'].forEach((id) => $(id).addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!scanSheet.open) scanSheet.showModal();
    $('#scan-choose').hidden = true; $('#scan-tip').hidden = true; $('#scan-progress').hidden = false;
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    const url = URL.createObjectURL(file);
    $('#scan-preview').hidden = true;
    if (!isPdf) smallPreview(file).then((u) => { if (u) { $('#scan-preview').src = u; $('#scan-preview').hidden = false; } });
    const fill = $('#scan-fill'), msg = $('#scan-msg');
    // 1) AI reading, when a key is set up
    if (AI.isOn()) {
      let tick = 5; fill.style.width = '5%';
      const started = Date.now();
      let status = 'Starting…';
      const show = () => { msg.textContent = status + ' ' + Math.round((Date.now() - started) / 1000) + 's'; };
      const timer = setInterval(() => { tick = Math.min(92, tick + (92 - tick) * 0.05); fill.style.width = tick + '%'; show(); }, 500);
      scanStop = new AbortController();
      $('#scan-stop').hidden = false;
      try {
        const r = await AI.read(file, aiCategories(), (m) => { status = m; show(); }, scanStop.signal);
        clearInterval(timer); fill.style.width = '100%'; $('#scan-stop').hidden = true;
        URL.revokeObjectURL(url);
        scanSheet.close();
        if (!r.entries.length) { toast('No amounts found in this ' + (isPdf ? 'PDF' : 'photo') + '.'); return; }
        const parts = r.kind !== 'statement' && r.entries.length === 1 ? AI.splitBill(r.entries[0]) : [];
        if (parts.length >= 2) {
          const bill = r.entries[0];
          openImport(parts.map((it) => itemRec(it, bill, r.by)), r.by, isPdf, { bill, whole: fromAI(bill, r.by) });
        } else if (r.entries.length === 1 && r.kind !== 'statement') {
          const e1 = r.entries[0];
          const rec = fromAI(e1, r.by);
          openSheet({ mode: 'new', rec, bill: { amount: rec.amount, gst: e1.gst, gstin: r.gstin, merchant: e1.merchant, text: (e1.description || '') + '\n\nRead by ' + r.by, by: r.by } });
        } else {
          openImport(r.entries.map((x) => fromAI(x, r.by)), r.by, isPdf);
        }
        return;
      } catch (err) {
        clearInterval(timer); $('#scan-stop').hidden = true;
        // Stopped, a PDF, or the photo itself couldn't be opened: don't start a second heavy attempt.
        if (err.stopped || isPdf || /memory/i.test(err.message)) {
          msg.textContent = err.stopped ? 'Stopped. Choose a photo or PDF again.' : err.message;
          fill.style.width = '0%';
          $('#scan-choose').hidden = false; URL.revokeObjectURL(url); return;
        }
        toast('AI couldn\'t read it (' + err.message + ') — reading on the phone instead.');
        fill.style.width = '0%';
      }
    }
    if (isPdf) { msg.textContent = 'PDFs need an AI key (Settings → AI bill reading).'; $('#scan-choose').hidden = false; URL.revokeObjectURL(url); return; }
    // 2) On-phone reading (no key, or AI failed)
    try {
      const text = await OCR.readBill(file, (p, m) => { fill.style.width = Math.round(p * 100) + '%'; msg.textContent = m; });
      const bill = Parser.parseBill(text, { learned: Store.get().learned });
      scanSheet.close();
      openSheet({
        mode: 'new',
        rec: { type: 'expense', amount: bill.amount, category: bill.category, note: bill.merchant || 'Bill', date: bill.date, mode: '', source: 'bill' },
        bill: Object.assign(bill, { text }),
      });
    } catch (err) {
      msg.textContent = err.message || 'Could not read this bill. Try again with better light.';
      $('#scan-choose').hidden = false;
    } finally { URL.revokeObjectURL(url); }
  }));

  /* ---------- Review many entries (statement PDFs) --------------------- */
  let impRows = [];
  let impItems = null;   // { bill, whole, itemRows } when the list came from one itemised bill
  let impMode = 'items';
  function openImport(recs, by, isPdf, itemised) {
    impItems = itemised || null;
    impMode = 'items';
    if (impItems) {
      // items of one bill: check the BILL against what you already have, not each item
      // Already added? Either as one whole-bill entry, or item by item (same day, same name, same price).
      const sameItem = (r) => Store.active().some((t) => t.date === r.date && Math.abs(t.amount - r.amount) < 0.5 && String(t.note).toLowerCase() === String(r.note).toLowerCase());
      const itemDups = recs.map(sameItem);
      const dup = looksDuplicate(impItems.whole) || itemDups.filter(Boolean).length >= Math.ceil(recs.length / 2);
      impItems.itemRows = recs.map((r, i) => ({ rec: r, dup: dup || itemDups[i], on: !(dup || itemDups[i]) }));
      impItems.wholeRow = { rec: impItems.whole, dup, on: !dup };
      impRows = impItems.itemRows;
      $('#imp-title').textContent = (impItems.bill.merchant || 'Bill') + ' — ' + inr(impItems.bill.amount);
      $('#imp-sub').textContent = 'Read by ' + by + '. Each item is its own entry with a category and 🧱 Need / 🎈 Want — tap to change.' + (dup ? ' This bill looks like one you already added, so nothing is ticked.' : '');
    } else {
      impRows = recs.map((r) => ({ rec: r, dup: looksDuplicate(r) })).map((x) => Object.assign(x, { on: !x.dup }));
      const dups = impRows.filter((x) => x.dup).length;
      $('#imp-title').textContent = 'Check ' + impRows.length + ' entries';
      $('#imp-sub').textContent = (isPdf ? 'Read from your PDF' : 'Read from your photo') + ' by ' + by + '. Untick anything you don\'t want, fix categories if needed.' + (dups ? ' ' + (dups === 1 ? '1 looks like an entry you already have, so it\'s' : dups + ' look like entries you already have, so they\'re') + ' unticked.' : '');
    }
    $('#imp-mode').hidden = !impItems;
    $$('#imp-mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === 'items'));
    renderImport();
    $('#import-sheet').showModal();
  }
  $('#imp-mode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]'); if (!b || !impItems) return;
    impMode = b.dataset.mode;
    impRows = impMode === 'items' ? impItems.itemRows : [impItems.wholeRow];
    $$('#imp-mode button').forEach((x) => x.classList.toggle('on', x === b));
    renderImport();
  });
  const headOfRec = (r) => (r.type === 'expense' ? (r.bucket || Store.categoryHead(r.category)) : '');
  function renderImport() {
    $('#imp-list').innerHTML = impRows.map((x, i) => {
      const r = x.rec, inflow = r.type === 'income';
      const cats = Object.keys(Parser.categoriesFor(r.type));
      const h = headOfRec(r);
      return `<div class="imp-row ${x.dup ? 'dup' : ''}">
        <input type="checkbox" data-i="${i}" ${x.on ? 'checked' : ''} aria-label="Add ${esc(r.note)}">
        <span class="what"><span class="top"><b>${esc(r.note)}</b><span class="amt ${inflow ? 'in' : ''}">${inflow ? '+' : '−'}${inr(r.amount)}</span></span>
          <span class="meta">${niceDate(r.date)}${r.mode ? ' · ' + esc(r.mode) : ''}${x.dup ? ' · already added?' : ''}</span>
          <span class="ctl">${h ? `<button type="button" class="head-chip ${h}" data-head="${i}">${h === 'need' ? '🧱 Need' : '🎈 Want'}</button>` : ''}
          <select data-cat="${i}" aria-label="Category">${cats.map((c) => `<option ${c === r.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></span>
        </span>
      </div>`;
    }).join('');
    const on = impRows.filter((x) => x.on);
    const n = on.length;
    $('#imp-add').textContent = n ? 'Add ' + n + ' ' + (n === 1 ? 'entry' : 'entries') : 'Nothing ticked';
    $('#imp-add').disabled = !n;
    // itemised bill: show that the items add up to the bill
    $('#imp-total').hidden = !impItems;
    if (impItems) {
      const total = Math.round(on.reduce((s, x) => s + x.rec.amount, 0) * 100) / 100;
      const bill = impItems.bill.amount;
      const needs = on.filter((x) => headOfRec(x.rec) === 'need').reduce((s, x) => s + x.rec.amount, 0);
      $('#imp-total').innerHTML = (Math.abs(total - bill) < 0.01 ? '✅ Adds up to the bill total <b>' + inr(bill) + '</b>' : 'Adding <b>' + inr(total) + '</b> of the bill\'s ' + inr(bill)) +
        (n ? ' · 🧱 Needs ' + inr(Math.round(needs)) + ' · 🎈 Wants ' + inr(Math.round(total - needs)) : '');
    }
  }
  $('#imp-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-head]'); if (!b) return;
    const x = impRows[+b.dataset.head];
    x.rec.bucket = headOfRec(x.rec) === 'need' ? 'want' : 'need';
    renderImport();
  });
  $('#imp-list').addEventListener('change', (e) => {
    if (e.target.dataset.i != null) impRows[+e.target.dataset.i].on = e.target.checked;
    if (e.target.dataset.cat != null) {
      const x = impRows[+e.target.dataset.cat];
      if (x.rec.category !== e.target.value) Store.learn(x.rec.note, x.rec.type, e.target.value); // remember for next time
      x.rec.category = e.target.value;
    }
    renderImport();
  });
  $('#imp-all').addEventListener('click', () => { impRows.forEach((x) => { x.on = true; }); renderImport(); });
  $('#imp-none').addEventListener('click', () => { impRows.forEach((x) => { x.on = false; }); renderImport(); });
  $('#imp-add').addEventListener('click', () => {
    const recs = impRows.filter((x) => x.on).map((x) => x.rec);
    if (!recs.length) return;
    const added = Store.addMany(recs);
    $('#import-sheet').close();
    toast('Added ' + added.length + ' entries', 'Undo', () => { added.forEach((t) => Store.remove(t.id)); toast('Removed'); });
  });

  /* ---------- Settings: AI keys ------------------------------------------ */
  /** Auto / Key 1 / Key 2 … — shown when there is more than one Gemini key. */
  function fillKeyPick(sel, wrap) {
    const keys = AI.geminiKeys();
    wrap.hidden = keys.length < 2 || !AI.enabled();
    sel.innerHTML = '<option value="0">Auto — move to the next key at the free limit</option>' +
      keys.map((k, i) => `<option value="${i + 1}">Key ${i + 1} only (${esc(AI.masked(k))})</option>`).join('');
    sel.value = String(AI.pickedKey());
  }
  ['#scan-key', '#ai-pick'].forEach((id) => $(id).addEventListener('change', (e) => {
    AI.pickKey(+e.target.value);
    toast(+e.target.value ? 'Using Gemini key ' + e.target.value : 'Using Auto: key 1, then the next key at its limit');
    if (id === '#ai-pick') renderAI();
  }));
  function renderAI() {
    const keys = AI.geminiKeys();
    $('#ai-on').checked = AI.enabled();
    $('#ai-gemini-list').innerHTML = keys.map((k, i) => `<li><span>🔑</span><code>Key ${i + 1}: ${esc(AI.masked(k))}</code><span class="key-st" data-st="${i}"></span><button class="icon-btn sm" data-rm="${i}" aria-label="Remove key ${i + 1}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></li>`).join('');
    fillKeyPick($('#ai-pick'), $('#ai-pick-wrap'));
    $('#ai-claude').value = '';
    $('#ai-claude').placeholder = AI.claudeKey() ? 'Saved: ' + AI.masked(AI.claudeKey()) + ' (paste to replace, Save empty to remove)' : 'sk-ant-…';
    $('#ai-status').textContent = !AI.hasKey() ? 'No AI key yet — bills are read on the phone, PDFs need a key.'
      : !AI.enabled() ? 'AI reading is switched off.'
      : '✅ AI reading is on: ' + [keys.length ? keys.length + ' Gemini key' + (keys.length > 1 ? 's' : '') : '', AI.claudeKey() ? 'Claude' : ''].filter(Boolean).join(' + ') + '. When AI is used, the photo or PDF is sent to that service to be read.';
  }
  $('#ai-on').addEventListener('change', (e) => { AI.setEnabled(e.target.checked); renderAI(); });
  $('#ai-gemini-add').addEventListener('click', async () => {
    const v = $('#ai-gemini-new').value;
    try { AI.addGeminiKey(v); } catch (err) { toast(err.message); return; }
    $('#ai-gemini-new').value = '';
    renderAI();
    const i = AI.geminiKeys().length - 1;
    const st = $('[data-st="' + i + '"]'); if (st) st.textContent = 'checking…';
    const r = await AI.testGeminiKey(v);
    const st2 = $('[data-st="' + i + '"]');
    if (st2) { st2.textContent = r.message; st2.className = 'key-st ' + (r.ok ? 'ok' : 'bad'); }
    toast(r.ok ? 'Gemini key added ✓' : r.message);
  });
  $('#ai-gemini-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]'); if (!b) return;
    if (!confirm('Remove this Gemini key from this phone?')) return;
    AI.removeGeminiKey(+b.dataset.rm); renderAI();
  });
  $('#ai-claude-save').addEventListener('click', () => {
    try { AI.setClaudeKey($('#ai-claude').value); } catch (err) { toast(err.message); return; }
    toast(AI.claudeKey() ? 'Claude key saved ✓' : 'Claude key removed'); renderAI();
  });

  /* =====================================================================
   * EDIT / ADD SHEET
   * ===================================================================== */
  const sheet = $('#sheet');
  const PEOPLE_TYPES = new Set(['lent', 'borrowed', 'got_back', 'paid_back']);
  let sheetState = null;

  function fillCategories(type, selected) {
    const cats = Parser.categoriesFor(type);
    const names = Object.keys(cats);
    if (selected && !names.includes(selected)) names.push(selected);
    $('#f-category').innerHTML = names.map((n) => `<option ${n === selected ? 'selected' : ''}>${esc(n)}</option>`).join('');
    if (!selected) $('#f-category').value = names[0];
  }
  function syncTypeFields() {
    const type = $('#f-type').value;
    const isPeople = PEOPLE_TYPES.has(type);
    $('#f-repeat-wrap').hidden = isPeople;
    $('#f-person-wrap').hidden = !(isPeople || type === 'expense');
    $('#f-person-label').textContent = isPeople ? 'Person' : 'Spent on (optional)';
    $('#f-person').placeholder = isPeople ? '' : 'e.g. Manoj — money you won\'t ask back';
    $('#f-bucket-wrap').hidden = type !== 'expense';
    $('#f-member-wrap').hidden = !Store.members().length && !sheetState.rec.member;
    $('#f-member-wrap span').textContent = type === 'income' ? 'Whose income' : type === 'saving' ? 'Saved by' : PEOPLE_TYPES.has(type) ? 'Family member' : 'Spent by';
    updateBucketAuto();
    $('#f-cat-wrap').hidden = isPeople;
    fillCategories(type, isPeople ? 'Personal loan' : (sheetState.rec.type === type ? sheetState.rec.category : ''));
  }
  $('#f-type').addEventListener('change', syncTypeFields);
  function updateBucketAuto() {
    const h = Store.categoryHead($('#f-category').value);
    $('#f-bucket').options[0].textContent = 'Auto (' + (h === 'need' ? 'Need' : 'Want') + ' for ' + $('#f-category').value + ')';
  }
  $('#f-category').addEventListener('change', updateBucketAuto);

  /** opts: { mode: 'edit'|'new'|'draft', rec, bill?, draftIndex?, onSaved? } */
  function openSheet(opts) {
    sheetState = opts;
    const r = opts.rec;
    $('#sheet-title').textContent = opts.mode === 'edit' ? 'Edit entry' : opts.bill ? 'Check the bill' : 'New entry';
    $('#f-type').value = r.type || 'expense';
    $('#f-amount').value = r.amount != null ? r.amount : '';
    $('#f-person').value = r.person || '';
    $('#f-note').value = r.note || '';
    $('#f-date').value = r.date || todayIso();
    $('#f-mode').value = r.mode || '';
    $('#people-list').innerHTML = Store.people().map((p) => `<option value="${esc(p.name)}">`).join('');
    const mem = Store.members();
    if (r.member && !mem.includes(r.member)) mem.push(r.member);
    $('#f-member').innerHTML = ['', ...mem].map((m) => `<option value="${esc(m)}">${m ? esc(m) : '👤 Self'}</option>`).join('');
    $('#f-member').value = r.member || '';
    $('#f-private').checked = !!r.private;
    syncTypeFields();
    $('#f-category').value = r.category || $('#f-category').value;
    $('#f-bucket').value = r.bucket || '';
    updateBucketAuto();
    $('#f-delete').hidden = opts.mode !== 'edit';
    const linked = r.recurId && Store.rules().some((x) => x.id === r.recurId);
    $('#f-repeat').checked = !!(linked || r.repeat);
    $('#f-repeat-label').textContent = linked ? '🔁 Monthly auto entry — untick to stop future months (change the monthly amount in Settings)' : '🔁 Repeat every month on this date';
    // Bill details
    const b = opts.bill;
    $('#bill-info').hidden = !b;
    $('#ocr-text-wrap').hidden = !b;
    if (b) {
      const bits = [];
      bits.push(b.amount != null ? '✅ Found total <b>' + inr(b.amount) + '</b>' : '⚠️ Couldn\'t find the total — please type the amount.');
      if (b.gst) bits.push('GST in this bill: <b>' + inr(b.gst) + '</b>');
      if (b.gstin) bits.push('GSTIN: ' + esc(b.gstin));
      if (b.by) bits.push('<span class="muted">🤖 Read by ' + esc(b.by) + ' — check before saving</span>');
      $('#bill-info').innerHTML = bits.join('<br>');
      $('#ocr-text').textContent = b.text || '';
      if (b.gst && !r.note.includes('GST')) $('#f-note').value = (r.note || 'Bill');
    }
    sheet.showModal();
    if (opts.mode === 'new' && r.amount == null) setTimeout(() => $('#f-amount').focus(), 200);
  }

  $('#edit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const s = sheetState;
    const type = $('#f-type').value;
    const amount = parseFloat($('#f-amount').value);
    if (!(amount > 0)) { toast('Please enter an amount.'); $('#f-amount').focus(); return; }
    const person = $('#f-person').value.trim().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    if (PEOPLE_TYPES.has(type) && !person) { toast('Whose money? Please add a name.'); $('#f-person').focus(); return; }
    const rec = {
      type, amount,
      category: PEOPLE_TYPES.has(type) ? 'Personal loan' : $('#f-category').value,
      person: (PEOPLE_TYPES.has(type) || type === 'expense') ? person : '',
      note: $('#f-note').value.trim(),
      date: $('#f-date').value || todayIso(),
      mode: $('#f-mode').value,
      bucket: type === 'expense' ? $('#f-bucket').value : '',
      member: $('#f-member').value,
      private: $('#f-private').checked,
    };
    // Teach the app: if you changed the category, remember it for this description/shop.
    const orig = s.rec;
    const catChanged = !PEOPLE_TYPES.has(type) && (orig.category !== rec.category || orig.type !== type);
    if (catChanged && rec.note) {
      const phrase = s.bill ? (s.bill.merchant || rec.note) : rec.note;
      Store.learn(phrase, type, rec.category);
    }
    const wantRepeat = !PEOPLE_TYPES.has(type) && $('#f-repeat').checked;
    const linkedRule = orig.recurId && Store.rules().find((x) => x.id === orig.recurId);
    let saved;
    if (s.mode === 'edit') {
      saved = Store.update(orig.id, rec);
    } else {
      saved = Store.add(Object.assign(rec, { source: orig.source || 'manual', raw: orig.raw || '' }));
      if (s.mode === 'draft') removeDraftPiece(s.draftIndex);
    }
    if (wantRepeat && !linkedRule) {
      const rule = Store.addRule({ type, amount, category: rec.category, note: rec.note, mode: rec.mode, day: +rec.date.slice(8), startMonth: rec.date.slice(0, 7) });
      Store.linkToRule(saved.id, rule);
      Store.applyRecurring(); Store.save();
      toast('🔁 Will be added every month on the ' + ordinal(rule.day));
    } else if (!wantRepeat && linkedRule) {
      Store.removeRule(linkedRule.id); Store.save();
      toast('Saved. Future months stopped.');
    } else {
      toast(s.mode === 'edit' ? 'Saved' : 'Added ' + inr(amount));
    }
    sheet.close();
    if (s.onSaved) s.onSaved();
  });

  $('#f-private').addEventListener('change', async (e) => {
    if (!e.target.checked || Lock.hasPin()) return;
    const ok = await Lock.ask({ mode: 'set', reason: 'Choose a PIN — you\'ll need it to see private entries.' });
    if (!ok) e.target.checked = false;
  });

  $('#f-delete').addEventListener('click', () => {
    const id = sheetState.rec.id;
    Store.remove(id);
    sheet.close();
    toast('Deleted', 'Undo', () => Store.restore(id));
  });

  /* =====================================================================
   * HOME
   * ===================================================================== */
  /* ---------- Money left card: period (this month … 2 years) ----------- */
  const HERO_KEY = 'kaasu.heroRange';
  let heroN = 1;
  try { heroN = [1, 2, 3, 6, 12, 24].includes(+localStorage.getItem(HERO_KEY)) ? +localStorage.getItem(HERO_KEY) : 1; } catch (e) { /* ignore */ }
  function heroRange() {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth(), n = heroN;
    const first = new Date(y, m - n + 1, 1);
    const label = n === 1 ? monthName(y, m)
      : (first.getFullYear() === y ? first.toLocaleString('en-IN', { month: 'short' }) : monthName(first.getFullYear(), first.getMonth(), true)) + ' – ' + monthName(y, m, true);
    return { n, y, m, first, from: iso(first), to: monthEnd(y, m), label };
  }
  /** Everything the Money left card shows, for the chosen period. */
  function heroData() {
    const r = heroRange();
    const t = Store.totals(r.from, r.to);
    const carryOn = Store.get().settings.carryForward !== false;
    const loansNet = t.borrowed + t.got_back - t.lent - t.paid_back;
    if (r.n === 1) {
      const plan = Store.budgetPlan(r.y, r.m);
      return { r, t, plan, loansNet, left: plan.totalLeft, carry: carryOn ? plan.carry : 0, before: 0, base: plan.base > 0 ? plan.base : t.income, showCarry: carryOn && !!(plan.carry || plan.hasEarlier) };
    }
    const before = carryOn ? Store.carryInto(r.first.getFullYear(), r.first.getMonth()) : 0;
    return { r, t, loansNet, left: t.left, carry: 0, before, base: t.income + loansNet > 0 ? t.income + loansNet : t.income, showCarry: false };
  }

  function renderHome() {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const day = now.getDate(), days = new Date(y, m + 1, 0).getDate();
    const h = heroData(), t = h.t;
    $('#hero-month').textContent = h.r.label;
    $('#hero-range').value = String(h.r.n);
    const daysSoFar = Math.max(1, Math.round((new Date(todayIso() + 'T00:00:00') - h.r.first) / 864e5) + 1);
    $('#hero-sub').textContent = t.expense ? 'avg ' + inr(Math.round(t.expense / daysSoFar)) + '/day' : '';
    const plan = h.r.n === 1 ? h.plan : Store.budgetPlan(y, m);
    $('#hero-left').textContent = inr(Math.round(h.left));
    $('#hero-left').classList.toggle('neg', h.left < 0);
    $('.hero-nums .hero-label').textContent = h.r.n === 1 ? 'Money left' : 'Left over in ' + (h.r.n >= 12 ? h.r.n / 12 + (h.r.n === 12 ? ' year' : ' years') : h.r.n + ' months');
    // the ring: how much of the money is spent and saved
    const base = h.base;
    const pctLeft = base > 0 ? Math.round((Math.max(0, h.left) / base) * 100) : null;
    $('#hero-ring').innerHTML = ring(base > 0 ? [{ frac: t.expense / base, cls: 'spent' }, { frac: t.saving / base, cls: 'saved' }] : [], 104, 11,
      pctLeft == null ? '<b>—</b>' : '<b>' + Math.min(100, pctLeft) + '%</b><small>left</small>');
    const prevName = new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short' });
    $('#hero-carry').hidden = !(h.showCarry || h.r.n > 1);
    if (h.showCarry) {
      const sign = plan.carry < 0 ? '−' : '+';
      $('#hero-carry').innerHTML = 'This month ' + inr(Math.round(plan.monthLeft)) + ' ' + sign +
        ' ' + prevName + ' <b class="' + (plan.carry < 0 ? 'neg-ink' : '') + '">' + inr(Math.abs(Math.round(plan.carry))) + '</b>';
    } else if (h.r.n > 1) {
      $('#hero-carry').innerHTML = 'about <b>' + inr(Math.round(h.left / h.r.n)) + '</b> a month';
    }
    const dueAmt = Store.duesTotal();
    $('#hero-dues').hidden = !dueAmt || h.r.n !== 1;
    if (dueAmt) $('#hero-dues').innerHTML = '⏳ ' + inr(Math.round(dueAmt)) + ' due · <b>' + inr(Math.round(h.left - dueAmt)) + '</b> after paying';
    renderDues();
    renderPlan($('#plan-body'), plan, true);
    $('#plan-title').textContent = 'Budget plan · ' + plan.split.join('/');
    $('#plan-mini').innerHTML = miniHeads(plan, true);
    $('#t-spent').textContent = inrShort(t.expense);
    $('#t-income').textContent = inrShort(t.income);
    $('#t-saved').textContent = inrShort(t.saving);

    const budget = +Store.get().settings.budget || 0;
    $('#budget-box').hidden = !budget || h.r.n > 1;   // the spending limit is per month
    if (budget && h.r.n === 1) {
      const used = t.expense / budget;
      const left = budget - t.expense;
      $('#budget-text').textContent = inr(Math.round(t.expense)) + ' of ' + inr(budget) + (left >= 0 ? ' · ' + inr(Math.round(left / Math.max(1, days - day + 1))) + '/day left' : ' · over by ' + inr(Math.round(-left)));
      const f = $('#budget-fill');
      f.style.width = Math.min(100, used * 100) + '%';
      f.className = used > 1 ? 'danger' : used > day / days + 0.1 ? 'warn' : '';
    }

    const ppl = Store.people();
    const oweMe = ppl.reduce((s, p) => s + Math.max(0, p.balance), 0);
    const iOwe = ppl.reduce((s, p) => s + Math.max(0, -p.balance), 0);
    $('#people-card').hidden = !(oweMe || iOwe);
    $('#pc-owe-me').textContent = inr(oweMe);
    $('#pc-i-owe').textContent = inr(iOwe);
    $('#pc-i-owe-wrap').hidden = !iOwe;

    const rules = Store.rules().filter((r) => r.active);
    $('#auto-card').hidden = !rules.length;
    if (rules.length) {
      const upcoming = rules.map((r) => ({ r, d: Store.nextRun(r) })).filter((x) => x.d).sort((a, b) => a.d.localeCompare(b.d));
      const nx = upcoming[0];
      $('#auto-title').textContent = nx ? 'Next monthly entry' : rules.length + ' monthly ' + (rules.length === 1 ? 'entry' : 'entries');
      $('#auto-next').textContent = nx ? inr(nx.r.amount) : '';
      $('#auto-sub').textContent = nx ? (nx.r.note || nx.r.category) + ' · ' + shortDate(nx.d) : '';
    }

    const all = Store.active();
    const recent = visibleList(all).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 8);
    const hiddenN = isLocked() ? all.filter((t) => t.private).length : 0;
    $('#recent').innerHTML = (recent.length || hiddenN ? group(recent.map((t) => rowHTML(t, { showDate: true })).join('') + lockedRow(hiddenN))
      : '<p class="empty">Nothing yet. Tap <b>＋ Add</b> above and type <b>chai 20</b> — that\'s it!</p>');
    renderQuickChips();
    // first run of this version: offer the tour; Drive not set up: offer sign-in
    $('#tour-offer').hidden = Help.wasSeen();
    $('#drive-offer').hidden = Drive.wasConnected() || !Drive.isConfigured() || localStorage.getItem(DRIVE_OFFER_KEY) === '1' || !all.length;
  }
  const DRIVE_OFFER_KEY = 'kaasu.driveOfferClosed';
  $('#tour-start').addEventListener('click', () => Help.tour());
  $('#tour-later').addEventListener('click', () => { Help.seen(); $('#tour-offer').hidden = true; toast('Tap ? at the top any time for the tour.'); });
  $('#drive-offer-close').addEventListener('click', () => { localStorage.setItem(DRIVE_OFFER_KEY, '1'); $('#drive-offer').hidden = true; });
  $('#drive-offer-go').addEventListener('click', () => doSync(true));
  $('#people-card').addEventListener('click', () => go('people'));
  $('#auto-card').addEventListener('click', () => { go('settings'); openCard('rules-card'); });
  $('#plan-edit').addEventListener('click', () => { go('settings'); openCard('plan-settings'); });

  $('#hero-range').addEventListener('change', (e) => {
    heroN = +e.target.value || 1;
    try { localStorage.setItem(HERO_KEY, String(heroN)); } catch (err) { /* ignore */ }
    renderHome();
  });

  /** Tap a figure on the Money left card: see what it is made of. */
  const HERO_LIST = { spent: ['💸 Spent', 'expense'], income: ['💰 Income', 'income'], saved: ['🐷 Saved', 'saving'] };
  function openHeroList(kind) {
    const r = heroRange();
    const [title, type] = HERO_LIST[kind];
    const all = Store.active().filter((t) => t.type === type && t.date >= r.from && t.date <= r.to);
    const list = visibleList(all);
    const cats = Store.byCategory(r.from, r.to, type).slice(0, 3);
    openGroup(title + ' · ' + r.label, '', list, {
      hidden: all.length - list.length,
      hint: cats.length > 1 ? 'Most: ' + cats.map((c) => esc(c.category) + ' ' + inr(Math.round(c.amount))).join(' · ') : '',
      empty: kind === 'income' ? 'No income in this period. Type <b>salary 55000</b>.' : kind === 'saved' ? 'Nothing saved in this period. Type <b>sip 5000</b>.' : 'No spending in this period.',
    });
  }
  /** Money left = income − spent − saved ± people ± last month, as a sum. */
  function openMoneyLeft() {
    const h = heroData(), t = h.t, r = h.r;
    const pct = (v) => (h.base > 0 ? Math.round((v / h.base) * 100) : 0);
    const left = Math.max(0, h.left);
    const shares = [['spent', 'Spent', t.expense], ['saved', 'Saved', t.saving], ['left', 'Left', left]];
    const other = h.base > 0 ? Math.max(0, h.base - t.expense - t.saving - left) : 0;
    if (other >= 1) shares.splice(2, 0, ['other', 'Given to people', other]);
    const bar = h.base > 0 ? `<div class="mix-bar">${shares.map(([k, , v]) => `<i class="mx-${k}" style="width:${(v / h.base) * 100}%"></i>`).join('')}</div>
      <div class="mix-legend">${shares.map(([k, label, v]) => `<span><i class="mx-${k}"></i>${label} <b>${pct(v)}%</b></span>`).join('')}</div>` : '';
    const prev = new Date(r.y, r.m - 1, 1).toLocaleString('en-IN', { month: 'long' });
    const rows = [
      ['Income', t.income, '+'], ['Spent', t.expense, '−'], ['Saved / invested', t.saving, '−'],
      ['Given to people', t.lent, '−'], ['Taken from people', t.borrowed, '+'], ['Got back from people', t.got_back, '+'], ['Paid back to people', t.paid_back, '−'],
    ].filter(([, v]) => v);
    if (h.carry) rows.push([h.carry < 0 ? 'Shortfall from ' + prev : 'Left over from ' + prev, Math.abs(h.carry), h.carry < 0 ? '−' : '+']);
    const sum = rows.map(([label, v, sign]) => `<div class="pb-row${sign === '−' ? ' neg' : ''}"><span>${sign} ${label}</span><b>${inr(Math.round(v))}</b></div>`).join('') +
      `<div class="pb-row pb-total"><span>= ${r.n === 1 ? 'Money left' : 'Left over in this period'}</span><b>${inr(Math.round(h.left))}</b></div>`;
    const dueAmt = Store.duesTotal();
    const dueNote = dueAmt ? `<p class="muted small">⏳ <b>${inr(Math.round(dueAmt))}</b> is still due (rent etc.) and not counted yet — after paying it, <b>${inr(Math.round(h.left - dueAmt))}</b> would be left.</p>` : '';
    const now = r.n > 1 && h.before ? `<p class="muted small">Counting what was left before ${r.first.toLocaleString('en-IN', { month: 'short', year: 'numeric' })}, you have <b>${inr(Math.round(h.left + h.before))}</b> now.</p>` : '';
    personKey = null;
    $('#ps-name').textContent = '💰 Money left · ' + r.label;
    $('#ps-balance').innerHTML = inr(Math.round(h.left)) + (h.base > 0 ? ' <span class="muted small">· ' + pct(left) + '% of ' + inr(Math.round(h.base)) + ' still left</span>' : '');
    $('#ps-settle').hidden = true; $('#ps-add').hidden = true;
    $('#ps-list').innerHTML = `<div class="card mix-card">${bar}<div class="pb-sum">${sum}</div>${now}${dueNote}</div>`;
    if (!$('#person-sheet').open) $('#person-sheet').showModal();
  }
  const heroClick = (e) => {
    const b = e.target.closest('[data-hero]');
    if (!b || (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    if (b.dataset.hero === 'left') openMoneyLeft(); else openHeroList(b.dataset.hero);
  };
  $('.card.hero').addEventListener('click', heroClick);
  $('.card.hero').addEventListener('scroll', (e) => { e.currentTarget.scrollLeft = 0; e.currentTarget.scrollTop = 0; });  // older phones without overflow: clip
  $('.card.hero').addEventListener('keydown', heroClick);

  /** Folded budget plan: just what is left under each head, with a thin bar. */
  function miniHeads(plan, isCurrent) {
    if (!plan.income) return '<span class="mini-empty">Add your salary to see Needs · Wants · Savings</span>';
    const icons = { need: '🧱', want: '🎈', saving: '🐷' };
    const now = new Date(), [y, m] = plan.month.split('-').map(Number);
    const pace = isCurrent ? now.getDate() / new Date(y, m, 0).getDate() : 1;
    return plan.heads.map((h) => {
      const ratio = h.budget ? h.used / h.budget : (h.used ? 2 : 0);
      const save = h.key === 'saving';
      const cls = save ? 'save' : ratio > 1 ? 'danger' : ratio > pace + 0.1 ? 'warn' : '';
      const val = save ? (h.left > 0 ? inr(Math.round(h.left)) : '✓') : inr(Math.round(h.left));
      return `<span class="mini-head h-${h.key}" role="button" tabindex="0" data-plan-head="${h.key}" data-ym="${plan.month}" aria-label="See ${h.label} entries"><span class="ring sm">${ring([{ frac: Math.min(1, ratio), cls: cls || 'h-' + h.key }], 58, 7, icons[h.key])}</span>
        <small>${h.label}</small><b class="${!save && h.left < 0 ? 'neg-ink' : ''}">${val}</b><small>${save ? (h.left > 0 ? 'to save' : 'target met') : h.left < 0 ? 'over' : 'left'} <i class="mh-go">›</i></small></span>`;
    }).join('');
  }

  /** Draw the Needs / Wants / Savings rows (+ carried money) into el. */
  function renderPlan(el, plan, isCurrent) {
    const [y, m] = plan.month.split('-').map(Number);
    const prevName = new Date(y, m - 2, 1).toLocaleString('en-IN', { month: 'long' });
    const now = new Date();
    const daysIn = new Date(y, m, 0).getDate();
    const pace = isCurrent ? now.getDate() / daysIn : 1; // how far through the month we are
    let html = '';
    if (!plan.income) {
      html += '<p class="muted small plan-base">Add your income (type <b>salary 55000</b>) or set a fixed amount in Settings to see how much you can spend under each head.</p>';
    } else {
      // where the money to plan with comes from: income ± last month ± people
      const rows = plan.parts.map((p, i) => `<div class="pb-row${p.amount < 0 ? ' neg' : ''}"><span>${i ? (p.amount < 0 ? '− ' : '+ ') : ''}${esc(p.label)}</span><b>${inr(Math.abs(Math.round(p.amount)))}</b></div>`).join('');
      const total = `<div class="pb-row pb-total"><span>Money to plan with</span><b>${inr(Math.round(plan.base))}</b></div>`;
      html += plan.parts.length > 1 ? `<details class="plan-break"${plan.base < plan.income ? ' open' : ''}><summary>Split of <b>${inr(Math.round(plan.base))}</b> you have this month</summary>${rows}${total}</details>`
        : `<p class="muted small plan-base">Split of this month's ${plan.baseSource === 'fixed' ? 'fixed amount' : plan.baseSource === 'expected' ? 'expected salary' : 'income'}: <b>${inr(Math.round(plan.base))}</b></p>`;
      if (plan.base <= 0) html += '<p class="small neg-ink plan-base">Last month\'s shortfall and money given to people are more than this month\'s income — nothing is left to plan with.</p>';
      if (plan.baseSource === 'expected') html += '<p class="muted small plan-base">Using your monthly salary entry until this month\'s salary is added.</p>';
    }
    const icons = { need: '🧱', want: '🎈', saving: '🐷' };
    for (const h of plan.heads) {
      const ratio = h.budget ? h.used / h.budget : (h.used ? 2 : 0);
      let right, sub, cls;
      if (h.key === 'saving') {
        right = h.left > 0 ? inr(Math.round(h.left)) + ' to go' : '✓ target met';
        sub = 'Saved ' + inr(Math.round(h.used)) + (h.budget ? ' of ' + inr(h.budget) + ' target' : '');
        cls = 'save';
      } else {
        right = h.left >= 0 ? inr(Math.round(h.left)) + ' left' : 'Over by ' + inr(Math.round(-h.left));
        sub = 'Spent ' + inr(Math.round(h.used)) + (h.budget ? ' of ' + inr(h.budget) : '');
        cls = ratio > 1 ? 'danger' : ratio > pace + 0.1 ? 'warn' : '';
        if (isCurrent && h.left > 0 && h.budget) {
          const daysLeft = daysIn - now.getDate() + 1;
          sub += ' · ' + inr(Math.round(h.left / daysLeft)) + '/day';
        }
      }
      html += `<div class="head-row" role="button" tabindex="0" data-plan-head="${h.key}" data-ym="${plan.month}">
        <div class="head-top"><span class="head-name">${icons[h.key]} ${h.label}<small>${h.pct}%</small> <i class="mh-go">›</i></span><span class="head-left ${h.key !== 'saving' && h.left < 0 ? 'over' : ''}">${right}</span></div>
        <div class="head-sub">${sub}</div>
        <div class="meter"><span class="${cls}" style="width:${Math.min(100, ratio * 100)}%"></span></div>
      </div>`;
    }
    if (plan.income) {
      // the three heads now always add up to "Money left"
      const leftSum = plan.heads.reduce((s, h) => s + h.left, 0);
      const matches = Math.abs(leftSum - plan.totalLeft) < 1;
      html += `<div class="carry-row"><span>${matches ? '✅ Needs + Wants + Savings left' : 'Needs + Wants + Savings left'}</span><b>${inr(Math.round(leftSum))}</b></div>`;
      if (!matches && plan.baseSource === 'fixed') html += `<p class="muted small plan-base">This uses your fixed amount; your real money left is ${inr(Math.round(plan.totalLeft))}.</p>`;
    } else if (plan.carry) {
      const short = plan.carry < 0;
      html += `<div class="carry-row"><span>${short ? '⚠️ Shortfall carried from ' : '↪️ Carried forward from '}${prevName}</span><b class="${short ? 'neg-ink' : 'pos'}">${short ? '−' : '+'}${inr(Math.abs(Math.round(plan.carry)))}</b></div>`;
    }
    el.innerHTML = html;
  }

  /* =====================================================================
   * HISTORY
   * ===================================================================== */
  const hist = { y: new Date().getFullYear(), m: new Date().getMonth(), f: 'all', q: '', mem: null };
  function renderHistory() {
    $('#h-month').textContent = monthName(hist.y, hist.m);
    const q = hist.q.trim().toLowerCase();
    let list = Store.active();
    if (!q) list = list.filter((t) => t.date >= monthStart(hist.y, hist.m) && t.date <= monthEnd(hist.y, hist.m));
    const hiddenN = isLocked() ? list.filter((t) => t.private).length : 0;
    list = visibleList(list);
    if (hist.f === 'private' && isLocked()) hist.f = 'all';
    if (hist.f === 'people') list = list.filter((t) => PEOPLE_TYPES.has(t.type));
    else if (hist.f === 'private') list = list.filter((t) => t.private);
    else if (hist.f !== 'all') list = list.filter((t) => t.type === hist.f);
    if (hist.mem != null) list = list.filter((t) => (t.member || '') === hist.mem);
    // filter chips: private (when unlocked), family members
    $('#h-private').hidden = isLocked() || !hasPrivate();
    $$('#h-filters .chip').forEach((x) => x.classList.toggle('on', x.dataset.f === hist.f));
    const mem = Store.members();
    $('#h-members').hidden = !mem.length;
    $('#h-members').innerHTML = mem.length ? [[null, 'Everyone'], ['', '👤 Self'], ...mem.map((m) => [m, m])].map(([k, label]) => `<button class="chip sm ${hist.mem === k ? 'on' : ''}" data-m="${k == null ? '*' : esc(k)}">${esc(label)}</button>`).join('') : '';
    if (q) list = list.filter((t) => [t.note, t.category, t.person, t.mode, String(t.amount), Parser.TYPES[t.type].label, t.date].join(' ').toLowerCase().includes(q));
    list.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));

    const spent = list.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const inc = list.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    $('#h-summary').textContent = list.length ? list.length + ' entries' + (spent ? ' · spent ' + inr(Math.round(spent)) : '') + (inc ? ' · income ' + inr(Math.round(inc)) : '') + (q ? ' · all months' : '') : '';
    $('.month-nav', $('#view-history')).style.visibility = q ? 'hidden' : '';

    // monthly payments not paid yet in this month (they are not counted as spent)
    const mFrom = monthStart(hist.y, hist.m), mTo = monthEnd(hist.y, hist.m), today = todayIso();
    const unpaid = (hist.f === 'all' || hist.f === 'expense' || hist.f === 'saving') && hist.mem == null
      ? Store.bills().filter((b) => b.date <= today && Store.billLeft(b) >= 0.5 && (q ? (b.note + ' ' + b.category).toLowerCase().includes(q) : b.date >= mFrom && b.date <= mTo) && (hist.f === 'all' || b.type === hist.f)) : [];
    let html = unpaid.length ? `<div class="day-head"><span>⏳ Not paid yet</span><span>${inr(Math.round(unpaid.reduce((sum, b) => sum + Store.billLeft(b), 0)))} due</span></div>` + group(unpaid.map(dueRowHTML).join('')) : '';
    let lastDate = '', rows = '';
    const dayTotals = {};
    list.forEach((t) => { if (t.type === 'expense') dayTotals[t.date] = (dayTotals[t.date] || 0) + t.amount; });
    for (const t of list) {
      if (t.date !== lastDate) {
        html += group(rows); rows = '';
        html += `<div class="day-head"><span>${niceDate(t.date)}</span><span>${dayTotals[t.date] ? 'spent ' + inr(Math.round(dayTotals[t.date])) : ''}</span></div>`;
        lastDate = t.date;
      }
      rows += rowHTML(t);
    }
    html += group(rows);
    $('#history').innerHTML = (html || (hiddenN && hist.f === 'all' && hist.mem == null ? '' : '<p class="empty">No entries ' + (q ? 'match "' + esc(hist.q) + '"' : 'in ' + monthName(hist.y, hist.m)) + '.</p>')) + (q ? '' : group(lockedRow(hiddenN)));
  }
  function dueRowHTML(b) {
    const paid = Store.billPaid(b);
    return `<button class="row due-row" data-pay="${esc(b.recurId)}"><span class="ico out">⏳</span>
      <span class="what"><b>${esc(b.note || b.category)}</b><span>Unpaid · ${monthShort(b.recurMonth)} · due ${shortDate(b.date)}${paid ? ' · ' + inr(paid) + ' paid' : ''}</span></span>
      <span class="amt">${inr(Store.billLeft(b))}<small>due</small></span></button>`;
  }
  $('#h-members').addEventListener('click', (e) => {
    const c = e.target.closest('[data-m]'); if (!c) return;
    hist.mem = c.dataset.m === '*' ? null : c.dataset.m;
    renderHistory();
  });
  $('#h-prev').addEventListener('click', () => { hist.m--; if (hist.m < 0) { hist.m = 11; hist.y--; } renderHistory(); });
  $('#h-next').addEventListener('click', () => { hist.m++; if (hist.m > 11) { hist.m = 0; hist.y++; } renderHistory(); });
  $('#search').addEventListener('input', (e) => { hist.q = e.target.value; renderHistory(); });
  $('#h-filters').addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    hist.f = c.dataset.f;
    $$('#h-filters .chip').forEach((x) => x.classList.toggle('on', x === c));
    renderHistory();
  });

  /* =====================================================================
   * PEOPLE (money given / taken)
   * ===================================================================== */
  function renderPeople() {
    const ppl = Store.people();
    $('#p-owe-me').textContent = inr(ppl.reduce((s, p) => s + Math.max(0, p.balance), 0));
    $('#p-i-owe').textContent = inr(ppl.reduce((s, p) => s + Math.max(0, -p.balance), 0));
    const open = ppl.filter((p) => Math.abs(p.balance) >= 0.5);
    const settled = ppl.filter((p) => Math.abs(p.balance) < 0.5);
    const row = (p) => {
      const status = p.balance > 0 ? 'Owes you' : p.balance < 0 ? 'You owe' : 'Settled';
      return `<button class="row" data-person="${esc(p.key)}">
        <span class="ico">${esc(p.name.charAt(0).toUpperCase())}</span>
        <span class="what"><b>${esc(p.name)}</b><span>${status} · last ${niceDate(p.last)}</span></span>
        <span class="amt ${p.balance > 0 ? 'in' : ''}">${p.balance ? inr(Math.abs(Math.round(p.balance * 100) / 100)) : '✓'}</span>
      </button>`;
    };
    $('#people').innerHTML = (open.length ? group(open.map(row).join('')) : '<p class="empty">No pending money with anyone. 🎉</p>') +
      (settled.length ? '<div class="day-head"><span>Settled</span></div>' + group(settled.map(row).join('')) : '');
  }
  let personKey = null;
  function openPerson(key) {
    personKey = key;
    const p = Store.people().find((x) => x.key === key);
    if (!p) { $('#person-sheet').close(); return; }
    $('#ps-name').textContent = p.name;
    $('#ps-balance').innerHTML = p.balance > 0 ? `${esc(p.name)} owes you <span class="pos">${inr(p.balance)}</span>` : p.balance < 0 ? `You owe ${esc(p.name)} ${inr(-p.balance)}` : 'All settled ✓';
    $('#ps-add').hidden = false;
    $('#ps-settle').hidden = Math.abs(p.balance) < 0.5;
    $('#ps-settle').textContent = p.balance > 0 ? 'Got money back' : 'I paid back';
    $('#ps-list').innerHTML = group(p.txns.slice().sort((a, b) => b.date.localeCompare(a.date)).map((t) => rowHTML(t, { showDate: true })).join(''));
    if (!$('#person-sheet').open) $('#person-sheet').showModal();
  }
  $('#people').addEventListener('click', (e) => { const b = e.target.closest('[data-person]'); if (b) openPerson(b.dataset.person); });
  $('#ps-list').addEventListener('click', () => $('#person-sheet').close());
  $('#ps-settle').addEventListener('click', () => {
    const p = Store.people().find((x) => x.key === personKey);
    $('#person-sheet').close();
    openSheet({ mode: 'new', rec: { type: p.balance > 0 ? 'got_back' : 'paid_back', amount: Math.abs(p.balance), person: p.name, note: '', date: todayIso(), source: 'manual' } });
  });
  $('#ps-add').addEventListener('click', () => {
    const p = Store.people().find((x) => x.key === personKey);
    $('#person-sheet').close();
    openSheet({ mode: 'new', rec: { type: 'lent', amount: null, person: p.name, note: '', date: todayIso(), source: 'manual' } });
  });

  /* =====================================================================
   * REPORTS
   * ===================================================================== */
  const rep = { range: 'month', y: new Date().getFullYear(), m: new Date().getMonth() };

  /** Work out the dates for the chosen period (financial year runs April–March). */
  function reportRange() {
    const { y, m } = rep;
    if (rep.range === 'month') return { from: monthStart(y, m), to: monthEnd(y, m), label: monthName(y, m), prev: { from: monthStart(y, m - 1), to: monthEnd(y, m - 1), label: new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'long' }) } };
    if (rep.range === '3m') return { from: monthStart(y, m - 2), to: monthEnd(y, m), label: monthName(y, m - 2, true) + ' – ' + monthName(y, m, true), prev: { from: monthStart(y, m - 5), to: monthEnd(y, m - 3), label: 'the 3 months before' } };
    if (rep.range === 'year') {
      const fy = m >= 3 ? y : y - 1; // FY starts in April
      return { from: fy + '-04-01', to: (fy + 1) + '-03-31', label: 'FY ' + fy + '–' + String(fy + 1).slice(2), fy, prev: { from: (fy - 1) + '-04-01', to: fy + '-03-31', label: 'last year' } };
    }
    const all = Store.active().map((t) => t.date).sort();
    return { from: all[0] || todayIso(), to: all[all.length - 1] || todayIso(), label: 'All time', prev: null };
  }

  function step(dir) {
    if (rep.range === 'month') rep.m += dir;
    else if (rep.range === '3m') rep.m += 3 * dir;
    else if (rep.range === 'year') rep.y += dir;
    const d = new Date(rep.y, rep.m, 1); rep.y = d.getFullYear(); rep.m = d.getMonth();
    renderReports();
  }
  $('#r-prev').addEventListener('click', () => step(-1));
  $('#r-next').addEventListener('click', () => step(1));
  $('#r-range').addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    rep.range = c.dataset.r; rep.y = new Date().getFullYear(); rep.m = new Date().getMonth();
    $$('#r-range .chip').forEach((x) => x.classList.toggle('on', x === c));
    renderReports();
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-table]');
    if (!b) return;
    const t = $('#' + b.dataset.table);
    t.hidden = !t.hidden;
    b.textContent = t.hidden ? 'Table' : 'Hide table';
  });

  // charts inside a folded section are drawn again once it opens (to fit its width)
  document.addEventListener('toggle', (e) => { if (e.target.open && e.target.closest && e.target.closest('#view-reports')) renderReports(); }, true);

  function pctChange(a, b) { return b ? Math.round(((a - b) / b) * 100) : null; }

  function renderReports() {
    const r = reportRange();
    $('#r-label').textContent = r.label;
    $$('#r-prev, #r-next').forEach((b) => { b.style.visibility = rep.range === 'all' ? 'hidden' : ''; });
    const t = Store.totals(r.from, r.to);
    const p = r.prev ? Store.totals(r.prev.from, r.prev.to) : null;

    // Tiles
    const delta = (a, b, upIsGood) => {
      const c = p ? pctChange(a, b) : null;
      if (c == null || !isFinite(c)) return '';
      return `<span class="tile-delta">${c > 0 ? '▲' : c < 0 ? '▼' : '='} ${Math.abs(c)}% vs ${esc(r.prev.label)}</span>`;
    };
    $('#r-tiles').innerHTML = `
      <div class="tile big"><span class="dot" style="background:var(--c-spend)"></span><span class="tile-label">Spent</span><span class="tile-value">${inr(Math.round(t.expense))}</span>${delta(t.expense, p && p.expense)}</div>
      <div class="tile big"><span class="dot" style="background:var(--c-income)"></span><span class="tile-label">Income</span><span class="tile-value">${inr(Math.round(t.income))}</span>${delta(t.income, p && p.income)}</div>
      <div class="tile big"><span class="dot" style="background:var(--c-save)"></span><span class="tile-label">Saved</span><span class="tile-value">${inr(Math.round(t.saving))}</span><span class="tile-delta">${t.income ? t.savingsRate + '% of income' : '&nbsp;'}</span></div>
      <div class="tile big"><span class="tile-label">Money left</span><span class="tile-value ${t.left < 0 ? '' : 'pos'}">${inr(Math.round(t.left))}</span><span class="tile-delta">${t.count} entries</span></div>`;

    // Budget plan (monthly view only)
    $('#r-plan-card').hidden = rep.range !== 'month';
    if (rep.range === 'month') {
      const plan = Store.budgetPlan(rep.y, rep.m);
      $('#r-plan-title').textContent = 'Budget plan · ' + plan.split.join('/');
      const now = new Date();
      renderPlan($('#r-plan'), plan, rep.y === now.getFullYear() && rep.m === now.getMonth());
      $('#r-plan-sum').textContent = plan.income ? plan.heads.map((h) => h.label + ' ' + inr(Math.round(h.left))).join(' · ') : 'Add income to see the split';
    }

    // Categories
    const cats = Store.byCategory(r.from, r.to);
    Charts.barList($('#r-cats'), cats.map((c) => ({ label: c.category, icon: Parser.iconFor('expense', c.category), amount: c.amount })), { empty: 'No spending in this period.' });
    const catTotal = cats.reduce((s, c) => s + c.amount, 0);
    $('#r-cat-table').innerHTML = `<table><thead><tr><th>Category</th><th class="num">Amount</th><th class="num">Share</th></tr></thead><tbody>${cats.map((c) => `<tr><td>${esc(c.category)}</td><td class="num">${inr(Math.round(c.amount))}</td><td class="num">${catTotal ? Math.round((c.amount / catTotal) * 100) : 0}%</td></tr>`).join('')}<tr><th>Total</th><th class="num">${inr(Math.round(catTotal))}</th><th></th></tr></tbody></table>`;

    // Daily (month) or monthly (longer periods) spending
    const spanDays = Math.max(1, Math.round((Math.min(new Date(r.to + 'T00:00:00'), new Date()) - new Date(r.from + 'T00:00:00')) / 864e5) + 1);
    $('#r-daily-sum').textContent = t.expense ? 'avg ' + inr(Math.round(t.expense / spanDays)) + ' a day' : 'No spending';
    $('#r-trend-sum').textContent = 'Income, spent and saved';
    if (rep.range === 'month') {
      $('#r-daily-title').textContent = 'Spending each day';
      const days = Store.byDay(rep.y, rep.m);
      Charts.columns($('#r-daily'), {
        labels: days.map((d) => String(d.day)),
        titles: days.map((d) => new Date(rep.y, rep.m, d.day).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })),
        series: [{ name: 'Spent', color: 'var(--c-spend)', values: days.map((d) => d.amount) }],
        labelEvery: 5, height: 180, aria: 'Spending each day',
      });
    } else {
      $('#r-daily-title').textContent = 'Spending each month';
      const a = new Date(r.from + 'T00:00:00'), b = new Date(r.to + 'T00:00:00');
      let n = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + 1;
      n = Math.max(1, Math.min(24, n));
      const months = Store.byMonth(b.getFullYear(), b.getMonth(), n);
      Charts.columns($('#r-daily'), {
        labels: months.map((x) => x.label),
        titles: months.map((x) => x.label + ' ' + x.year),
        series: [{ name: 'Spent', color: 'var(--c-spend)', values: months.map((x) => x.expense) }],
        height: 180, aria: 'Spending each month',
      });
    }

    // 6-month trend ending at the selected month
    const endY = rep.range === 'year' ? Math.min(new Date(r.to).getFullYear(), new Date().getFullYear()) : rep.y;
    const endM = rep.range === 'year' ? (new Date(r.to) > new Date() ? new Date().getMonth() : 2) : rep.m;
    const trend = Store.byMonth(endY, endM, 6);
    Charts.columns($('#r-trend'), {
      labels: trend.map((x) => x.label),
      titles: trend.map((x) => x.label + ' ' + x.year),
      series: [
        { name: 'Income', color: 'var(--c-income)', values: trend.map((x) => x.income) },
        { name: 'Spent', color: 'var(--c-spend)', values: trend.map((x) => x.expense) },
        { name: 'Saved', color: 'var(--c-save)', values: trend.map((x) => x.saving) },
      ],
      height: 200, aria: 'Income, spent and saved for the last 6 months',
    });
    $('#r-trend-table').innerHTML = `<table><thead><tr><th>Month</th><th class="num">Income</th><th class="num">Spent</th><th class="num">Saved</th></tr></thead><tbody>${trend.map((x) => `<tr><td>${x.label} ${x.year}</td><td class="num">${inr(Math.round(x.income))}</td><td class="num">${inr(Math.round(x.expense))}</td><td class="num">${inr(Math.round(x.saving))}</td></tr>`).join('')}</tbody></table>`;

    // By item name (every entry with the same name added up)
    renderItems(r);

    // Money spent on people (gifts, nothing expected back)
    const gifts = Store.gifts(r.from, r.to);
    $('#r-gifts-card').hidden = !gifts.length;
    if (gifts.length) {
      $('#r-gifts-total').textContent = inr(Math.round(gifts.reduce((s, g) => s + g.amount, 0))) + ' total';
      $('#r-gifts').innerHTML = gifts.map((g) => `<button class="item-row" data-gift="${esc(g.key)}">
        <span class="ico">${esc(g.name.charAt(0).toUpperCase())}</span>
        <span class="what"><b>${esc(g.name)}</b><span>${g.count} ${g.count === 1 ? 'time' : 'times'} · last ${shortDate(g.last)}</span></span>
        <span class="amt">${inr(Math.round(g.amount))}</span></button>`).join('');
    }

    // By family member
    const fam = Store.byMember(r.from, r.to).filter((x) => x.key === '' || x.count || Store.members().some((m) => m.toLowerCase() === x.key));
    const showFam = Store.members().length > 0 || fam.some((x) => x.key && x.count);
    $('#r-family-card').hidden = !showFam;
    if (showFam) {
      const famTotal = fam.reduce((s, x) => s + x.spent, 0);
      $('#r-family-total').textContent = fam.filter((x) => x.spent).sort((a, b) => b.spent - a.spent).slice(0, 3).map((x) => x.name + ' ' + inr(Math.round(x.spent))).join(' · ') || 'No spending';
      $('#r-family').innerHTML = fam.map((x) => `<button class="item-row" data-member="${esc(x.key)}">
        <span class="ico">${x.key ? esc(x.name.charAt(0).toUpperCase()) : '👤'}</span>
        <span class="what"><b>${esc(x.name)}</b><span>${x.count} ${x.count === 1 ? 'entry' : 'entries'}${x.saved ? ' · saved ' + inr(Math.round(x.saved)) : ''}${famTotal ? ' · ' + Math.round((x.spent / famTotal) * 100) + '%' : ''}</span>
          <span class="share"><i style="width:${famTotal ? Math.round((x.spent / famTotal) * 100) : 0}%"></i></span></span>
        <span class="amt">${inr(Math.round(x.spent))}</span></button>`).join('');
    }

    // Payment modes
    const modes = new Map();
    Store.shown().filter((x) => x.type === 'expense' && x.date >= r.from && x.date <= r.to).forEach((x) => modes.set(x.mode || 'Not set', (modes.get(x.mode || 'Not set') || 0) + x.amount));
    const modeIcons = { UPI: '📱', Cash: '💵', Card: '💳', Bank: '🏦', 'Not set': '❔' };
    const topMode = [...modes.entries()].sort((a, b) => b[1] - a[1])[0];
    $('#r-modes-sum').textContent = !topMode ? 'No spending' : topMode[0] === 'Not set' ? 'Add upi / cash / card to entries to see this' : 'Mostly ' + topMode[0] + ' · ' + inr(Math.round(topMode[1]));
    Charts.barList($('#r-modes'), [...modes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, icon: modeIcons[k] || '', amount: v })), { color: 'var(--accent)', empty: 'No spending in this period.' });

    // Insights
    const ins = insights(r, t, p, cats);
    $('#r-insights').innerHTML = ins.map((s) => '<li>' + s + '</li>').join('');
    const tmp = document.createElement('div'); tmp.innerHTML = ins[0] || '';
    $('#r-insights-sum').textContent = tmp.textContent;
  }

  let itemQuery = '', itemsExpanded = false;
  function renderItems(r) {
    const all = Store.byItem(r.from, r.to);
    const q = itemQuery.trim().toLowerCase();
    const list = q ? all.filter((x) => x.key.includes(q) || x.name.toLowerCase().includes(q) || x.category.toLowerCase().includes(q)) : all;
    const shown = (itemsExpanded || q) ? list : list.slice(0, 8);
    $('#r-items-count').textContent = all.length ? all.length + ' items · most on ' + all[0].name + ' ' + inr(Math.round(all[0].amount)) : 'Nothing yet';
    $('#r-items').innerHTML = shown.length ? shown.map((x) => `<button class="item-row" data-item="${esc(x.key)}">
        <span class="ico">${Parser.iconFor('expense', x.category)}</span>
        <span class="what"><b>${esc(x.name)}</b><span>${x.count}× · ${esc(x.category)}${x.count > 1 ? ' · avg ' + inr(Math.round(x.avg)) : ''}</span></span>
        <span class="amt">${inr(Math.round(x.amount))}</span></button>`).join('')
      : '<p class="empty">' + (q ? 'No item matches "' + esc(itemQuery) + '".' : 'No spending in this period.') + '</p>';
    const more = $('#r-items-more');
    more.hidden = !!q || list.length <= 8;
    more.textContent = itemsExpanded ? 'Show less' : 'Show all ' + list.length + ' items';
  }
  $('#r-item-search').addEventListener('input', (e) => { itemQuery = e.target.value; renderItems(reportRange()); });
  $('#r-items-more').addEventListener('click', () => { itemsExpanded = !itemsExpanded; renderItems(reportRange()); });
  $('#r-items').addEventListener('click', (e) => {
    const b = e.target.closest('[data-item]'); if (!b) return;
    const r = reportRange();
    const row = Store.byItem(r.from, r.to).find((x) => x.key === b.dataset.item);
    if (row) openGroup(row.name, row.amount + ' spent on this in ' + r.label, row.txns);
  });
  $('#r-family').addEventListener('click', (e) => {
    const b = e.target.closest('[data-member]'); if (!b) return;
    const r = reportRange();
    const k = b.dataset.member;
    const list = visibleList(Store.shown()).filter((t) => (t.member || '').toLowerCase() === k && (t.type === 'expense' || t.type === 'saving') && t.date >= r.from && t.date <= r.to);
    const name = k ? (Store.members().find((m) => m.toLowerCase() === k) || list[0] && list[0].member || k) : 'Self';
    openGroup('👤 ' + name, '', list);
  });
  $('#r-gifts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-gift]'); if (!b) return;
    const r = reportRange();
    const g = Store.gifts(r.from, r.to).find((x) => x.key === b.dataset.gift);
    if (g) openGroup('🎁 ' + g.name, 'Spent on ' + g.name + ' (not a loan)', g.txns);
  });

  /** Show every entry behind one item / person row, reusing the person sheet. */
  function openGroup(title, subtitle, txns, opts) {
    opts = opts || {};
    personKey = null;
    $('#ps-name').textContent = title;
    const total = txns.reduce((s, t) => s + t.amount, 0);
    $('#ps-balance').innerHTML = inr(Math.round(total)) + ' <span class="muted small">· ' + txns.length + ' ' + (txns.length === 1 ? 'entry' : 'entries') + '</span>' +
      (opts.hint ? '<span class="ps-hint">' + opts.hint + '</span>' : '');
    $('#ps-settle').hidden = true;
    $('#ps-add').hidden = true;
    $('#ps-list').innerHTML = (txns.length || opts.hidden ? group(txns.slice().sort((a, b) => b.date.localeCompare(a.date)).map((t) => rowHTML(t, { showDate: true })).join('') + lockedRow(opts.hidden || 0))
      : '<p class="empty">' + (opts.empty || 'Nothing here yet.') + '</p>');
    if (!$('#person-sheet').open) $('#person-sheet').showModal();
  }

  /** Every Needs / Wants / Savings entry of one month (tap a budget head). */
  const HEAD_TITLE = { need: '🧱 Needs', want: '🎈 Wants', saving: '🐷 Savings' };
  function openHead(key, ym) {
    const [y, m] = ym.split('-').map(Number);
    const from = monthStart(y, m - 1), to = monthEnd(y, m - 1);
    const all = Store.active().filter((t) => t.date >= from && t.date <= to && Store.headOf(t) === key);
    const list = visibleList(all);
    openGroup(HEAD_TITLE[key] + ' · ' + monthName(y, m - 1), '', list, {
      hidden: all.length - list.length,
      hint: key === 'saving' ? '' : 'Tap an entry to move it between Need and Want.',
      empty: key === 'saving' ? 'Nothing saved this month yet. Type <b>sip 5000</b>.' : 'No ' + (key === 'need' ? 'Needs' : 'Wants') + ' spending this month yet.',
    });
  }
  const planHeadClick = (e) => {
    const h = e.target.closest('[data-plan-head]');
    if (!h || (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();   // inside the folded plan: don't open/close it
    openHead(h.dataset.planHead, h.dataset.ym);
  };
  document.addEventListener('click', planHeadClick);
  document.addEventListener('keydown', planHeadClick);

  function insights(r, t, p, cats) {
    const out = [];
    const list = Store.shown().filter((x) => x.date >= r.from && x.date <= r.to);
    if (!list.length) return ['No entries in this period yet.'];
    if (cats.length) {
      const total = cats.reduce((s, c) => s + c.amount, 0);
      out.push(`Your biggest spend was <b>${esc(cats[0].category)}</b>: ${inr(Math.round(cats[0].amount))} (${Math.round((cats[0].amount / total) * 100)}% of spending).`);
    }
    if (p && p.expense && t.expense) {
      const c = pctChange(t.expense, p.expense);
      out.push(c > 0 ? `You spent <b>${c}% more</b> than ${esc(r.prev.label)} (${inr(Math.round(t.expense - p.expense))} extra).` : c < 0 ? `You spent <b>${-c}% less</b> than ${esc(r.prev.label)} — well done! 👏` : `Same spending as ${esc(r.prev.label)}.`);
      const prevCats = new Map(Store.byCategory(r.prev.from, r.prev.to).map((c) => [c.category, c.amount]));
      const jump = cats.map((c) => ({ c: c.category, d: c.amount - (prevCats.get(c.category) || 0) })).sort((a, b) => b.d - a.d)[0];
      if (jump && jump.d > 0 && jump.d >= t.expense * 0.05) out.push(`<b>${esc(jump.c)}</b> went up the most: +${inr(Math.round(jump.d))}.`);
    }
    const items = Store.byItem(r.from, r.to).filter((x) => x.count > 1);
    if (items.length) out.push(`You spent most often on <b>${esc(items[0].name)}</b>: ${inr(Math.round(items[0].amount))} across ${items[0].count} entries.`);
    const big = list.filter((x) => x.type === 'expense' && !x.masked).sort((a, b) => b.amount - a.amount)[0];
    if (big) out.push(`Biggest single spend: ${inr(big.amount)} on ${esc(big.note || big.category)} (${niceDate(big.date)}).`);
    const days = Math.max(1, Math.round((Math.min(new Date(r.to + 'T00:00:00'), new Date()) - new Date(r.from + 'T00:00:00')) / 864e5) + 1);
    if (t.expense) out.push(`Average spending: ${inr(Math.round(t.expense / days))} per day.`);
    if (t.income) out.push(t.saving ? `You saved <b>${t.savingsRate}%</b> of your income.${t.savingsRate < 20 ? ' Try for 20%+ — e.g. set up a SIP on salary day.' : ' 💪'}` : 'Nothing marked as saved yet — type e.g. <b>sip 5000</b> when you invest.');
    else out.push('Add your income (e.g. <b>salary 55000</b>) to see how much you save.');
    const ppl = Store.people().filter((x) => x.balance > 0).slice(0, 2);
    ppl.forEach((x) => out.push(`${esc(x.name)} still owes you ${inr(x.balance)}.`));
    return out;
  }

  /* ---------- Downloads -------------------------------------------------- */
  const fileLabel = () => reportRange().label.replace(/[^\w]+/g, '-').replace(/-+$/, '');
  $('#dl-csv').addEventListener('click', async () => {
    if (!(await okToExport())) return;
    const r = reportRange();
    download('Kaasu-' + fileLabel() + '.csv', Store.toCSV(r.from, r.to), 'text/csv');
    toast('Downloaded — open it with Excel or Google Sheets.');
  });
  $('#dl-json').addEventListener('click', backupDownload);
  $('#dl-pdf').addEventListener('click', async () => {
    if (!(await okToExport())) return;
    buildPrintReport();
    toast(IS_IOS ? 'In the print screen, tap Share (□↑) → Save to Files to keep it as a PDF.' : 'Choose "Save as PDF" as the printer.');
    setTimeout(() => window.print(), 300);
  });
  $('#dl-drive').addEventListener('click', async () => {
    if (!(await okToExport())) return;
    const r = reportRange();
    try {
      if (!Drive.isConfigured()) { toast('Set up Google Drive in Settings first.'); go('settings'); return; }
      if (!Drive.hasToken()) await Drive.connect();
      await Drive.saveReport('Kaasu ' + r.label + '.csv', Store.toCSV(r.from, r.to), 'text/csv');
      toast('Saved in Drive → Expense Tracker → Reports');
    } catch (e) { toast(e.message); }
  });

  function buildPrintReport() {
    const r = reportRange();
    const t = Store.totals(r.from, r.to);
    const cats = Store.byCategory(r.from, r.to);
    const catTotal = cats.reduce((s, c) => s + c.amount, 0);
    const list = Store.active().filter((x) => x.date >= r.from && x.date <= r.to).sort((a, b) => a.date.localeCompare(b.date));
    const ppl = Store.people().filter((p) => Math.abs(p.balance) >= 0.5);
    const fam = Store.members().length ? Store.byMember(r.from, r.to).filter((x) => x.count) : [];
    const html = `
      <h1>Kaasu — Money report</h1>
      <div>${esc(r.label)} (${r.from} to ${r.to}) · generated ${new Date().toLocaleString('en-IN')}</div>
      <div class="ptiles">
        <div>Spent<b>${inr(Math.round(t.expense))}</b></div><div>Income<b>${inr(Math.round(t.income))}</b></div>
        <div>Saved<b>${inr(Math.round(t.saving))}</b></div><div>Money left<b>${inr(Math.round(t.left))}</b></div>
      </div>
      ${rep.range === 'month' ? (() => { const pl = Store.budgetPlan(rep.y, rep.m); return `<h2>Budget plan (${pl.split.join('/')})${pl.base ? ' on ' + inr(Math.round(pl.base)) : ''}</h2><table><thead><tr><th>Head</th><th class="num">Budget</th><th class="num">Used</th><th class="num">Left</th></tr></thead><tbody>${pl.heads.map((h) => `<tr><td>${h.label} (${h.pct}%)</td><td class="num">${inr(h.budget)}</td><td class="num">${inr(Math.round(h.used))}</td><td class="num">${inr(Math.round(h.left))}</td></tr>`).join('')}${pl.carry ? `<tr><td>Carried forward</td><td></td><td></td><td class="num">${inr(Math.round(pl.carry))}</td></tr>` : ''}</tbody></table>`; })() : ''}
      <h2>Quick insights</h2><ul>${insights(r, t, r.prev ? Store.totals(r.prev.from, r.prev.to) : null, cats).map((s) => '<li>' + s + '</li>').join('')}</ul>
      <h2>Where the money went</h2>
      <div id="print-bars"></div>
      <table><thead><tr><th>Category</th><th class="num">Amount</th><th class="num">Share</th></tr></thead><tbody>
      ${cats.map((c) => `<tr><td>${esc(c.category)}</td><td class="num">${inr(Math.round(c.amount))}</td><td class="num">${catTotal ? Math.round((c.amount / catTotal) * 100) : 0}%</td></tr>`).join('')}</tbody></table>
      ${ppl.length ? `<h2>Money given & taken (pending)</h2><table><thead><tr><th>Person</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>${ppl.map((p) => `<tr><td>${esc(p.name)}</td><td>${p.balance > 0 ? 'Owes you' : 'You owe'}</td><td class="num">${inr(Math.abs(p.balance))}</td></tr>`).join('')}</tbody></table>` : ''}
      ${(() => { const its = Store.byItem(r.from, r.to); return its.length ? `<h2>By item name</h2><table><thead><tr><th>Item</th><th>Category</th><th class="num">Times</th><th class="num">Total</th></tr></thead><tbody>${its.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.category)}</td><td class="num">${x.count}</td><td class="num">${inr(Math.round(x.amount))}</td></tr>`).join('')}</tbody></table>` : ''; })()}
      ${fam.length ? `<h2>By family member</h2><table><thead><tr><th>Member</th><th class="num">Entries</th><th class="num">Spent</th><th class="num">Saved</th></tr></thead><tbody>${fam.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${x.count}</td><td class="num">${inr(Math.round(x.spent))}</td><td class="num">${inr(Math.round(x.saved))}</td></tr>`).join('')}</tbody></table>` : ''}
      ${(() => { const gs = Store.gifts(r.from, r.to); return gs.length ? `<h2>Spent on people (not loans)</h2><table><thead><tr><th>Person</th><th class="num">Times</th><th class="num">Total</th></tr></thead><tbody>${gs.map((g) => `<tr><td>${esc(g.name)}</td><td class="num">${g.count}</td><td class="num">${inr(Math.round(g.amount))}</td></tr>`).join('')}</tbody></table>` : ''; })()}
      <h2>All entries (${list.length})</h2>
      <table><thead><tr><th>Date</th><th>Type</th><th>Category / person</th><th>Description</th>${fam.length ? '<th>Spent by</th>' : ''}<th>Paid by</th><th class="num">Amount</th></tr></thead><tbody>
      ${list.map((x) => `<tr><td>${x.date}</td><td>${Store.TYPE_LABEL[x.type]}</td><td>${esc(x.person || x.category)}</td><td>${x.private ? '🔒 ' : ''}${esc(x.note)}</td>${fam.length ? `<td>${esc(x.member || 'Self')}</td>` : ''}<td>${esc(x.mode)}</td><td class="num">${INFLOW.has(x.type) ? '+' : '−'}${inr(x.amount)}</td></tr>`).join('')}</tbody></table>`;
    $('#print-report').innerHTML = html;
    Charts.barList($('#print-bars'), cats.map((c) => ({ label: c.category, icon: Parser.iconFor('expense', c.category), amount: c.amount })));
  }

  /* =====================================================================
   * SETTINGS
   * ===================================================================== */
  function renderSettings() {
    $('#origin-hint').textContent = location.origin;
    $('#redirect-hint').textContent = Drive.redirectUri();
    if (document.activeElement !== $('#client-id')) $('#client-id').value = Drive.clientId();
    const connected = Drive.wasConnected();
    $('#drive-setup').hidden = connected && !!Drive.clientId();
    $('#drive-setup').open = !Drive.isConfigured() && $('#drive-setup').open;
    $('#drive-connect').hidden = connected;
    $('#drive-sync').hidden = !connected;
    $('#drive-disconnect').hidden = !connected;
    $('#drive-status').innerHTML = !Drive.isConfigured() ? 'Your records are saved on this phone only. Google sign-in needs a one-time setup — open <b>Advanced</b> below.'
      : !connected ? 'Your records are saved on this phone only. Sign in to keep a copy in your Google Drive and use Kaasu on more phones.'
      : '✅ Signed in' + (Drive.account() ? ' as <b>' + esc(Drive.account()) + '</b>' : '') + '. Records are saved in <b>My Drive → Expense Tracker</b>.' +
        (Drive.lastSync() ? '<br>Last synced: ' + new Date(Drive.lastSync()).toLocaleString('en-IN') + ' · ' + Store.active().length + ' entries' : '') +
        (Drive.clientId() ? '<br><span class="muted">Own Client ID …' + esc(Drive.clientId().split('.')[0].slice(-6)) + ' — use the same one on all your phones.</span>' : '');
    renderMembers();
    renderPrivacy();
    renderLook();
    settingsSummaries();
    renderRules();
    renderPlanSettings();
    renderAI();
    $('#budget').value = Store.get().settings.budget || '';
    const learned = Object.entries(Store.get().learned);
    $('#learned').innerHTML = learned.length ? learned.map(([k, v]) => `<button data-forget="${esc(k)}" title="Tap to forget">${esc(k)} → ${esc(v.category)} ✕</button>`).join('') : '<span class="muted small">Nothing yet.</span>';
    $('#version').textContent = 'Kaasu v' + APP_VERSION + ' · ' + Store.active().length + ' entries on this phone';
  }
  /** The one line under each folded Settings section. */
  function settingsSummaries() {
    const st = Store.get().settings;
    const set = (id, text) => { $('#' + id).textContent = text; };
    set('sum-drive', Drive.wasConnected() ? '✅ Signed in' + (Drive.account() ? ' · ' + Drive.account() : '') : 'Not backed up yet — tap to sign in');
    set('sum-backup', 'Save or restore a backup file');
    const mem = Store.members();
    set('sum-family', mem.length ? 'Self, ' + mem.join(', ') : 'Just you — add Papa, Mummy…');
    const nPriv = Store.active().filter((t) => t.private).length;
    set('sum-privacy', Lock.hasPin() ? 'PIN on' + (Lock.lockApp() ? ' · locks on open' : '') + ' · ' + nPriv + ' private' : 'No PIN set');
    set('sum-plan', (st.split || [50, 30, 20]).join(' / ') + ' · ' + (st.baseMode === 'fixed' ? 'fixed ' + inr(+st.baseAmount || 0) : 'from income'));
    const rules = Store.rules().filter((x) => x.active);
    set('sum-rules', rules.length ? rules.length + ' active · ' + rules.slice(0, 2).map((x) => x.note || x.category).join(', ') + (rules.length > 2 ? '…' : '') : 'Rent, salary, SIP… added each month');
    const skin = Look.SKINS.find((k) => k.id === Look.skin()), font = Look.FONTS.find((f) => f.id === Look.font());
    set('sum-look', skin.name + ' · ' + font.name + ' · ' + ({ '': 'phone mode', light: 'light', dark: 'dark' }[Look.mode()]));
    const keys = AI.geminiKeys().length + (AI.claudeKey() ? 1 : 0);
    set('sum-ai', AI.isOn() ? '✅ On · ' + keys + ' key' + (keys > 1 ? 's' : '') : 'Off — reads bills on the phone');
    set('sum-install', IS_STANDALONE ? '✅ Installed' : 'Add Kaasu to your home screen');
    const nLearned = Object.keys(Store.get().learned || {}).length;
    set('sum-learned', nLearned ? nLearned + ' words remembered' : 'Nothing yet');
  }

  /* ---------- Budget plan settings -------------------------------------- */
  let customSplit = false; // you picked "Custom…" — keep the % boxes open
  function renderPlanSettings() {
    const st = Store.get().settings;
    const split = st.split || [50, 30, 20];
    const presets = Store.SPLIT_PRESETS;
    const idx = presets.findIndex((p) => p.split.join() === split.join());
    $('#split-preset').innerHTML = presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join('') + '<option value="custom">Custom…</option>';
    const custom = customSplit || idx < 0;
    $('#split-preset').value = custom ? 'custom' : String(idx);
    $('#split-custom').hidden = !custom;
    $('#split-sum').hidden = !custom;
    // don't overwrite a box you're typing in
    [['#split-need', 0], ['#split-want', 1], ['#split-save', 2]].forEach(([id, i]) => { if (document.activeElement !== $(id)) $(id).value = split[i]; });
    $('#base-mode').value = st.baseMode || 'income';
    $('#base-amount-wrap').hidden = st.baseMode !== 'fixed';
    $('#base-amount').value = st.baseAmount || '';
    $('#carry').checked = st.carryForward !== false;
    const cats = Object.keys(Parser.EXPENSE_CATEGORIES);
    $('#cat-heads').innerHTML = cats.map((c) => {
      const h = Store.categoryHead(c);
      return `<button class="${h}" data-cat-head="${esc(c)}">${Parser.iconFor('expense', c)} ${esc(c)}: <b>${h === 'need' ? 'Need' : 'Want'}</b></button>`;
    }).join('');
  }
  $('#split-preset').addEventListener('change', (e) => {
    customSplit = e.target.value === 'custom';
    if (customSplit) { $('#split-custom').hidden = false; $('#split-sum').hidden = false; checkCustom(); return; }
    Store.setSetting('split', Store.SPLIT_PRESETS[+e.target.value].split.slice());
    toast('Split set to ' + Store.get().settings.split.join(' / '));
  });
  function checkCustom() {
    const v = [+$('#split-need').value || 0, +$('#split-want').value || 0, +$('#split-save').value || 0];
    const sum = v.reduce((a, b) => a + b, 0);
    $('#split-sum').textContent = sum === 100 ? '✓ Adds up to 100%' : 'Total is ' + sum + '% — make it 100%';
    $('#split-sum').style.color = sum === 100 ? 'var(--pos)' : 'var(--danger)';
    if (sum === 100 && v.join() !== (Store.get().settings.split || []).join()) Store.setSetting('split', v);
  }
  ['#split-need', '#split-want', '#split-save'].forEach((id) => $(id).addEventListener('input', checkCustom));
  $('#base-mode').addEventListener('change', (e) => { Store.setSetting('baseMode', e.target.value); });
  $('#base-amount').addEventListener('change', (e) => Store.setSetting('baseAmount', Math.max(0, +e.target.value || 0)));
  $('#carry').addEventListener('change', (e) => Store.setSetting('carryForward', e.target.checked));
  $('#cat-heads').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat-head]'); if (!b) return;
    const c = b.dataset.catHead;
    const map = Object.assign({}, Store.get().settings.bucketMap);
    const next = Store.categoryHead(c) === 'need' ? 'want' : 'need';
    if ((next === 'need') === Store.NEED_CATEGORIES.has(c)) delete map[c]; else map[c] = next;
    Store.setSetting('bucketMap', map);
  });

  /* ---------- Monthly auto entries ------------------------------------- */
  function ruleStatus(r) {
    const due = Store.dues().find((g) => g.ruleId === r.id);
    if (due) return ` · <b class="neg-ink">⏳ ${inr(due.left)} due</b>`;
    const till = Store.paidTill(r);
    if (till) return ' · ✅ paid till ' + monthShort(till, true);
    return Store.asksPaid(r) ? ' · you mark it paid' : '';
  }
  function renderRules() {
    const list = Store.rules().sort((a, b) => (b.active - a.active) || a.day - b.day);
    $('#rules').innerHTML = list.length ? list.map((r) => {
      const next = r.active ? Store.nextRun(r) : '';
      const inflow = r.type === 'income';
      return `<button class="row ${r.active ? '' : 'paused'}" data-rule="${r.id}">
        <span class="ico">${Parser.iconFor(r.type, r.category)}</span>
        <span class="what"><b>${esc(r.note || r.category)}</b><span>${r.active ? 'Every month on the ' + ordinal(r.day) + (next ? ' · next ' + shortDate(next) : '') : '⏸ Paused'}${ruleStatus(r)}</span></span>
        <span class="amt ${inflow ? 'in' : ''}">${inflow ? '+' : '−'}${inr(r.amount)}</span>
      </button>`;
    }).join('') : '';
    $('#rules').innerHTML = list.length ? group($('#rules').innerHTML) : '<p class="empty">None yet. Type <b>rent 12000 every month on 5th</b>.</p>';
  }
  $('#rules').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rule]');
    if (b) openRule(Store.rules().find((r) => r.id === b.dataset.rule));
  });
  $('#rule-add').addEventListener('click', () => openRule(null));

  let ruleEditing = null;
  function fillRuleCategories(type, selected) {
    const names = Object.keys(Parser.categoriesFor(type));
    if (selected && !names.includes(selected)) names.push(selected);
    $('#r-category').innerHTML = names.map((n) => `<option ${n === selected ? 'selected' : ''}>${esc(n)}</option>`).join('');
  }
  $('#r-type').addEventListener('change', (e) => fillRuleCategories(e.target.value, e.target.value === 'income' ? 'Salary' : e.target.value === 'saving' ? 'SIP / Mutual fund' : 'Rent'));
  function thisMonthEntry(rule) {
    return rule && Store.get().txns.find((t) => t.recurId === rule.id && t.recurMonth === curYm() && !t.deleted);
  }
  function openRule(rule) {
    ruleEditing = rule;
    const r = rule || { type: 'expense', amount: '', category: 'Rent', note: '', day: new Date().getDate(), mode: '', active: true };
    $('#rule-title').textContent = rule ? 'Edit monthly entry' : 'New monthly entry';
    $('#r-type').value = r.type;
    fillRuleCategories(r.type, r.category);
    $('#r-amount').value = r.amount;
    $('#r-note').value = r.note || '';
    $('#r-day').value = r.day;
    $('#r-mode').value = r.mode || '';
    $('#r-active').checked = r.active !== false;
    $('#r-ask').checked = Store.asksPaid(r);
    $('#r-advance').hidden = !rule || !Store.asksPaid(rule) || rule.type === 'income';
    askLabel();
    $('#r-delete').hidden = !rule;
    const cur = thisMonthEntry(rule);
    $('#r-now-wrap').hidden = !!rule && !cur;
    $('#r-now').checked = true;
    $('#r-now-label').textContent = rule ? 'Also change this month\'s entry (' + inr(cur ? cur.amount : 0) + ')' : 'Also add it for this month (if the day has come)';
    $('#r-info').textContent = rule ? 'Changes apply to future months. Past entries stay as they are — tap one in History to edit it.' : 'Kaasu adds it automatically when you open the app on or after that day.';
    $('#rule-sheet').showModal();
  }
  $('#rule-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = parseFloat($('#r-amount').value);
    if (!(amount > 0)) { toast('Please enter an amount.'); return; }
    const day = parseInt($('#r-day').value, 10);
    if (!(day >= 1 && day <= 31)) { toast('Day must be between 1 and 31.'); return; }
    const vals = { type: $('#r-type').value, amount, category: $('#r-category').value, note: $('#r-note').value.trim() || $('#r-category').value, day, mode: $('#r-mode').value, active: $('#r-active').checked, askPaid: $('#r-ask').checked };
    if (ruleEditing) {
      const cur = thisMonthEntry(ruleEditing);
      Store.updateRule(ruleEditing.id, vals);
      if (cur && $('#r-now').checked) Store.update(cur.id, { type: vals.type, amount, category: vals.category, note: vals.note, mode: vals.mode });
      toast('Monthly entry updated');
    } else {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const startMonth = $('#r-now').checked ? curYm() : next.getFullYear() + '-' + String(next.getMonth() + 1).padStart(2, '0');
      Store.addRule(Object.assign(vals, { startMonth }));
      toast('🔁 ' + vals.note + ' ' + inr(amount) + ' every month on the ' + ordinal(day));
    }
    Store.applyRecurring();
    Store.save();
    $('#rule-sheet').close();
  });
  function askLabel() {
    const inc = $('#r-type').value === 'income';
    $('#r-ask-label').textContent = inc ? 'Ask me before marking it received (shows as due until received)' : 'Ask me before marking it paid (shows as due until paid)';
    if (!ruleEditing) $('#r-info').textContent = $('#r-ask').checked ? 'On that day it shows under "Dues to pay" on Home until you mark it paid — part payments are fine.' : 'Kaasu adds it automatically when you open the app on or after that day.';
  }
  $('#r-type').addEventListener('change', () => { if (!ruleEditing) $('#r-ask').checked = $('#r-type').value !== 'income'; askLabel(); });
  $('#r-ask').addEventListener('change', askLabel);
  $('#r-advance').addEventListener('click', () => { const id = ruleEditing.id; $('#rule-sheet').close(); openAdvance(id); });

  $('#r-delete').addEventListener('click', () => {
    const owed = Store.dues().find((g) => g.ruleId === ruleEditing.id);
    if (!confirm('Stop this monthly entry? Entries already added stay in your history.' + (owed ? ' Its ' + inr(owed.left) + ' still due stays on Home until you pay or skip it.' : ''))) return;
    Store.removeRule(ruleEditing.id);
    Store.save();
    $('#rule-sheet').close();
    toast('Monthly entry removed');
  });

  $('#save-client').addEventListener('click', () => {
    const v = $('#client-id').value.trim();
    if (v && !/\.apps\.googleusercontent\.com$/.test(v)) { toast('That doesn\'t look right — it should end with .apps.googleusercontent.com'); return; }
    Drive.setClientId(v);
    toast(v ? 'Client ID saved. Now tap Connect.' : 'Client ID removed.');
    renderSettings();
  });
  $('#drive-connect').addEventListener('click', () => {
    if (!Drive.isConfigured()) { $('#drive-setup').open = true; $('#client-id').focus(); toast('Paste a Google Client ID first (steps below).'); return; }
    doSync(true);
  });
  $('#drive-sync').addEventListener('click', () => doSync(true));
  $('#drive-disconnect').addEventListener('click', () => {
    if (!confirm('Sign out and stop saving to Google Drive? Your data stays on this phone and in Drive.')) return;
    Drive.disconnect(); setPill(); renderSettings();
  });
  $('#budget').addEventListener('change', (e) => Store.setSetting('budget', Math.max(0, +e.target.value || 0)));

  /* ---------- Family members ------------------------------------------- */
  function renderMembers() {
    const mem = Store.members();
    $('#members').innerHTML = '<span class="member-self">👤 Self (you)</span>' + mem.map((m) => `<button data-rm-member="${esc(m)}" aria-label="Remove ${esc(m)}">${esc(m)} ✕</button>`).join('');
  }
  function addMember() {
    const name = $('#member-new').value.trim().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 24);
    if (!name) return;
    const mem = Store.members();
    if (/^(self|me|myself)$/i.test(name) || mem.some((m) => m.toLowerCase() === name.toLowerCase())) { toast(name + ' is already there.'); return; }
    Store.setSetting('members', mem.concat(name));
    $('#member-new').value = '';
    toast('Added ' + name + '. Pick them under "Spent by", or type ' + name.toLowerCase() + ': medicine 200');
  }
  $('#member-add').addEventListener('click', addMember);
  $('#member-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addMember(); } });
  $('#members').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm-member]'); if (!b) return;
    const name = b.dataset.rmMember;
    if (!confirm('Remove ' + name + ' from the list? Their entries stay (still marked ' + name + ').')) return;
    Store.setSetting('members', Store.members().filter((m) => m !== name));
    if (qMember === name) qMember = '';
  });

  /* ---------- Privacy & PIN --------------------------------------------- */
  function renderPrivacy() {
    const pin = Lock.hasPin();
    const n = Store.active().filter((t) => t.private).length;
    $('#pin-set').hidden = pin;
    $('#pin-change').hidden = !pin;
    $('#pin-remove').hidden = !pin;
    $('#lock-opts').hidden = !pin;
    $('#lock-app').checked = Lock.lockApp();
    $('#lock-now').hidden = !Lock.isUnlocked();
    $('#lock-status').innerHTML = !pin ? 'Set a PIN to hide private entries' + (n ? ' (' + n + ' private ' + (n === 1 ? 'entry' : 'entries') + ' are hidden on this phone until you do)' : '') + '.'
      : (Lock.isUnlocked() ? '🔓 Unlocked' : '🔒 Locked') + ' · ' + n + ' private ' + (n === 1 ? 'entry' : 'entries') + '. Mark an entry private when you add or edit it.';
  }
  $('#pin-set').addEventListener('click', async () => { if (await Lock.ask({ mode: 'set' })) toast('PIN set 🔒'); });
  $('#pin-change').addEventListener('click', async () => {
    if (!(await Lock.ask({ mode: 'check', reason: 'Enter your current PIN.' }))) return;
    if (await Lock.ask({ mode: 'set', reason: 'Now choose a new PIN.' })) toast('PIN changed');
  });
  $('#pin-remove').addEventListener('click', async () => {
    if (!(await Lock.ask({ mode: 'check', reason: 'Enter your PIN to remove it.' }))) return;
    const priv = Store.active().filter((t) => t.private);
    if (!confirm(priv.length ? 'Remove the PIN? Your ' + priv.length + ' private ' + (priv.length === 1 ? 'entry becomes a normal entry' : 'entries become normal entries') + ' that anyone with your phone can see.' : 'Remove the PIN?')) return;
    priv.forEach((t) => Store.update(t.id, { private: false }));
    Lock.removePin();
    toast('PIN removed');
  });
  $('#lock-app').addEventListener('change', (e) => { Lock.setLockApp(e.target.checked); toast(e.target.checked ? 'Kaasu will ask for your PIN when it opens' : 'Only private entries need the PIN now'); });
  $('#lock-now').addEventListener('click', () => { Lock.lock(); toast('Locked 🔒'); });

  // the lock button at the top: lock / unlock straight away
  function renderLockBtn() {
    const b = $('#lock-btn');
    b.hidden = !Lock.hasPin() && !hasPrivate();
    b.textContent = Lock.isUnlocked() ? '🔓' : '🔒';
    b.setAttribute('aria-label', Lock.isUnlocked() ? 'Lock private entries' : 'Unlock private entries');
    b.classList.toggle('unlocked', Lock.isUnlocked());
  }
  $('#lock-btn').addEventListener('click', () => { if (Lock.isUnlocked()) { Lock.lock(); toast('Locked 🔒'); } else Lock.unlockPrivate(); });
  Lock.onChange((unlocked) => {
    Store.setMasked(!unlocked);
    render(); renderLockBtn();
    if ($('#person-sheet').open) $('#person-sheet').close();
  });

  /* ---------- Look & feel ---------------------------------------------- */
  function renderLook() {
    $('#skins').innerHTML = Look.SKINS.map((k) => `<button type="button" class="skin ${Look.skin() === k.id ? 'on' : ''}" data-skin="${k.id}" aria-pressed="${Look.skin() === k.id}">
      <i style="background:linear-gradient(135deg, ${k.a}, ${k.b})"></i><span>${esc(k.name)}</span></button>`).join('');
    $$('#mode-seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === Look.mode()));
    if ($('#sum-look').textContent) settingsSummaries();
    $('#fonts').innerHTML = Look.FONTS.map((f) => `<button type="button" class="font-pick ${Look.font() === f.id ? 'on' : ''}" data-font="${f.id}" aria-pressed="${Look.font() === f.id}"><b class="ff-${f.id}">Aa ₹</b><span>${esc(f.name)}</span></button>`).join('');
  }
  $('#skins').addEventListener('click', (e) => { const b = e.target.closest('[data-skin]'); if (b) { Look.set({ skin: b.dataset.skin }); renderLook(); } });
  $('#mode-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) { Look.set({ mode: b.dataset.mode }); renderLook(); } });
  $('#fonts').addEventListener('click', (e) => { const b = e.target.closest('[data-font]'); if (b) { Look.set({ font: b.dataset.font }); renderLook(); } });
  // the font buttons show each font, so load them all while Settings is open
  let fontsPreloaded = false;
  function preloadFonts() {
    if (fontsPreloaded) return; fontsPreloaded = true;
    const css = Look.FONTS.filter((f) => f.css).map((f) => 'family=' + f.css).join('&');
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?' + css + '&display=swap';
    document.head.appendChild(l);
  }

  /* ---------- Help ------------------------------------------------------- */
  $('#help-btn').addEventListener('click', () => Help.tour());
  $('#tour-settings').addEventListener('click', () => Help.tour());
  $('#tips-typing').addEventListener('click', () => Help.tip('quick'));
  $('#learned').addEventListener('click', (e) => { const b = e.target.closest('[data-forget]'); if (b) Store.forget(b.dataset.forget); });

  async function backupDownload() {
    if (!(await okToExport())) return;
    download('Kaasu-backup-' + todayIso() + '.json', JSON.stringify(Store.get(), null, 1), 'application/json');
    toast('Backup downloaded. Keep it somewhere safe.');
  }
  $('#backup-dl').addEventListener('click', backupDownload);
  $('#backup-restore').addEventListener('click', () => $('#file-restore').click());
  $('#file-restore').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const incoming = JSON.parse(await f.text());
      if (!incoming || !Array.isArray(incoming.txns)) throw new Error('bad');
      Store.replaceAll(Store.merge(Store.get(), incoming));
      toast('Restored ' + incoming.txns.filter((t) => !t.deleted).length + ' entries.');
    } catch (err) { toast('That file is not a Kaasu backup.'); }
  });
  $('#erase').addEventListener('click', () => {
    if (!confirm('Erase ALL entries on this phone? (Google Drive copy is not touched.)')) return;
    if (prompt('Type ERASE to confirm') !== 'ERASE') return;
    Store.replaceAll(Store.emptyData(), { silent: true });
    render(); toast('Erased.');
  });

  /* ---------- Install as an app ----------------------------------------- */
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#btn-install').hidden = false; });
  $('#btn-install').addEventListener('click', async () => {
    if (!installEvt) return;
    installEvt.prompt();
    await installEvt.userChoice;
    installEvt = null; $('#btn-install').hidden = true;
  });
  // The APK link is only useful on Android phones that aren't already running the app
  $('#apk-link').hidden = IS_IOS || IS_STANDALONE;
  if (IS_STANDALONE) {
    $('#install-text').textContent = '✅ Installed. Open Kaasu from your home screen.';
  }
  // iPhone / iPad: there is no "Install" button — show how to add it to the Home Screen.
  const IOS_TIP_KEY = 'expense-tracker.iosTipClosed';
  if (IS_IOS && !IS_STANDALONE && !localStorage.getItem(IOS_TIP_KEY)) {
    const share = '<svg class="ios-share" viewBox="0 0 24 24"><path d="M12 3v12M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
    const inSafari = !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(navigator.userAgent);
    $('#ios-steps').innerHTML = (inSafari ? '' : '<li>Best in <b>Safari</b>: copy this link and open it in Safari (Chrome on newer iPhones also works via its Share button).</li>') +
      '<li>Tap the <b>Share</b> button ' + share + ' (bottom bar in Safari).</li>' +
      '<li>Scroll down and tap <b>Add to Home Screen</b>.</li>' +
      '<li>Tap <b>Add</b>. Open Kaasu from the new icon on your Home Screen.</li>';
    $('#ios-install').hidden = false;
  }
  $('#ios-install-close').addEventListener('click', () => { localStorage.setItem(IOS_TIP_KEY, '1'); $('#ios-install').hidden = true; });

  /* =====================================================================
   * GOOGLE DRIVE SYNC
   * ===================================================================== */
  let syncTimer = null, syncing = false, dirty = false;

  function setPill(state, text) {
    const p = $('#sync-pill');
    if (!Drive.isConfigured() || !Drive.wasConnected()) { p.hidden = true; return; }
    p.hidden = false;
    state = state || (Drive.hasToken() ? (dirty ? 'busy' : 'ok') : 'warn');
    p.className = 'pill ' + state;
    $('span', p).textContent = text || (state === 'ok' ? 'Saved' : state === 'busy' ? 'Saving…' : 'Tap to sync');
  }
  $('#sync-pill').addEventListener('click', () => doSync(true));

  function scheduleSync() {
    if (!Drive.isConfigured() || !Drive.wasConnected()) return;
    dirty = true;
    if (!Drive.hasToken()) { setPill('warn'); return; }
    setPill('busy');
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => doSync(false), 2500);
  }

  /** interactive = true when the user tapped a button (allowed to show Google sign-in). */
  async function doSync(interactive) {
    if (syncing) return;
    try {
      if (!Drive.isConfigured()) { go('settings'); toast('Add your Google Client ID first.'); return; }
      if (!Drive.hasToken()) {
        if (!interactive) { setPill('warn'); return; }
        await Drive.connect();
      }
      syncing = true; dirty = false;
      setPill('busy', 'Syncing…');
      const merged = await Drive.sync(Store.get(), Store.merge, (d) => Store.toCSV(null, null, d.txns));
      // Merge again in case something was added while we were uploading.
      Store.replaceAll(Store.merge(Store.get(), merged), { silent: true });
      if (Store.applyRecurring().length) scheduleSync();
      setPill('ok');
      if (interactive) toast('Saved to Google Drive ✓');
      render();
    } catch (e) {
      setPill('warn', e.needsTap ? 'Tap to sync' : 'Sync failed');
      if (interactive || !e.needsTap) toast(e.message);
    } finally {
      syncing = false;
      if (dirty) scheduleSync();
      if (current === 'settings') renderSettings();
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') Store.applyRecurring(); // e.g. app left open overnight into the 1st
    if (document.visibilityState === 'hidden' && dirty && Drive.hasToken()) { clearTimeout(syncTimer); doSync(false); }
  });

  /* =====================================================================
   * START
   * ===================================================================== */
  function render() {
    if (current === 'home') renderHome();
    else if (current === 'history') renderHistory();
    else if (current === 'people') renderPeople();
    else if (current === 'reports') renderReports();
    else if (current === 'settings') { renderSettings(); preloadFonts(); }
    renderLockBtn();
  }

  Store.load();
  Store.setMasked(!Lock.isUnlocked());
  Store.applyRecurring(); // add any monthly entries that became due since last time
  setInterval(() => Store.applyRecurring(), 60 * 60 * 1000);
  Store.onChange(() => { render(); scheduleSync(); if ($('#person-sheet').open) openPerson(personKey); });
  let resizeT;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (current === 'reports') renderReports(); }, 200); });

  show(location.hash.slice(1) || 'home');
  setPill();
  if (Lock.lockApp()) Lock.ask({ mandatory: true }); // "Ask for the PIN every time Kaasu opens"
  const rr = Drive.redirectResult();
  if (rr && rr.error) { setTimeout(() => toast(rr.error), 500); go('settings'); }
  if (Drive.wasConnected() && Drive.hasToken()) doSync(!!(rr && rr.ok));

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // Handy for testing in the browser console.
  window.Kaasu = { Store, Parser, Lock, version: APP_VERSION };
})();
