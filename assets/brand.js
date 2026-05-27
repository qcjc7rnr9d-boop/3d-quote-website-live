/**
 * Brand applier — drop-in script that loads the current shop's branding
 * and applies it to the page (title, wordmark, footer, logo).
 *
 * Usage:
 *   <script src="/assets/brand.js" defer></script>
 *
 * It auto-detects context:
 *   • Pages under /admin/  → fetches /api/auth/me (requires a session)
 *   • Anywhere else        → fetches /api/customer/shop-info?shop=<slug>
 *                            (slug from ?shop= URL param, or localStorage,
 *                             or falls back to "trennen")
 *
 * The page can mark elements that should receive brand content using
 * `data-brand="…"` attributes, OR rely on the legacy class names below
 * which are matched out of the box.
 *
 * Supported `data-brand` slots:
 *   data-brand="name"       → textContent = shop.name
 *   data-brand="tagline"    → textContent = shop.tagline
 *   data-brand="logo"       → if <img>: src = shop.logo_url; else background-image
 *   data-brand="copyright"  → textContent = "© YYYY <Name>. All rights reserved."
 *
 * Legacy class auto-matches (treated as data-brand="name"):
 *   .wordmark .nav-wordmark .footer-wordmark .auth-wordmark .brand-name
 *
 * The placeholder strings "trennen" and the legacy "mahi3d" inside
 * <title> are also replaced.
 */

(function () {
  'use strict';

  const PLACEHOLDER = 'trennen';
  const LEGACY_PLACEHOLDER = 'mahi3d';

  function detectSlug() {
    try {
      const u = new URLSearchParams(location.search).get('shop');
      if (u) return u;
    } catch {}
    try {
      const sel = JSON.parse(localStorage.getItem('form_selection') || '{}');
      if (sel && sel.shopSlug) return sel.shopSlug;
    } catch {}
    return PLACEHOLDER;
  }

  async function fetchPlatformInfo() {
    try {
      const r = await fetch('/api/platform-info');
      if (r.ok) return await r.json();
    } catch {}
    return null;
  }

  async function fetchBrand() {
    const path      = location.pathname;
    const isPlatform = path.indexOf('/platform/') === 0 || path.indexOf('platform/') === 0;
    const isAdmin    = path.indexOf('/admin/')    === 0 || path.indexOf('admin/')    === 0;

    // /platform/* always shows the platform brand (Trennen) — never a shop's.
    if (isPlatform) return await fetchPlatformInfo();

    if (isAdmin) {
      // Try the logged-in shop session first (post-login: shop brand wins)
      try {
        const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
        if (r.ok) return await r.json();
      } catch {}
      // Auth pages (login, forgot/reset/change-password) have no session.
      // Show the platform brand so customers don't see a shop name they
      // don't belong to.
      return await fetchPlatformInfo();
    }

    // Customer-facing pages — use the per-shop brand.
    try {
      const slug = detectSlug();
      const r = await fetch(`/api/customer/shop-info?shop=${encodeURIComponent(slug)}`);
      if (r.ok) return await r.json();
    } catch {}
    return null;
  }

  function setText(el, text) {
    if (!el || text == null) return;
    el.textContent = text;
  }

  function applyBrand(b) {
    if (!b || !b.name) return;
    const NAME = String(b.name);

    // 1. <title> — replace either the current or legacy demo placeholder.
    if (document.title) {
      document.title = document.title
        .replace(new RegExp(LEGACY_PLACEHOLDER, 'gi'), NAME)
        .replace(new RegExp(PLACEHOLDER, 'gi'), NAME);
    }

    // 2. Explicit slots (data-brand="name") + legacy class names
    const nameSelectors = [
      '[data-brand="name"]',
      '.wordmark',
      '.brand',
      '.logo',
      '.nav-wordmark',
      '.footer-wordmark',
      '.auth-wordmark',
      '.platform-wordmark',
      '.brand-name',
      '.sidebar-store-name',
    ];
    document.querySelectorAll(nameSelectors.join(',')).forEach(el => {
      // Skip if the element contains other meaningful children — only
      // replace plain text wordmarks
      const onlyText = el.children.length === 0;
      if (onlyText) setText(el, NAME);
    });

    // 3. Special compound wordmarks like <a class="logo">mahi<span>3d</span></a>
    //    Replace only the first text node so the styled accent stays intact.
    document.querySelectorAll('.logo').forEach(el => {
      const first = el.firstChild;
      if (first && first.nodeType === Node.TEXT_NODE && /mahi/i.test(first.nodeValue)) {
        // Find a "split index" — keep the visual accent on the last word
        const parts = NAME.trim().split(/\s+/);
        if (parts.length >= 2) {
          first.nodeValue = parts.slice(0, -1).join(' ') + ' ';
          const lastSpan = el.querySelector('.logo-dot');
          if (lastSpan) setText(lastSpan, parts[parts.length - 1]);
          else first.nodeValue = NAME;
        } else {
          // Single-word brand — drop the dot accent
          first.nodeValue = NAME;
          const lastSpan = el.querySelector('.logo-dot');
          if (lastSpan) lastSpan.remove();
        }
      }
    });

    // 4. Tagline
    if (b.tagline) {
      document.querySelectorAll('[data-brand="tagline"]').forEach(el => setText(el, b.tagline));
    }

    // 5. Logo image
    if (b.logo_url) {
      document.querySelectorAll('[data-brand="logo"]').forEach(el => {
        if (el.tagName === 'IMG') el.src = b.logo_url;
        else el.style.backgroundImage = `url("${b.logo_url}")`;
      });
    }

    // 6. Copyright text — supports footer-copy class + explicit slot
    const yr = new Date().getFullYear();
    document.querySelectorAll('.footer-copy, [data-brand="copyright"]').forEach(el => {
      setText(el, `© ${yr} ${NAME}. All rights reserved.`);
    });

    // 7. Notify the page in case it wants to react (e.g. update meta tags)
    document.dispatchEvent(new CustomEvent('brand:applied', { detail: b }));
  }

  // Boot
  fetchBrand().then(applyBrand);
})();
