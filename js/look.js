/* =====================================================================
 * look.js — colour theme, light/dark and font. Saved on this phone only.
 * Loaded in <head> so the app opens in your colours without a flash.
 * ===================================================================== */
(function (root) {
  'use strict';

  const KEY = 'kaasu.look.v1';
  const OLD_THEME_KEY = 'expense-tracker.theme';   // light/dark, from older versions

  const SKINS = [
    { id: 'indigo', name: 'Kaasu Indigo', a: '#3f3cbb', b: '#6a43c9' },
    { id: 'mango', name: 'Mango', a: '#c2410c', b: '#a16207' },
    { id: 'ocean', name: 'Ocean', a: '#0e7490', b: '#1d4ed8' },
    { id: 'rose', name: 'Rose', a: '#be185d', b: '#7e22ce' },
    { id: 'forest', name: 'Forest', a: '#166534', b: '#0f766e' },
  ];
  const FONTS = [
    { id: 'system', name: 'Phone default', css: '' },
    { id: 'poppins', name: 'Poppins', css: 'Poppins:wght@400;500;600;700' },
    { id: 'nunito', name: 'Nunito', css: 'Nunito:wght@400;600;700;800' },
    { id: 'baloo', name: 'Baloo 2', css: 'Baloo+2:wght@400;500;600;700' },
    { id: 'lora', name: 'Lora', css: 'Lora:wght@400;500;600;700' },
  ];

  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { cfg = {}; }
  if (cfg.mode == null) { try { cfg.mode = localStorage.getItem(OLD_THEME_KEY) || ''; } catch (e) { cfg.mode = ''; } }

  function loadFont(id) {
    const f = FONTS.find((x) => x.id === id);
    if (!f || !f.css || document.getElementById('font-' + id)) return;
    const l = document.createElement('link');
    l.id = 'font-' + id; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=' + f.css + '&display=swap';
    document.head.appendChild(l);
  }

  function apply() {
    const html = document.documentElement;
    const skin = SKINS.find((s) => s.id === cfg.skin) || SKINS[0];
    html.dataset.skin = skin.id;
    if (cfg.mode === 'light' || cfg.mode === 'dark') html.dataset.theme = cfg.mode; else delete html.dataset.theme;
    const font = FONTS.find((f) => f.id === cfg.font) || FONTS[0];
    html.dataset.font = font.id;
    loadFont(font.id);
    // phone status bar in the theme's colour
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      const dark = /dark/.test(m.media || '') ? true : /light/.test(m.media || '') ? false : null;
      m.content = (cfg.mode === 'dark' || (dark && cfg.mode !== 'light')) ? '#121211' : skin.a;
    });
  }

  function set(changes) {
    Object.assign(cfg, changes);
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
    apply();
  }

  apply();
  root.Look = {
    SKINS, FONTS, set,
    skin: () => (SKINS.find((s) => s.id === cfg.skin) || SKINS[0]).id,
    font: () => (FONTS.find((f) => f.id === cfg.font) || FONTS[0]).id,
    mode: () => cfg.mode || '',
  };
})(self);
