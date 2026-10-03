(function () {
  const STYLE_ID = '__dark_mode_ext__';
  const GLOBAL_SCOPE_KEY = '__dark_mode_global_scope__';
  const GLOBAL_DARK_KEY = '__dark_mode_global__';
  const key = location.origin;
  let currentIsDark = false;

  function parseLuminance(r, g, b) {
    const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  // Returns luminance [0,1] of el's background-color, or null if transparent/unset.
  function bgLuminance(el) {
    const m = getComputedStyle(el).backgroundColor.match(
      /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/
    );
    if (!m || (m[4] !== undefined && +m[4] < 0.05)) return null;
    return parseLuminance(+m[1], +m[2], +m[3]);
  }

  function bodyIsDark() {
    if (!document.body) return false;
    const lum = bgLuminance(document.body);
    return lum !== null && lum < 0.5;
  }

  function visibleArea(el) {
    const rect = el.getBoundingClientRect();
    const w = Math.min(rect.right, innerWidth) - Math.max(rect.left, 0);
    const h = Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0);
    return w > 0 && h > 0 ? w * h : 0;
  }

  // True only when body contains a substantial light-background panel, i.e. a
  // "dark shell + large white content area" layout. Small light widgets on an
  // otherwise dark page should not trigger the selective body>* inversion.
  // Scans up to 800 elements for performance.
  function bodyHasLightContent() {
    if (!document.body) return false;
    const viewportArea = Math.max(innerWidth * innerHeight, 1);
    let n = 0;
    for (const el of document.body.querySelectorAll('*')) {
      if (n++ > 800) break;
      const t = el.tagName;
      if (t === 'SCRIPT' || t === 'STYLE' || t === 'NOSCRIPT') continue;
      const lum = bgLuminance(el);
      if (lum === null || lum < 0.5) continue;

      const area = visibleArea(el);
      if (!area) continue;

      const areaRatio = area / viewportArea;
      if (areaRatio >= 0.12) return true;
    }
    return false;
  }

  function shouldForceFullPageInvert() {
    return location.hostname === 'linear.app' || location.hostname.endsWith('.linear.app');
  }

  function buildFullPageCSS() {
    const canvasBackground = bodyIsDark() ? 'black' : 'white';

    // Anchor the viewport canvas to the page's source brightness before the
    // filter runs; light pages invert to dark, dark pages invert to light.
    return (
      'html{background:' + canvasBackground + ' !important;filter:invert(1) hue-rotate(180deg) !important}' +
      'html img,html video,html picture,html canvas,' +
      'html embed,html object,html iframe,' +
      'html svg image{filter:invert(1) hue-rotate(180deg) !important}'
    );
  }

  function buildLinearCSS() {
    return (
      'html{background:black !important;color-scheme:light !important}' +
      'body{background:black !important;filter:invert(1) hue-rotate(180deg) !important}' +
      '#root,#__next,[data-portal-root]{background:black !important}' +
      'body img,body video,body picture,body canvas,' +
      'body embed,body object,body iframe,' +
      'body svg image{filter:invert(1) hue-rotate(180deg) !important}'
    );
  }

  function buildDarkCSS() {
    if (shouldForceFullPageInvert()) return buildLinearCSS();
    if (bodyIsDark() && bodyHasLightContent()) {
      // Mixed layout: dark body surrounding explicit light-background content areas.
      // Invert only child content so light areas become dark; body background is untouched.
      // body>* img rule: re-inverts media nested inside an inverted child (double->original).
      return (
        'body>*{filter:invert(1) hue-rotate(180deg) !important}' +
        'body>* img,body>* video,body>* picture,body>* canvas,' +
        'body>* embed,body>* object,body>* iframe,' +
        'body>* svg image{filter:invert(1) hue-rotate(180deg) !important}'
      );
    }
    // Light body, or uniformly dark body (e.g. phrack.org): standard full-page invert.
    return buildFullPageCSS();
  }

  function ensureStyleElement() {
    let s = document.getElementById(STYLE_ID);
    if (!s) {
      s = document.createElement('style');
      s.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(s);
    }
    return s;
  }

  function applyDark() {
    currentIsDark = true;
    const s = ensureStyleElement();
    const css = buildDarkCSS();
    if (s.textContent !== css) s.textContent = css;
  }

  function removeDark() {
    currentIsDark = false;
    const s = document.getElementById(STYLE_ID);
    if (s && s.textContent) s.textContent = '';
  }

  function refreshDarkIfNeeded() {
    if (currentIsDark) applyDark();
  }

  function applyMode(isDark) {
    isDark ? applyDark() : removeDark();
  }

  function scheduleRefresh() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', refreshDarkIfNeeded, { once: true });
    }
    window.addEventListener('load', refreshDarkIfNeeded, { once: true });
    window.addEventListener('pageshow', refreshDarkIfNeeded, { once: true });
  }

  // Global scope uses storage.local so newly opened pages inherit the current
  // global on/off state. Per-page mode is also stored persistently and keyed by origin.
  function loadStoredMode() {
    chrome.storage.local.get([GLOBAL_SCOPE_KEY, GLOBAL_DARK_KEY, key], (stored) => {
      const isGlobalScope = !!stored[GLOBAL_SCOPE_KEY];
      const isGlobalDark = !!stored[GLOBAL_DARK_KEY];
      const isPageDark = !!stored[key];
      const isDark = isGlobalScope ? isGlobalDark : isPageDark;

      applyMode(isDark);
      if (isDark) scheduleRefresh();
      chrome.runtime.sendMessage({ type: 'PAGE_MODE', isDark, isGlobalScope, isGlobalDark, isPageDark });
    });
  }

  loadStoredMode();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes[GLOBAL_SCOPE_KEY] || changes[GLOBAL_DARK_KEY] || changes[key]) {
      loadStoredMode();
    }
  });

  // Background sends this when the user changes the toolbar state.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SET_MODE') {
      applyMode(!!msg.isDark);
      if (msg.isDark) scheduleRefresh();
    }
  });
})();
