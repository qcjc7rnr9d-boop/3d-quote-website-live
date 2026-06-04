(() => {
  const params = new URLSearchParams(window.location.search);
  const embedded = params.get('embed') === '1' || window.location.pathname.startsWith('/embed/');
  const shop = params.get('shop') || 'trennen';
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
  postResize(true);
  window.addEventListener('DOMContentLoaded', () => {
    document.body?.classList.add('is-embedded');
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
