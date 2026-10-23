/* =====================================================================
 * ocr.js — reads the text on a bill photo, right on your phone.
 *
 * Uses Tesseract.js (free, open source). The first scan downloads the
 * reading engine (~10 MB) once; after that it is cached by the browser.
 * The photo never leaves your phone.
 * ===================================================================== */
(function (root) {
  'use strict';

  const CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  let loading = null;
  let worker = null;
  let progressFn = () => {}; // updated on every scan (the worker is reused)

  function loadLib() {
    if (root.Tesseract) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CDN;
      s.onload = () => resolve();
      s.onerror = () => { loading = null; reject(new Error('Bill scanner needs internet the first time. Please connect and try again.')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  /** Open the photo already shrunk (never at full camera size), so it fits in memory. */
  async function openSmall(file, maxW) {
    if (typeof createImageBitmap === 'function') {
      try {
        const probe = await createImageBitmap(file, { resizeWidth: 64, resizeQuality: 'low' });
        const portrait = probe.height >= probe.width;
        probe.close && probe.close();
        return await createImageBitmap(file, portrait ? { resizeHeight: Math.round(maxW * 1.4), resizeQuality: 'high' } : { resizeWidth: maxW, resizeQuality: 'high' });
      } catch (e) { /* fall back below */ }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This phone couldn\'t open that photo (not enough memory). Close other apps and try again.')); };
      img.src = url;
    });
  }

  /** Shrink, grey-scale and sharpen contrast — makes thermal bills much easier to read. */
  async function prepare(file) {
    const img = await openSmall(file, 1400);
    const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    const scale = Math.min(1, 1400 / iw, 2000 / ih);
    const w = Math.round(iw * scale), h = Math.round(ih * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    if (img.close) img.close();
    const px = g.getImageData(0, 0, w, h);
    const d = px.data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = v; if (v < min) min = v; if (v > max) max = v;
    }
    const range = Math.max(1, max - min);
    for (let i = 0; i < d.length; i += 4) {
      let v = ((d[i] - min) / range) * 255;
      v = v < 128 ? v * 0.8 : Math.min(255, v * 1.15);
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    g.putImageData(px, 0, 0);
    return c;
  }

  /**
   * Read a bill photo. onProgress(0..1, message) is called while working.
   * Returns the plain text found on the bill.
   */
  async function readBill(file, onProgress) {
    onProgress = progressFn = onProgress || (() => {});
    onProgress(0.02, 'Preparing photo…');
    const canvas = await prepare(file);
    onProgress(0.08, 'Loading bill reader…');
    await loadLib();
    if (!worker) {
      worker = await root.Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') progressFn(0.3 + m.progress * 0.7, 'Reading bill… ' + Math.round(m.progress * 100) + '%');
          else if (m.progress != null) progressFn(0.08 + m.progress * 0.2, m.status.replace(/^./, (c) => c.toUpperCase()) + '…');
        },
      });
    }
    try {
      const { data } = await worker.recognize(canvas);
      onProgress(1, 'Done');
      return data.text || '';
    } finally {
      // free the reader's memory (about 100 MB) right away; it reloads from cache next time
      canvas.width = canvas.height = 0;
      try { await worker.terminate(); } catch (e) { /* ignore */ }
      worker = null;
    }
  }

  root.OCR = { readBill };
})(self);
