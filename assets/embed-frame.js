(() => {
  const params = new URLSearchParams(window.location.search);
  const embedded = params.get('embed') === '1' || window.location.pathname.startsWith('/embed/');
  const shop = params.get('shop') || 'trennen';
  const themePrimary = params.get('theme_primary') || params.get('themePrimary') || '';
  const themeFont = params.get('theme_font') || params.get('themeFont') || '';
  const quoteFlowPaths = new Set([
    '/',
    '/index.html',
    '/materials.html',
    '/options.html',
    '/quote.html',
    '/checkout.html',
    '/embed/quote',
  ]);

  function addEmbedParam(rawHref) {
    if (!embedded || !rawHref || rawHref.startsWith('#')) return rawHref;
    if (/^(mailto:|tel:|javascript:)/i.test(rawHref)) return rawHref;
    let url;
    try {
      url = new URL(rawHref, window.location.href);
    } catch {
      return rawHref;
    }
    if (url.origin !== window.location.origin) return rawHref;
    if (!quoteFlowPaths.has(url.pathname)) return rawHref;
    if (!url.searchParams.get('shop')) url.searchParams.set('shop', shop);
    url.searchParams.set('embed', '1');
    return `${url.pathname || '/index.html'}${url.search}${url.hash}`;
  }

  function normalizeHexColor(value) {
    const raw = String(value || '').trim();
    const short = raw.match(/^#([0-9a-f]{3})$/i);
    if (short) {
      return `#${short[1].split('').map(char => `${char}${char}`).join('')}`.toLowerCase();
    }
    const full = raw.match(/^#([0-9a-f]{6})$/i);
    return full ? `#${full[1]}`.toLowerCase() : '';
  }

  function hexToRgb(hex) {
    const value = normalizeHexColor(hex).slice(1);
    if (!value) return null;
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16),
    };
  }

  function rgbToHex({ r, g, b }) {
    return `#${[r, g, b].map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;
  }

  function mix(hex, target, amount) {
    const rgb = hexToRgb(hex);
    if (!rgb) return '';
    return rgbToHex({
      r: rgb.r + (target.r - rgb.r) * amount,
      g: rgb.g + (target.g - rgb.g) * amount,
      b: rgb.b + (target.b - rgb.b) * amount,
    });
  }

  function normalizeFontFamily(value) {
    const name = String(value || '').trim();
    if (!/^[a-z0-9][a-z0-9 -]{0,47}$/i.test(name)) return '';
    return `'${name.replace(/'/g, '')}', system-ui, sans-serif`;
  }

  function applyEmbedTheme() {
    if (!embedded) return;
    const root = document.documentElement;
    const primary = normalizeHexColor(themePrimary);
    if (primary) {
      const hover = mix(primary, { r: 0, g: 0, b: 0 }, 0.22);
      const soft = mix(primary, { r: 255, g: 255, b: 255 }, 0.88);
      const line = mix(primary, { r: 255, g: 255, b: 255 }, 0.66);
      root.style.setProperty('--color-primary', primary);
      root.style.setProperty('--color-primary-hover', hover);
      root.style.setProperty('--color-primary-soft', soft);
      root.style.setProperty('--sage', primary);
      root.style.setProperty('--sage-dark', hover);
      root.style.setProperty('--sage-soft', soft);
      root.style.setProperty('--sage-bg', soft);
      root.style.setProperty('--sage-light', line);
      root.style.setProperty('--sage-line', line);
    }
    const font = normalizeFontFamily(themeFont);
    if (font) {
      root.style.setProperty('--font-ui', font);
    }
  }

  function rewriteQuoteFlowLinks(root = document) {
    if (!embedded) return;
    root.querySelectorAll?.('a[href]').forEach(link => {
      const next = addEmbedParam(link.getAttribute('href'));
      if (next && next !== link.getAttribute('href')) link.setAttribute('href', next);
    });
  }

  function parentOrigin() {
    try {
      if (document.referrer) return new URL(document.referrer).origin;
    } catch {}
    return '*';
  }

  function measureHeight() {
    const body = document.body;
    const html = document.documentElement;
    return Math.ceil(Math.max(
      body?.scrollHeight || 0,
      body?.offsetHeight || 0,
      html?.scrollHeight || 0,
      html?.offsetHeight || 0,
      html?.clientHeight || 0,
    ));
  }

  let resizeQueued = false;
  let lastHeight = 0;
  function postResize(force = false) {
    if (!embedded || window.parent === window) return;
    if (resizeQueued && !force) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      const height = measureHeight();
      if (!force && Math.abs(height - lastHeight) < 2) return;
      lastHeight = height;
      window.parent.postMessage({
        type: 'trennen:embed-resize',
        height,
        path: window.location.pathname,
        search: window.location.search,
        shop,
      }, parentOrigin());
    });
  }

  window.TrennenEmbed = {
    isEmbedded: embedded,
    addEmbedParam,
    postResize: () => postResize(true),
  };

  if (!embedded) return;

  document.documentElement.classList.add('is-embedded');
  applyEmbedTheme();
  postResize(true);
  window.addEventListener('DOMContentLoaded', () => {
    document.body?.classList.add('is-embedded');
    applyEmbedTheme();
    rewriteQuoteFlowLinks();
    postResize(true);

    const mutationObserver = new MutationObserver(() => {
      rewriteQuoteFlowLinks();
      postResize();
    });
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'class', 'style', 'hidden', 'aria-expanded'],
    });

    if ('ResizeObserver' in window) {
      const resizeObserver = new ResizeObserver(() => postResize());
      if (document.body) resizeObserver.observe(document.body);
      resizeObserver.observe(document.documentElement);
    }

    setTimeout(() => postResize(true), 200);
    setTimeout(() => postResize(true), 800);
    setTimeout(() => postResize(true), 1800);
  });
  window.addEventListener('load', () => postResize(true));
  window.addEventListener('resize', () => postResize());
})();
