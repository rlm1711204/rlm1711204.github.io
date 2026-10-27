/* =====================================================================
 * camera.js — Kaasu's own camera for bill photos.
 *
 * The phone's camera app is a separate app: on many Android phones the
 * system closes Kaasu while it is open (to free memory), and the photo is
 * lost. This camera runs inside Kaasu, so that can't happen.
 *
 *   Camera.supported()   -> true when the browser can show a camera here
 *   Camera.open()        -> Promise<File|null>  (null = closed without a photo)
 * ===================================================================== */
(function (root) {
  'use strict';

  const MAX_SIDE = 2000;   // big enough to read small print, small enough for memory
  let el = null, stream = null, finish = null;

  const supported = () => !!(root.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  function build() {
    if (el) return el;
    el = document.createElement('dialog');
    el.id = 'cam-view';
    el.innerHTML = `
      <video id="cam-video" playsinline muted autoplay></video>
      <div class="cam-frame" aria-hidden="true"></div>
      <p class="cam-hint" id="cam-hint">Fit the whole bill inside the frame</p>
      <div class="cam-bar">
        <button type="button" class="cam-side" id="cam-close" aria-label="Close camera">✕</button>
        <button type="button" class="cam-shutter" id="cam-shot" aria-label="Take photo"><span></span></button>
        <button type="button" class="cam-side" id="cam-torch" aria-label="Flash" hidden>🔦</button>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#cam-close').onclick = () => done(null);
    el.querySelector('#cam-shot').onclick = shoot;
    el.querySelector('#cam-torch').onclick = toggleTorch;
    el.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    return el;
  }

  function stop() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    const v = el && el.querySelector('#cam-video');
    if (v) v.srcObject = null;
  }

  function done(file) {
    stop();
    if (el && el.open) el.close();
    const f = finish; finish = null;
    if (f) f(file);
  }

  let torchOn = false;
  async function toggleTorch() {
    const track = stream && stream.getVideoTracks()[0];
    if (!track) return;
    torchOn = !torchOn;
    try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch (e) { torchOn = false; }
    el.querySelector('#cam-torch').classList.toggle('on', torchOn);
  }

  function shoot() {
    const v = el.querySelector('#cam-video');
    const w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) return;                         // camera not ready yet
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    el.querySelector('#cam-shot').disabled = true;
    c.toBlob((b) => {
      el.querySelector('#cam-shot').disabled = false;
      done(b ? new File([b], 'bill-' + Date.now() + '.jpg', { type: 'image/jpeg' }) : null);
    }, 'image/jpeg', 0.9);
  }

  /** Open the camera. Rejects when the camera can't be used (no permission…). */
  async function open() {
    if (finish) return null;
    build();
    torchOn = false;
    el.querySelector('#cam-torch').hidden = true;
    el.querySelector('#cam-torch').classList.remove('on');
    el.showModal();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    } catch (e) {
      el.close();
      const err = new Error(e && e.name === 'NotAllowedError'
        ? 'Kaasu is not allowed to use the camera. Allow it in the browser\'s site settings, or use the phone camera app / gallery below.'
        : 'Could not start the camera here. Use the phone camera app or the gallery below.');
      err.name = e && e.name;
      throw err;
    }
    const v = el.querySelector('#cam-video');
    v.srcObject = stream;
    try { await v.play(); } catch (e) { /* autoplay with muted video normally works */ }
    const track = stream.getVideoTracks()[0];
    const caps = track && track.getCapabilities ? track.getCapabilities() : {};
    el.querySelector('#cam-torch').hidden = !caps.torch;
    return new Promise((resolve) => { finish = resolve; });
  }

  root.Camera = { supported, open };
})(self);
