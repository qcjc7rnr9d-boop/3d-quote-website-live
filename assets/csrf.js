(function () {
  'use strict';

  const originalFetch = window.fetch ? window.fetch.bind(window) : null;
  if (!originalFetch || window.__trennenCsrfInstalled) return;
  window.__trennenCsrfInstalled = true;

  let tokenPromise = null;
  const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  function methodOf(input, init) {
    const method = init && init.method
      ? init.method
      : (input && input.method ? input.method : 'GET');
    return String(method || 'GET').toUpperCase();
  }

  function isSameOriginApi(input) {
    const raw = typeof input === 'string' ? input : (input && input.url) || '';
    try {
      const url = new URL(raw, window.location.href);
      return url.origin === window.location.origin && url.pathname.indexOf('/api/') === 0;
    } catch {
      return false;
    }
  }

  async function csrfToken() {
    if (!tokenPromise) {
      tokenPromise = originalFetch('/api/csrf-token', {
        credentials: 'same-origin',
        cache: 'no-store',
      })
        .then(res => res.ok ? res.json() : null)
        .then(data => data && data.csrfToken ? data.csrfToken : '')
        .catch(() => '');
    }
    return tokenPromise;
  }

  window.fetch = async function trennenFetch(input, init) {
    const method = methodOf(input, init);
    if (!unsafeMethods.has(method) || !isSameOriginApi(input)) {
      return originalFetch(input, init);
    }

    const token = await csrfToken();
    if (!token) return originalFetch(input, init);

    const nextInit = { ...(init || {}) };
    const headers = new Headers(nextInit.headers || (input && input.headers) || undefined);
    if (!headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', token);
    nextInit.headers = headers;
    nextInit.credentials = nextInit.credentials || 'same-origin';
    return originalFetch(input, nextInit);
  };
})();
