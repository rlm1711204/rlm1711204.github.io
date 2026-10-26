/* =====================================================================
 * help.js — the ⓘ tip buttons and the guided tour.
 *
 *   <button class="tip-btn" data-tip="quick"></button>   opens TIPS.quick
 *   Help.tour()                                           step-by-step tour
 * ===================================================================== */
(function (root) {
  'use strict';

  const SEEN_KEY = 'kaasu.help.v1';

  const TIPS = {
    quick: { t: '✍️ Typing an entry', b: `
      <ul class="tips">
        <li><b>Spent:</b> chai 20 · petrol 500 upi · rent 12,000 on 5th</li>
        <li><b>Income:</b> salary 55000 · bonus 10k · cashback 50</li>
        <li><b>Saved:</b> sip 5000 · fd 1 lakh · gold 3000</li>
        <li><b>Gave / took:</b> gave ravi 2000 · took 500 from kumar</li>
        <li><b>Returned:</b> ravi returned 1000 · paid back kumar 500</li>
        <li><b>Gift, not a loan:</b> gave manoj 500 gift</li>
        <li><b>Family:</b> papa: medicine 200 · vegetables 150 by mummy</li>
        <li><b>Private:</b> add the word <b>private</b>, e.g. gift 2000 private</li>
        <li><b>Budget head:</b> shopping 800 need · course 2000 want</li>
        <li><b>Dates:</b> yesterday · 2 days ago · last monday · 5/9</li>
        <li><b>Every month:</b> rent 12000 every month on 5th</li>
        <li><b>Many at once:</b> chai 20, auto 60, milk 30</li>
      </ul>
      <p class="muted small">Tap a line in the preview to change it before adding. 🎤 lets you speak instead of typing.</p>` },
    scan: { t: '📷 Scanning a bill', b: `
      <p>Tap the scan button next to the typing box and take a photo, pick one from your gallery, or choose a PDF.</p>
      <ul class="tips"><li>Lay the bill flat in good light and fill the screen with it.</li>
        <li>With a free <b>Gemini key</b> (Settings → AI bill reading), Kaasu reads each item, splits it into its own entry and marks it Need or Want.</li>
        <li>PDF statements (PhonePe, Paytm, bank) need the AI key.</li>
        <li>Always check what was read before tapping Add.</li></ul>` },
    member: { t: '👨‍👩‍👧 Who spent it', b: `
      <p>Pick who the entry is for before adding. It goes back to <b>Self</b> after each add.</p>
      <p>You can also type the name: <b>papa: medicine 200</b> or <b>petrol 500 by mummy</b>.</p>
      <p class="muted small">Add or remove family members in Settings → Family members. Reports show how much each person spent.</p>` },
    hero: { t: '💰 Money left', b: `
      <p><b>Money left</b> = this month's income − spent − saved, plus or minus money given to or taken from people.</p>
      <p>If <i>carry forward</i> is on, last month's balance (or shortfall) is added too. The small line shows this month and last month separately.</p>` },
    plan: { t: '📊 Needs · Wants · Savings', b: `
      <p>Your money is split into three heads (50/30/20 by default — change it in Settings).</p>
      <ul class="tips"><li>Every expense goes to <b>Need</b> or <b>Want</b> by its category. Type <b>need</b> or <b>want</b> after an entry to choose yourself.</li>
        <li>Savings entries (SIP, FD, gold…) fill <b>Savings</b>.</li>
        <li>The three "left" amounts always add up to your Money left.</li></ul>` },
    recent: { t: '🧾 Your entries', b: `
      <p>Tap any entry to change it, mark it 🔒 private, change who spent it, or delete it. After deleting you get an <b>Undo</b> button for a few seconds.</p>` },
    history: { t: '📅 History', b: `
      <ul class="tips"><li>Use ‹ › to move between months.</li>
        <li>Search finds entries in <b>all months</b> — try a shop, a person or an amount.</li>
        <li>The chips filter by type, and by family member when you have added any.</li>
        <li>Private entries stay hidden until you unlock with your PIN.</li></ul>` },
    people: { t: '🤝 Given & taken', b: `
      <p>Keeps track of money lent and borrowed. Type on the Home screen:</p>
      <ul class="tips"><li><b>gave ravi 2000</b> · <b>took 500 from kumar</b></li>
        <li><b>ravi returned 1000</b> · <b>paid back kumar 500</b></li></ul>
      <p>Tap a person to see every entry and record a payment. Money you gave as a gift (nothing expected back) is in Reports → Spent on people.</p>` },
    reports: { t: '📈 Reports', b: `
      <ul class="tips"><li>Pick Month, 3 months, Year (April–March) or All time, then use ‹ › to move.</li>
        <li>Tap <b>Table</b> on a chart to see the numbers.</li>
        <li><b>By item name</b> adds up every entry with the same name — milk, gym, eggs…</li>
        <li>Download as Excel (CSV) or PDF, or save straight to Google Drive.</li></ul>` },
    items: { t: '🧺 By item name', b: `<p>Every entry with the same name is added up, so you see the total for milk, gym, groceries, eggs… Search to find one, tap it to see every entry.</p>` },
    gifts: { t: '🎁 Spent on people', b: `<p>Money given or spent on someone with nothing expected back — type e.g. <b>gave manoj 500 gift</b>. Loans are on the People tab instead.</p>` },
    familyReport: { t: '👨‍👩‍👧 By family member', b: `<p>How much each family member spent and saved in this period. Entries with no name are counted as <b>Self</b>. Tap a name to see the entries.</p>` },
    drive: { t: '☁️ Google Drive backup', b: `
      <p>Sign in with Google and Kaasu saves everything in <b>My Drive → Expense Tracker</b> on its own after each change.</p>
      <ul class="tips"><li>Kaasu can only see the files it made — nothing else in your Drive.</li>
        <li>Sign in with the same Google account on another phone to get the same records there.</li>
        <li>The <b>All records.csv</b> file there opens in Google Sheets.</li></ul>` },
    ai: { t: '🤖 AI bill reading', b: `
      <p>With a free Google Gemini key, Kaasu reads bill photos much more accurately, splits itemised bills into separate entries, and reads PDF statements.</p>
      <ul class="tips"><li>Get a key at <b>aistudio.google.com/apikey</b> (2 minutes, no card) and tap Add.</li>
        <li>Add a key from a second Gmail too — when one hits its free daily limit, Kaasu uses the next.</li>
        <li>Keys stay on this phone only. The photo or PDF is sent to Google (or Claude) only when you scan.</li></ul>` },
    rules: { t: '🔁 Monthly auto entries', b: `<p>Rent, EMI, SIP, salary… set once and Kaasu adds them every month on that day. Type <b>rent 12000 every month on 5th</b>, or tap <b>+ Add monthly entry</b>. Tap one to change the amount or pause it.</p>` },
    planSettings: { t: '📊 Budget plan settings', b: `
      <ul class="tips"><li><b>Split</b>: how your money is shared between Needs, Wants and Savings.</li>
        <li><b>Plan based on</b>: this month's income, or a fixed amount.</li>
        <li><b>Carry</b>: adds last month's leftover money (or takes away a shortfall).</li>
        <li>Tap a category below to switch it between Need and Want.</li></ul>` },
    family: { t: '👨‍👩‍👧 Family members', b: `<p>Keep everyone's spending in one app. Add names like <b>Papa</b> or <b>Mummy</b>; then choose who spent it when adding an entry (default <b>Self</b>), or type <b>papa: medicine 200</b>. Reports show each person's total.</p>` },
    privacy: { t: '🔒 Private entries & PIN', b: `
      <ul class="tips"><li>Mark an entry 🔒 <b>Private</b> (in the entry, or type the word <b>private</b>). It is hidden from lists until you enter your PIN.</li>
        <li>Totals still count it, shown only as "Private".</li>
        <li>Turn on <b>Ask for the PIN every time</b> to lock the whole app.</li>
        <li>Kaasu locks again a minute after you leave it. Tap 🔓 at the top to lock straight away.</li></ul>
      <p class="muted small">The PIN keeps entries away from people looking at your phone. It isn't encryption: the entries are still in your phone's storage and your Drive backup.</p>` },
    look: { t: '🎨 Look & feel', b: `<p>Pick a colour theme, light or dark, and a font. It's saved on this phone only, so everyone in the family can have their own look.</p>` },
    backup: { t: '💾 Backup & restore', b: `<p><b>Download backup</b> saves one file with everything. <b>Restore</b> adds a backup file back (nothing is lost — entries are merged). With Google Drive this happens on its own.</p>` },
    learned: { t: '🧠 Words you taught Kaasu', b: `<p>When you change the category of an entry, Kaasu remembers that word for next time. Tap one to forget it.</p>` },
    install: { t: '📲 Install', b: `<p><b>Android:</b> Chrome ⋮ → Add to Home screen → Install, or download the APK.<br><b>iPhone:</b> Safari → Share (□↑) → Add to Home Screen.</p>` },
  };

  /* ---------- Tip pop-up --------------------------------------------- */
  function tipDialog() {
    let d = document.getElementById('tip-pop');
    if (d) return d;
    d = document.createElement('dialog');
    d.id = 'tip-pop';
    d.className = 'sheet tip-pop';
    d.innerHTML = `<div class="sheet-head"><h2 id="tip-title"></h2>
        <button type="button" class="icon-btn sm" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div id="tip-body" class="tip-body"></div>
      <div class="sheet-actions"><button type="button" class="btn" id="tip-tour">❓ Full tour</button><button type="button" class="btn primary" data-close>Got it</button></div>`;
    document.body.appendChild(d);
    d.addEventListener('click', (e) => {
      if (e.target === d) d.close();                       // tap outside
      if (e.target.closest('#tip-tour')) { d.close(); tour(); }
    });
    return d;
  }
  function tip(key) {
    const x = TIPS[key];
    if (!x) return;
    const d = tipDialog();
    document.getElementById('tip-title').textContent = x.t;
    document.getElementById('tip-body').innerHTML = x.b;
    d.showModal();
  }
  function decorate(scope) {
    (scope || document).querySelectorAll('.tip-btn[data-tip]:not([data-ready])').forEach((b) => {
      b.dataset.ready = '1';
      b.type = 'button';
      b.textContent = 'i';
      b.setAttribute('aria-label', 'Help: ' + ((TIPS[b.dataset.tip] || {}).t || '').replace(/^\W+\s*/, ''));
    });
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.tip-btn[data-tip], .tip-link[data-tip]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    tip(b.dataset.tip);
  }, true);

  /* ---------- Guided tour --------------------------------------------- */
  // view: which screen to open; sel: what to point at
  const STEPS = [
    { view: 'home', sel: '#ac-add', t: 'Add an entry', b: 'Tap <b>＋</b> and type a few words: <b>chai 20</b>, <b>petrol 500 upi</b>, <b>salary 55000</b>. Or pick Spent, Income, Saved…' },
    { view: 'home', sel: '#ac-mic', t: 'Or just say it', b: 'Tap <b>Speak</b> and say e.g. "lunch 150, auto 40".' },
    { view: 'home', sel: '#ac-scan', t: 'Scan a bill', b: 'Take a photo of a bill or pick a PDF. With an AI key, every item becomes its own entry.' },
    { view: 'home', sel: '.card.hero', t: 'Money left', b: 'What is left this month after spending and saving, with last month\'s balance shown separately.' },
    { view: 'home', sel: '#plan-card', t: 'Needs · Wants · Savings', b: 'Your money split into three heads, so you know how much you can still spend on each.' },
    { view: 'home', sel: '#recent', t: 'Change or delete', b: 'Tap any entry to edit it, mark it 🔒 private, or delete it.' },
    { view: 'home', sel: '.tabs [data-go="history"]', t: 'History', b: 'Every entry month by month. Search finds anything in any month.' },
    { view: 'home', sel: '.tabs [data-go="people"]', t: 'Given & taken', b: 'Money you lent or borrowed, and who still owes whom.' },
    { view: 'home', sel: '.tabs [data-go="reports"]', t: 'Reports', b: 'Charts, totals by item and by family member, and downloads as Excel or PDF.' },
    { view: 'settings', sel: '#drive-card', t: 'Back up to Google Drive', b: 'Sign in with Google once — your records are then saved in your own Drive after every change.' },
    { view: 'settings', sel: '#family-card', t: 'Family members', b: 'Add Papa, Mummy… to keep everyone\'s spending in one place.' },
    { view: 'settings', sel: '#privacy-card', t: 'Private entries', b: 'Set a PIN to hide private entries — or lock the whole app.' },
    { view: 'settings', sel: '#look-card', t: 'Make it yours', b: 'Five colour themes, light or dark, and five fonts.' },
    { view: 'home', sel: '#help-btn', t: 'Help any time', b: 'Tap <b>?</b> for this tour again, and the small <b>i</b> buttons to explain one part of the app.' },
  ];

  let ov = null, idx = 0, steps = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => el && el.offsetParent !== null && !el.closest('[hidden]');

  function overlay() {
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'tour';
    ov.innerHTML = `<div class="spot"></div>
      <div class="bubble" role="dialog" aria-live="polite" aria-labelledby="tour-t">
        <div class="tour-count muted small" id="tour-n"></div>
        <h3 id="tour-t"></h3><p id="tour-b"></p>
        <div class="tour-btns"><button type="button" class="link small" id="tour-skip">Skip tour</button><span></span>
          <button type="button" class="btn" id="tour-back">Back</button><button type="button" class="btn primary" id="tour-next">Next</button></div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#tour-skip').onclick = end;
    ov.querySelector('#tour-back').onclick = () => goStep(idx - 1);
    ov.querySelector('#tour-next').onclick = () => (idx >= steps.length - 1 ? end() : goStep(idx + 1));
    document.addEventListener('keydown', (e) => { if (ov && !ov.hidden && e.key === 'Escape') end(); });
    window.addEventListener('resize', () => { if (ov && !ov.hidden) place(); });
    return ov;
  }

  async function openView(view) {
    const want = view === 'home' ? '' : '#' + view;
    if ((location.hash || '') !== want) { location.hash = view === 'home' ? '' : view; await wait(250); }
  }

  async function goStep(i) {
    if (i < 0 || i >= steps.length) return;
    idx = i;
    const s = steps[i];
    await openView(s.view);
    const el = document.querySelector(s.sel);
    if (!visible(el)) {               // that part isn't on screen right now — skip it
      steps.splice(i, 1);
      return goStep(Math.min(i, steps.length - 1));
    }
    if (!el.closest('.tabs, .topbar')) el.scrollIntoView({ block: 'center', behavior: 'auto' });
    await wait(60);
    ov.querySelector('#tour-n').textContent = (i + 1) + ' of ' + steps.length;
    ov.querySelector('#tour-t').textContent = s.t;
    ov.querySelector('#tour-b').innerHTML = s.b;
    ov.querySelector('#tour-back').style.visibility = i ? '' : 'hidden';
    ov.querySelector('#tour-next').textContent = i === steps.length - 1 ? 'Done' : 'Next';
    place();
    ov.querySelector('#tour-next').focus({ preventScroll: true });
  }

  function place() {
    const s = steps[idx]; if (!s) return;
    const el = document.querySelector(s.sel); if (!el) return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight, padding = 6;
    const top = Math.max(4, r.top - padding), bottom = Math.min(vh - 4, r.bottom + padding);
    const spot = ov.querySelector('.spot');
    Object.assign(spot.style, { left: (r.left - padding) + 'px', top: top + 'px', width: (r.width + padding * 2) + 'px', height: Math.max(0, bottom - top) + 'px' });
    const bub = ov.querySelector('.bubble');
    const h = bub.offsetHeight;
    bub.style.top = bub.style.bottom = '';
    if (bottom + 12 + h < vh - 8) bub.style.top = (bottom + 12) + 'px';
    else if (top - 12 - h > 8) bub.style.top = (top - 12 - h) + 'px';
    else bub.style.bottom = '16px';
  }

  async function tour() {
    overlay();
    // leave out parts that are switched off right now (e.g. no family members yet)
    steps = STEPS.filter((x) => { const el = document.querySelector(x.sel); return el && !el.closest('[hidden]:not(.view)'); });
    ov.hidden = false;
    document.documentElement.classList.add('touring');
    seen();
    await goStep(0);
  }
  async function end() {
    if (!ov) return;
    ov.hidden = true;
    document.documentElement.classList.remove('touring');
    await openView('home');
    window.scrollTo(0, 0);
  }

  const seen = () => { try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* ignore */ } };
  const wasSeen = () => { try { return !!localStorage.getItem(SEEN_KEY); } catch (e) { return true; } };

  decorate();
  root.Help = { tip, tour, decorate, seen, wasSeen, TIPS, _steps: STEPS };
})(self);
