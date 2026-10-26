/* =====================================================================
 * lock.js — PIN for private entries (and optionally the whole app).
 *
 * The PIN is stored on this phone only, as a salted SHA-256 hash (never
 * the PIN itself). This keeps private entries away from people looking at
 * your phone; it is not encryption — the entries are still in the phone's
 * storage and your Google Drive backup.
 * ===================================================================== */
(function (root) {
  'use strict';

  const KEY = 'kaasu.lock.v1';
  const AUTO_LOCK_MS = 60 * 1000;   // locks again 1 minute after you leave the app
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { cfg = {}; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ } };

  let unlocked = false;
  let hiddenAt = 0;
  let wrong = 0, waitUntil = 0;
  const listeners = [];
  const changed = () => listeners.forEach((fn) => fn(unlocked));

  async function hash(pin, salt) {
    const bytes = new TextEncoder().encode(salt + ':' + pin);
    const h = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const validPin = (p) => /^\d{4,8}$/.test(String(p || ''));

  const hasPin = () => !!cfg.hash;
  const lockApp = () => !!(cfg.lockApp && cfg.hash);

  async function setPin(pin) {
    if (!validPin(pin)) throw new Error('Use 4 to 8 digits.');
    cfg.salt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    cfg.hash = await hash(pin, cfg.salt);
    save();
    unlocked = true; changed();
  }
  async function checkPin(pin) { return !!cfg.hash && (await hash(String(pin), cfg.salt)) === cfg.hash; }
  function removePin() { delete cfg.hash; delete cfg.salt; cfg.lockApp = false; save(); unlocked = false; changed(); }
  function setLockApp(on) { cfg.lockApp = !!on; save(); }
  function lock() { if (unlocked) { unlocked = false; changed(); } }

  // lock again when you come back after a while
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > AUTO_LOCK_MS) {
      lock();
      if (lockApp()) {
        document.querySelectorAll('dialog[open]:not(#lockscreen)').forEach((d) => d.close());
        ask({ mandatory: true });
      }
    }
  });

  /* ---------- PIN screen ------------------------------------------------- */

  let pending = null;
  function build() {
    let el = document.getElementById('lockscreen');
    if (el) return el;
    // a <dialog> so it also shows on top of an open sheet
    el = document.createElement('dialog');
    el.id = 'lockscreen';
    el.innerHTML = `
      <div class="lk-box" role="dialog" aria-modal="true" aria-labelledby="lk-title">
        <div class="lk-icon">🔒</div>
        <h2 id="lk-title">Enter your PIN</h2>
        <p id="lk-msg" class="muted small"></p>
        <div class="lk-dots" id="lk-dots"></div>
        <div class="lk-pad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join('')}
          <button type="button" data-k="cancel" class="lk-soft" id="lk-cancel">Cancel</button>
          <button type="button" data-k="0">0</button>
          <button type="button" data-k="del" class="lk-soft" aria-label="Delete">⌫</button>
        </div>
        <button type="button" class="link small" id="lk-ok" hidden>OK</button>
        <button type="button" class="link small" id="lk-forgot">Forgot PIN?</button>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', onKey);
    el.addEventListener('cancel', (e) => { e.preventDefault(); if (pending && !pending.mandatory) close(false); });
    el.addEventListener('keydown', (e) => {
      if (!pending) return;
      if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); press('del'); }
      else if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    return el;
  }

  let entry = '';
  function dots() {
    const n = Math.max(4, entry.length);
    document.getElementById('lk-dots').innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < entry.length ? 'on' : ''}"></i>`).join('');
    document.getElementById('lk-ok').hidden = !(pending && entry.length >= 4);
  }
  function onKey(e) {
    const b = e.target.closest('[data-k]');
    if (b) { press(b.dataset.k); return; }
    if (e.target.id === 'lk-ok') submit();
    if (e.target.id === 'lk-forgot') forgot();
  }
  function press(k) {
    if (k === 'cancel') { if (!pending.mandatory) close(false); return; }
    if (k === 'del') entry = entry.slice(0, -1);
    else if (entry.length < 8) entry += k;
    dots();
    // checking: try automatically once the PIN length could be complete
    if (pending.mode === 'check' && entry.length >= 4) tryUnlock(false);
  }
  async function tryUnlock(final) {
    if (Date.now() < waitUntil) { msg('Too many tries. Wait ' + Math.ceil((waitUntil - Date.now()) / 1000) + ' s.'); return; }
    if (await checkPin(entry)) { wrong = 0; unlocked = true; changed(); close(true); return; }
    if (final || entry.length >= 8) {
      wrong++; entry = ''; dots();
      if (wrong >= 5) { waitUntil = Date.now() + 30 * 1000; wrong = 0; msg('Too many wrong tries. Wait 30 seconds.'); }
      else msg('Wrong PIN. Try again.');
      shake();
    }
  }
  async function submit() {
    if (pending.mode === 'check') return tryUnlock(true);
    // setting a PIN: type it, then type it again
    if (!validPin(entry)) { msg('Use 4 to 8 digits.'); return; }
    if (!pending.first) { pending.first = entry; entry = ''; dots(); title('Type the same PIN again'); msg(''); return; }
    if (pending.first !== entry) { pending.first = ''; entry = ''; dots(); title('Choose a PIN'); msg('The two PINs didn\'t match. Start again.'); shake(); return; }
    await setPin(entry);
    close(true);
  }
  function forgot() {
    const D = root.Drive;
    if (D && D.wasConnected && D.wasConnected()) {
      if (!confirm('To reset your PIN, sign in with the Google account Kaasu backs up to.')) return;
      localStorage.setItem(KEY + '.reset', '1');
      D.connect().then(() => { localStorage.removeItem(KEY + '.reset'); removePin(); close(false); alert('PIN removed. Set a new one in Settings → Privacy.'); })
        .catch((e) => { localStorage.removeItem(KEY + '.reset'); msg(e.message || 'Sign-in failed.'); });
      return;
    }
    if (prompt('Without Google Drive connected, the PIN can only be reset on this phone. Type RESET to remove the PIN.') === 'RESET') {
      removePin(); close(false); alert('PIN removed. Set a new one in Settings → Privacy.');
    }
  }
  const msg = (t) => { document.getElementById('lk-msg').textContent = t; };
  const title = (t) => { document.getElementById('lk-title').textContent = t; };
  const shake = () => { const b = document.querySelector('#lockscreen .lk-box'); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); };

  function close(ok) {
    const el = build();
    if (el.open) el.close();
    document.documentElement.classList.remove('locked-app');
    const p = pending; pending = null; entry = '';
    if (p) p.resolve(ok);
  }

  /**
   * Show the PIN screen. opts: { mode: 'check' | 'set', reason, mandatory }
   * Resolves true when unlocked / PIN set, false when cancelled.
   */
  function ask(opts) {
    opts = opts || {};
    if (pending) return pending.promise;
    const el = build();
    const mode = opts.mode || 'check';
    let resolve; const promise = new Promise((r) => { resolve = r; });
    pending = { mode, mandatory: !!opts.mandatory, resolve, promise, first: '' };
    entry = '';
    title(mode === 'set' ? 'Choose a PIN' : 'Enter your PIN');
    msg(opts.reason || (mode === 'set' ? '4 to 8 digits. You\'ll need it to see private entries.' : ''));
    document.getElementById('lk-cancel').style.visibility = opts.mandatory ? 'hidden' : '';
    document.getElementById('lk-forgot').hidden = mode === 'set';
    if (opts.mandatory) document.documentElement.classList.add('locked-app');
    dots();
    el.showModal();
    return promise;
  }

  /** Make sure private entries can be shown: unlocked already, or ask. */
  async function unlockPrivate(reason) {
    if (unlocked) return true;
    if (!hasPin()) return ask({ mode: 'set', reason: 'Set a PIN on this phone to see and add private entries.' });
    return ask({ mode: 'check', reason: reason || 'Unlock to see private entries.' });
  }

  // finish a "Forgot PIN" that went through Google's sign-in page (iPhone)
  if (localStorage.getItem(KEY + '.reset') && root.Drive && root.Drive.redirectResult && root.Drive.redirectResult() && root.Drive.redirectResult().ok) {
    localStorage.removeItem(KEY + '.reset'); removePin();
    setTimeout(() => alert('PIN removed. Set a new one in Settings → Privacy.'), 300);
  }

  root.Lock = {
    hasPin, lockApp, setLockApp, isUnlocked: () => unlocked, lock, ask, unlockPrivate, removePin,
    onChange: (fn) => listeners.push(fn), _checkPin: checkPin,
  };
})(self);
