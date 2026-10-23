/* =====================================================================
 * ai.js — optional AI reading of bill photos and PDFs.
 *
 * Bring your own key, like the SSC Vocab Vault app:
 *   • Google Gemini — free key from Google AI Studio (several keys allowed;
 *     when one hits its free limit the next one is used).
 *   • Claude (Anthropic) — optional paid key, used when Gemini can't help.
 *
 * Keys are kept ONLY on this phone (localStorage). They are never synced to
 * Google Drive, never put in backups and never sent anywhere except to the
 * AI service itself. With no key, Kaasu reads photos on the phone (ocr.js).
 * ===================================================================== */
(function (root) {
  'use strict';

  const KEY = 'kaasu.ai.v1';
  const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
  // Free-tier Flash models, newest first. "-latest" aliases follow Google's newest
  // model, so they keep working when versions are retired; named ones are a backup.
  const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.5-flash', 'gemini-2.5-flash'];
  const CLAUDE_MODEL = 'claude-opus-5-5';
  // Official Anthropic SDK, loaded in the browser only when a Claude key is used.
  const ANTHROPIC_SDK = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.129.0/+esm';

  /* ---------- Settings (this phone only) ------------------------------- */

  function load() {
    const base = { geminiKeys: [], claudeKey: '', enabled: true, keyPick: '' }; // keyPick '' = Auto, else that key
    try { return Object.assign(base, JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch (e) { return base; }
  }
  let cfg = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* storage full / private mode */ } };

  const clean = (k) => String(k || '').trim().replace(/\s+/g, '');
  function addGeminiKey(k) {
    k = clean(k);
    if (!/^\S{20,}$/.test(k)) throw new Error('That doesn\'t look like a Gemini key. Copy the whole key from Google AI Studio.');
    if (!cfg.geminiKeys.includes(k)) cfg.geminiKeys.push(k);
    save();
  }
  function removeGeminiKey(i) {
    const [gone] = cfg.geminiKeys.splice(i, 1);
    if (gone && cfg.keyPick === gone) cfg.keyPick = '';
    save();
  }
  /** Which Gemini key to use: 0 = Auto (move on to the next key at the free limit), 1 = Key 1, 2 = Key 2… */
  function pickKey(n) { cfg.keyPick = n > 0 && cfg.geminiKeys[n - 1] ? cfg.geminiKeys[n - 1] : ''; save(); }
  const pickedKey = () => (cfg.keyPick && cfg.geminiKeys.includes(cfg.keyPick) ? cfg.geminiKeys.indexOf(cfg.keyPick) + 1 : 0);
  function setClaudeKey(k) {
    k = clean(k);
    if (k && !/^sk-ant-\S{20,}$/.test(k)) throw new Error('A Claude key starts with "sk-ant-". Copy the whole key from the Anthropic Console.');
    cfg.claudeKey = k; save();
  }
  function setEnabled(on) { cfg.enabled = !!on; save(); }
  const hasKey = () => cfg.geminiKeys.length > 0 || !!cfg.claudeKey;
  const isOn = () => cfg.enabled && hasKey();
  const masked = (k) => k ? k.slice(0, 4) + '…' + k.slice(-4) : '';

  /* ---------- What we ask the AI for ----------------------------------- */

  /**
   * One shape for everything: a photographed bill gives one entry; a PDF
   * statement (PhonePe, Paytm, bank) gives one entry per transaction.
   */
  function schema(categories) {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'gstin', 'entries'],
      properties: {
        kind: { type: 'string', enum: ['bill', 'statement', 'other'], description: 'bill = one purchase (receipt, invoice); statement = a list of transactions (bank / UPI / wallet statement).' },
        gstin: { type: 'string', description: 'Seller GSTIN on a bill, else empty string.' },
        entries: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['date', 'amount', 'direction', 'merchant', 'description', 'category', 'head', 'mode', 'gst', 'items'],
            properties: {
              date: { type: 'string', description: 'YYYY-MM-DD. Indian documents write dates day-first (05/09/2026 = 5 September 2026).' },
              amount: { type: 'number', description: 'Rupees, positive. For a bill: the final amount paid (grand total / net payable), not the subtotal.' },
              direction: { type: 'string', enum: ['out', 'in'], description: 'out = money paid/debited; in = money received/credited (salary, refund, cashback, money from a person).' },
              merchant: { type: 'string', description: 'Shop / payee / payer name, cleaned up (e.g. "Sri Saravana Bhavan", "Ramesh Kumar"). Empty if unknown.' },
              description: { type: 'string', description: 'Short note: main items bought or what the transaction was (max 60 characters).' },
              category: { type: 'string', enum: categories, description: 'Best matching category.' },
              mode: { type: 'string', enum: ['UPI', 'Card', 'Cash', 'Bank', ''], description: 'How it was paid, if shown.' },
              head: { type: 'string', enum: ['need', 'want'], description: 'Budget head for an out entry: need = essentials (groceries, staples, milk, vegetables, fruit, medicine, rent, bills, fuel, transport, household cleaning, education); want = non-essentials (eating out, snacks, sweets, treats, entertainment, shopping for pleasure). For in entries use need.' },
              gst: { type: 'number', description: 'Total GST (CGST+SGST+IGST) on a bill, else 0.' },
              items: {
                type: 'array',
                description: 'For a bill that lists separate products (grocery/quick-commerce orders, supermarket bills): one item per product line. Leave EMPTY for statements and for bills with a single item or no item list.',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['name', 'qty', 'amount', 'category', 'head'],
                  properties: {
                    name: { type: 'string', description: 'Clean, short product name without quantity prefix or pack-size noise, e.g. "Daily Apple", "Peeled Garlic", "India Gate Basmati Rice", "Full Cream Milk".' },
                    qty: { type: 'number', description: 'Quantity bought (1 if not shown).' },
                    amount: { type: 'number', description: 'Price paid for this line in rupees (qty × unit price, after any per-item discount).' },
                    category: { type: 'string', enum: categories, description: 'Best matching category for this product.' },
                    head: { type: 'string', enum: ['need', 'want'], description: 'need = essential (staples, fruit, vegetables, milk, bread, eggs, cleaning supplies, medicine); want = non-essential (chocolates, chips, cold drinks, ice cream, treats, luxury items).' },
                  },
                },
              },
            },
          },
        },
      },
    };
  }

  function instructions(categories) {
    return [
      'You read Indian bills, receipts, invoices and bank / UPI / wallet statements for a personal expense tracker.',
      'Return every money movement you can see in the document as an entry.',
      'For a bill or receipt: return exactly ONE entry for the final amount paid (grand total / net payable after discounts and round-off), with the main items in description and the GST total in gst.',
      'For a statement: return one entry per transaction row, in date order. Skip opening/closing balance lines and totals.',
      'Treat money sent to a person or merchant as out, money received as in. Salary, refunds, cashback and interest are in.',
      'Pick category from this list only: ' + categories.join(', ') + '.',
      'Use Indian context: a "hotel" bill is usually a restaurant (Food); kirana / supermarket = Groceries; petrol pump = Fuel; pharmacy = Health.',
      'If a bill lists several products, also fill `items` with every product line: skip items marked unavailable, cancelled, refunded, out of stock or struck through, and do not list delivery fees, handling fees, packaging, tips or discounts as items (they are covered by the bill total).',
      'Classify each entry and each item as need (essential) or want (non-essential).',
      'Item names on Indian bills are often Tamil/Hindi words in English letters or abbreviations: write the plain English name first and the bill\'s word in brackets, e.g. "Big Onion (Periya Vengayam)", "Ginger (Jinser)", "Small Onion (Chinna Vengayam)". Items sold by weight have decimal quantities such as 0.540 kg — use the Amount column as the item amount.',
      'Never invent entries. If the document has no money movement, return kind "other" and no entries.',
    ].join('\n');
  }

  /* ---------- Files → base64 ------------------------------------------- */

  /** Photos are shrunk to a small JPEG (fast upload, same readability). PDFs are sent as they are. */
  async function toPart(file) {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
      if (file.size > 20 * 1024 * 1024) throw new Error('That PDF is over 20 MB. Download a shorter date range and try again.');
      return { mime: 'application/pdf', data: await b64(file) };
    }
    const blob = await smallPhoto(file);
    return { mime: 'image/jpeg', data: await b64(blob) };
  }

  /**
   * Shrink a camera photo WITHOUT opening it at full size: createImageBitmap
   * decodes straight to the small size, so a 50-megapixel photo never needs
   * hundreds of MB of memory. Never sends the original if shrinking fails.
   */
  async function smallPhoto(file, maxSide) {
    maxSide = maxSide || 1600;
    let bmp = null;
    if (typeof createImageBitmap === 'function') {
      try {
        // first a tiny decode just to learn the shape (portrait / landscape)
        const probe = await createImageBitmap(file, { resizeWidth: 64, resizeQuality: 'low' });
        const portrait = probe.height >= probe.width;
        probe.close && probe.close();
        bmp = await createImageBitmap(file, portrait ? { resizeHeight: maxSide, resizeQuality: 'high' } : { resizeWidth: maxSide, resizeQuality: 'high' });
      } catch (e) { bmp = null; }
    }
    let out = null;
    if (bmp) {
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      bmp.close && bmp.close();
      out = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
      c.width = c.height = 0; // free the canvas memory now
    } else {
      out = await shrink(file, maxSide); // older browsers
    }
    if (!out || out.size > 3 * 1024 * 1024) {
      if (file.size <= 1.5 * 1024 * 1024 && /jpe?g|png|webp/i.test(file.type)) return file; // already small
      throw new Error('This phone couldn\'t open that photo (not enough memory). Close other apps, or take the photo again at a lower camera resolution.');
    }
    return out;
  }
  function b64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(new Error('Could not read that file.'));
      r.readAsDataURL(blob);
    });
  }
  function shrink(file, maxSide) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => { c.width = c.height = 0; resolve(b); }, 'image/jpeg', 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  /* ---------- Google Gemini (REST) -------------------------------------- */

  /** Our JSON Schema → Gemini's responseSchema (upper-case types, no additionalProperties). */
  function toGeminiSchema(s) {
    if (Array.isArray(s)) return s.map(toGeminiSchema);
    if (!s || typeof s !== 'object') return s;
    const out = {};
    for (const [k, v] of Object.entries(s)) {
      if (k === 'additionalProperties') continue;
      if (k === 'type') out.type = String(v).toUpperCase();
      else if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
      else if (k === 'items') out.items = toGeminiSchema(v);
      else if (k === 'enum') { if (!v.includes('')) out.enum = v; } // Gemini rejects "" in enums: leave such fields free text
      else out[k] = v;
    }
    if (s.properties && s.required) out.propertyOrdering = s.required;
    return out;
  }

  const rest = new Map(); // key -> time it may be used again after hitting its free limit

  /** fetch with a time limit; also stops when you tap Stop. */
  async function timedFetch(url, opts, ms, stop) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort('timeout'), ms);
    const onStop = () => ac.abort('stopped');
    if (stop) { if (stop.aborted) onStop(); else stop.addEventListener('abort', onStop); }
    try { return await fetch(url, Object.assign({}, opts, { signal: ac.signal })); }
    catch (e) {
      if (stop && stop.aborted) throw Object.assign(new Error('Stopped.'), { stopped: true });
      if (ac.signal.aborted) throw Object.assign(new Error('timed out'), { timeout: true });
      throw e;
    } finally { clearTimeout(timer); if (stop) stop.removeEventListener('abort', onStop); }
  }
  let GEMINI_TIMEOUT_MS = 60 * 1000;

  async function gemini(part, categories, onProgress, stop) {
    const picked = pickedKey();
    // A chosen key is used on its own (even after a limit, so you see Google's own message); Auto skips resting keys.
    const keys = picked ? [cfg.keyPick] : cfg.geminiKeys.filter((k) => !(rest.get(k) > Date.now()));
    if (!keys.length) throw Object.assign(new Error('All Gemini keys have reached their free limit for now. Try again later or add another key.'), { quota: true });
    const body = {
      systemInstruction: { parts: [{ text: instructions(categories) }] },
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: part.mime, data: part.data } }, { text: 'Read this document and return the entries.' }] }],
      // little "thinking" needed to read a bill — keeps replies fast
      generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(schema(categories)), temperature: 0, thinkingConfig: { thinkingLevel: 'low' } },
    };
    let lastErr;
    let slow = 0; // after two slow replies, stop waiting (about 2 minutes at most)
    for (const [ki, key] of keys.entries()) {
      for (const model of GEMINI_MODELS) {
        onProgress && onProgress('Gemini is reading (key ' + (cfg.geminiKeys.indexOf(key) + 1) + ')…');
        let res;
        try {
          res = await timedFetch(GEMINI + '/models/' + model + ':generateContent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify(body),
          }, GEMINI_TIMEOUT_MS, stop);
        } catch (e) {
          if (e.stopped) throw e;
          if (e.timeout) {
            lastErr = new Error('Gemini took too long (slow internet?). Try again on Wi-Fi or a better signal.');
            if (++slow >= 2) throw lastErr;
            continue; // one more try on the next model
          }
          throw new Error('Couldn\'t reach Gemini. Check your internet connection.');
        }
        // An older model that doesn't know the thinking setting: ask again without it.
        if (res.status === 400 && body.generationConfig.thinkingConfig) {
          const msg400 = await res.clone().text().catch(() => '');
          if (/thinking/i.test(msg400)) { delete body.generationConfig.thinkingConfig; onProgress && onProgress('Gemini is reading…'); res = await timedFetch(GEMINI + '/models/' + model + ':generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) }, GEMINI_TIMEOUT_MS, stop); }
        }
        if (res.ok) {
          const j = await res.json();
          const cand = (j.candidates || [])[0];
          const text = ((cand && cand.content && cand.content.parts) || []).map((p) => p.text || '').join('');
          if (!text) { lastErr = new Error('Gemini returned nothing for this file' + (cand && cand.finishReason ? ' (' + cand.finishReason + ')' : '') + '.'); continue; }
          return Object.assign(JSON.parse(text), { by: 'Gemini' });
        }
        const msg = await res.text().catch(() => '');
        if (res.status === 404) { lastErr = new Error('Gemini model not available: ' + model); continue; }          // retired: try the next model
        if (res.status === 429) { rest.set(key, Date.now() + 10 * 60 * 1000); lastErr = Object.assign(new Error('Gemini key ' + (cfg.geminiKeys.indexOf(key) + 1) + ' has reached its free limit' + (picked ? ' — choose another key or Auto.' : '.')), { quota: true }); break; } // next key
        if (res.status === 400 && /API key not valid|API_KEY_INVALID/i.test(msg)) { lastErr = new Error('A Gemini key was rejected — check it in Settings.'); break; }
        if (res.status === 403) { lastErr = new Error('This Gemini key isn\'t allowed to use the API. Create a new key in Google AI Studio.'); break; }
        if (res.status >= 500) { lastErr = new Error('Gemini is busy right now.'); continue; }
        throw new Error('Gemini couldn\'t read this file (' + res.status + '). ' + msg.slice(0, 160));
      }
    }
    throw lastErr || new Error('Gemini couldn\'t read this file.');
  }

  /* ---------- Claude (official Anthropic SDK) -------------------------- */

  let sdkLoading = null;
  function loadSDK() {
    if (api._sdk) return Promise.resolve(api._sdk); // tests can inject the SDK
    if (!sdkLoading) sdkLoading = import(ANTHROPIC_SDK).then((m) => m.default || m.Anthropic).catch((e) => { sdkLoading = null; throw new Error('Couldn\'t load the Claude library. Check your internet connection.'); });
    return sdkLoading;
  }

  async function claude(part, categories, onProgress, stop) {
    const Anthropic = await loadSDK();
    // Browser use is intentional: a personal app; the key never leaves this phone except to Anthropic.
    const client = new Anthropic({ apiKey: cfg.claudeKey, dangerouslyAllowBrowser: true });
    const source = part.mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: part.data } }
      : { type: 'image', source: { type: 'base64', media_type: part.mime, data: part.data } };
    onProgress && onProgress('Claude is reading…');
    try {
      const stream = client.beta.messages.stream({
        model: CLAUDE_MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default', // if this model declines, the API retries on Anthropic's recommended fallback
        output_config: { effort: part.mime === 'application/pdf' ? 'medium' : 'low', format: { type: 'json_schema', schema: schema(categories) } },
        system: instructions(categories),
        messages: [{ role: 'user', content: [source, { type: 'text', text: 'Read this document and return the entries.' }] }],
      });
      const kill = () => stream.abort();
      const timer = setTimeout(kill, 120 * 1000);
      if (stop) stop.addEventListener('abort', kill);
      let msg;
      try { msg = await stream.finalMessage(); }
      finally { clearTimeout(timer); if (stop) stop.removeEventListener('abort', kill); }
      if (msg.stop_reason === 'refusal') throw new Error('Claude declined to read this file.');
      if (msg.stop_reason === 'max_tokens') throw new Error('This file has too many transactions for one go. Download a shorter date range.');
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      return Object.assign(JSON.parse(text), { by: 'Claude' });
    } catch (e) {
      if (stop && stop.aborted) throw Object.assign(new Error('Stopped.'), { stopped: true });
      if (A_isAbort(e)) throw new Error('Claude took too long (slow internet?).');
      throw new Error(explainClaude(e, Anthropic));
    }
  }

  const A_isAbort = (e) => e && (e.name === 'AbortError' || /abort/i.test(e.constructor && e.constructor.name || '') || /aborted/i.test(e.message || ''));
  function explainClaude(e, A) {
    if (A && A.AuthenticationError && e instanceof A.AuthenticationError) return 'Your Claude key was rejected. Check it in Settings.';
    if (A && A.PermissionDeniedError && e instanceof A.PermissionDeniedError) return 'This Claude key can\'t use that model. Check your Anthropic Console.';
    if (A && A.RateLimitError && e instanceof A.RateLimitError) return 'Too many Claude requests right now — wait a minute and try again.';
    if (A && A.BadRequestError && e instanceof A.BadRequestError) {
      return /credit|balance/i.test(e.message || '') ? 'Your Anthropic account is out of credits.' : 'Claude couldn\'t read this file: ' + (e.message || '');
    }
    if (A && A.APIConnectionError && e instanceof A.APIConnectionError) return 'Couldn\'t reach Claude. Check your internet connection.';
    if (e instanceof SyntaxError) return 'Claude\'s reply was incomplete. Please try again.';
    return (e && e.message) || String(e);
  }

  /* ---------- Main entry ---------------------------------------------- */

  /**
   * Read a bill photo or PDF. Tries Gemini (free) first, then Claude.
   * Resolves { kind, gstin, entries: [...], by }.
   */
  async function read(file, categories, onProgress, stop) {
    if (!hasKey()) throw new Error('Add a free Gemini key in Settings → AI bill reading.');
    onProgress && onProgress('Making the photo smaller…');
    const part = await toPart(file);
    if (stop && stop.aborted) throw Object.assign(new Error('Stopped.'), { stopped: true });
    const errors = [];
    if (cfg.geminiKeys.length) {
      try { return tidy(await gemini(part, categories, onProgress, stop), categories); }
      catch (e) { if (e.stopped) throw e; errors.push(e.message); if (!cfg.claudeKey) throw e; }
    }
    if (cfg.claudeKey) {
      try { return tidy(await claude(part, categories, onProgress, stop), categories); }
      catch (e) { if (e.stopped) throw e; errors.push(e.message); }
    }
    throw new Error(errors.join(' · '));
  }

  /** Make sure every entry is usable (valid date, positive amount, known category). */
  function tidy(r, categories) {
    const today = new Date();
    const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const entries = (Array.isArray(r.entries) ? r.entries : []).map((e) => ({
      date: /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') && !isNaN(new Date(e.date)) ? e.date : iso(today),
      amount: Math.round(Math.abs(Number(e.amount) || 0) * 100) / 100,
      direction: e.direction === 'in' ? 'in' : 'out',
      merchant: String(e.merchant || '').trim().slice(0, 60),
      description: String(e.description || '').trim().slice(0, 80),
      category: categories.includes(e.category) ? e.category : (e.direction === 'in' ? 'Other income' : 'Other'),
      mode: ['UPI', 'Card', 'Cash', 'Bank'].includes(e.mode) ? e.mode : '',
      gst: Math.round((Number(e.gst) || 0) * 100) / 100,
      head: e.head === 'want' ? 'want' : 'need',
      items: (Array.isArray(e.items) ? e.items : []).map((it) => ({
        name: String(it.name || '').replace(/^\s*\d+\s*[x×]\s*/i, '').replace(/[.…]+$/, '').trim().slice(0, 60),
        qty: Number(it.qty) || 1,
        amount: Math.round(Math.abs(Number(it.amount) || 0) * 100) / 100,
        category: categories.includes(it.category) ? it.category : (categories.includes(e.category) ? e.category : 'Other'),
        head: it.head === 'want' ? 'want' : 'need',
      })).filter((it) => it.name && it.amount > 0),
    })).filter((e) => e.amount > 0);
    return { kind: r.kind || (entries.length > 1 ? 'statement' : 'bill'), gstin: String(r.gstin || '').trim(), entries, by: r.by };
  }

  /**
   * Turn one itemised bill into entries that add up EXACTLY to the bill total:
   * one per product, plus a "Delivery & fees" line for fees / round-off.
   * If discounts are bigger than fees, item prices are reduced in proportion.
   */
  function splitBill(entry) {
    const items = (entry.items || []).map((it) => Object.assign({}, it));
    if (!items.length) return [];
    const round = (n) => Math.round(n * 100) / 100;
    const sum = round(items.reduce((s, it) => s + it.amount, 0));
    let diff = round(entry.amount - sum);
    if (diff < 0) {
      // discount larger than fees: share it out over the items, keeping paise exact
      const factor = entry.amount / sum;
      let left = entry.amount;
      items.forEach((it, i) => { it.amount = i === items.length - 1 ? round(left) : round(it.amount * factor); left = round(left - it.amount); });
      diff = 0;
    }
    if (diff > 0 && diff < 1) {
      // just a round-off (e.g. 52.64 -> 53): fold it into the biggest item
      const big = items.reduce((a, b) => (b.amount > a.amount ? b : a));
      big.amount = round(big.amount + diff);
      diff = 0;
    }
    if (diff > 0) {
      // fees follow the bill's most common head/category
      const count = (k) => items.reduce((m, it) => (m[it[k]] = (m[it[k]] || 0) + it.amount, m), {});
      const top = (m) => Object.keys(m).sort((a, b) => m[b] - m[a])[0];
      items.push({ name: 'Delivery & fees', qty: 1, amount: diff, category: top(count('category')), head: top(count('head')), isFee: true });
    }
    return items;
  }

  /** Quick check that a Gemini key works (lists models). */
  async function testGeminiKey(key) {
    try {
      const res = await fetch(GEMINI + '/models?pageSize=1', { headers: { 'x-goog-api-key': clean(key) } });
      if (res.ok) return { ok: true, message: 'Key works ✓' };
      if (res.status === 429) return { ok: true, message: 'Key works (free limit reached for now)' };
      return { ok: false, message: 'Google rejected this key (' + res.status + ').' };
    } catch (e) { return { ok: true, message: 'Saved — couldn\'t test it now (no internet?).' }; }
  }

  const api = {
    read, splitBill, pickKey, pickedKey, hasKey, isOn, addGeminiKey, removeGeminiKey, setClaudeKey, setEnabled, testGeminiKey, masked,
    geminiKeys: () => cfg.geminiKeys.slice(), claudeKey: () => cfg.claudeKey, enabled: () => cfg.enabled,
    _schema: schema, _toGeminiSchema: toGeminiSchema, _tidy: tidy, _reload: () => { cfg = load(); }, _sdk: null, _setTimeout: (ms) => { GEMINI_TIMEOUT_MS = ms; },
  };
  root.AI = api;
})(self);
