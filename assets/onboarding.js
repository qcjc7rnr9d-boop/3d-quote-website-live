(function () {
  'use strict';

  const nav = document.getElementById('signupNav');
  const navToggle = document.getElementById('signupNavToggle');
  const form = document.getElementById('onboarding-form');
  const success = document.getElementById('onboarding-success');
  const failure = document.getElementById('onboarding-failure');
  const slugStatus = document.getElementById('slugAvailability');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let slugEdited = false;
  let slugTimer = null;
  let latestSlugRequest = 0;

  function trackEvent(name, details = {}) {
    if (!name || !Array.isArray(window.dataLayer)) return;
    window.dataLayer.push({ event: name, ...details });
  }

  function closeNav() {
    if (!nav || !navToggle) return;
    nav.classList.remove('is-open');
    document.body.classList.remove('nav-open');
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', 'Open navigation');
  }

  if (nav && navToggle) {
    navToggle.addEventListener('click', () => {
      const open = !nav.classList.contains('is-open');
      nav.classList.toggle('is-open', open);
      document.body.classList.toggle('nav-open', open);
      navToggle.setAttribute('aria-expanded', String(open));
      navToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    });

    nav.addEventListener('click', event => {
      if (event.target.closest('a')) closeNav();
    });
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeNav();
  });

  document.querySelectorAll('[data-scroll-target]').forEach(link => {
    link.addEventListener('click', event => {
      const target = document.querySelector(link.getAttribute('href'));
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
      closeNav();
    });
  });

  function emailLooksValid(value) {
    const email = String(value || '').trim();
    return email.length <= 254 && !email.includes('..') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function slugify(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 48)
      .replace(/-+$/g, '');
  }

  function field(id) {
    return document.getElementById(`onboarding-${id}`);
  }

  function value(id) {
    const el = field(id);
    return el ? el.value.trim() : '';
  }

  function setError(id, message) {
    const inputMap = {
      ownerName: 'owner-name',
      shopName: 'shop-name',
      monthlyQuoteVolume: 'volume',
    };
    const input = field(inputMap[id] || id.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)) || field(id);
    const error = form ? form.querySelector(`[data-field-error="${id}"]`) : null;
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (error) error.textContent = message || '';
  }

  function passwordError(password) {
    if (!password || password.length < 8) return 'Password must be at least 8 characters.';
    if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter.';
    if (!/[0-9]/.test(password)) return 'Password must contain at least one digit.';
    if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character.';
    return '';
  }

  function validate() {
    const errors = {};
    if (!value('owner-name')) errors.ownerName = 'Enter your name.';
    if (!value('email')) {
      errors.email = 'Enter your work email.';
    } else if (!emailLooksValid(value('email'))) {
      errors.email = 'Enter a valid work email.';
    }
    if (!value('shop-name')) errors.shopName = 'Enter your shop name.';
    if (!value('slug')) errors.slug = 'Choose a shop URL slug.';
    else if (value('slug').length < 3) errors.slug = 'Use at least 3 letters or numbers.';
    if (!value('volume')) errors.monthlyQuoteVolume = 'Select a monthly quote range.';
    const passError = passwordError(value('password'));
    if (passError) errors.password = passError;

    setError('ownerName', errors.ownerName);
    setError('email', errors.email);
    setError('shopName', errors.shopName);
    setError('slug', errors.slug);
    setError('monthlyQuoteVolume', errors.monthlyQuoteVolume);
    setError('password', errors.password);
    return errors;
  }

  function setSubmitting(submitting) {
    const button = form ? form.querySelector('button[type="submit"]') : null;
    if (!button) return;
    button.disabled = submitting;
    button.textContent = submitting ? 'Creating...' : 'Create shop';
  }

  function applyServerErrors(errors) {
    Object.entries(errors || {}).forEach(([key, message]) => {
      setError(key, message);
    });
  }

  async function checkSlugAvailability(slug) {
    const normalized = slugify(slug);
    const slugInput = field('slug');
    if (slugInput && slugInput.value !== normalized) slugInput.value = normalized;
    if (!slugStatus) return null;
    if (!normalized) {
      slugStatus.textContent = 'Use letters, numbers, and hyphens.';
      slugStatus.className = 'field-hint';
      return null;
    }
    if (normalized.length < 3) {
      slugStatus.textContent = 'Use at least 3 letters or numbers.';
      slugStatus.className = 'field-hint is-error';
      return null;
    }
    const requestId = ++latestSlugRequest;
    slugStatus.textContent = 'Checking URL...';
    slugStatus.className = 'field-hint';
    try {
      const res = await fetch(`/api/onboarding/slug-availability?slug=${encodeURIComponent(normalized)}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (requestId !== latestSlugRequest) return data;
      if (data.available) {
        slugStatus.textContent = `trennen.co.nz/${data.slug} is available.`;
        slugStatus.className = 'field-hint is-success';
        setError('slug', '');
      } else {
        slugStatus.textContent = data.suggestion
          ? `${data.error || 'That URL is not available'} Try ${data.suggestion}.`
          : (data.error || 'That URL is not available.');
        slugStatus.className = 'field-hint is-error';
      }
      return data;
    } catch {
      if (requestId === latestSlugRequest) {
        slugStatus.textContent = 'Could not check the URL. We will try again on submit.';
        slugStatus.className = 'field-hint is-error';
      }
      return null;
    }
  }

  function scheduleSlugCheck() {
    window.clearTimeout(slugTimer);
    slugTimer = window.setTimeout(() => checkSlugAvailability(value('slug')), 240);
  }

  function selectPlan(planId, { scroll = false, source = 'manual' } = {}) {
    const allowed = new Set(['community', 'starter', 'growth', 'scale']);
    const selected = allowed.has(String(planId || '').toLowerCase())
      ? String(planId).toLowerCase()
      : 'starter';
    const plan = field('plan');
    if (plan) plan.value = selected;
    document.querySelectorAll('[data-plan-card]').forEach(card => {
      card.classList.toggle('is-selected', card.dataset.planCard === selected);
    });
    if (scroll) {
      const setup = document.getElementById('shop-setup');
      if (setup) setup.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
    }
    trackEvent('onboarding_plan_select', { plan: selected, source });
    return selected;
  }

  document.querySelectorAll('[data-plan-select]').forEach(button => {
    button.addEventListener('click', () => {
      selectPlan(button.dataset.planSelect || 'starter', { scroll: true, source: 'button' });
    });
  });

  const initialPlan = new URLSearchParams(window.location.search).get('plan');
  if (initialPlan) {
    selectPlan(initialPlan, { scroll: false, source: 'query' });
  } else {
    selectPlan(value('plan') || 'starter', { scroll: false, source: 'default' });
  }

  const shopName = field('shop-name');
  const slug = field('slug');
  if (shopName && slug) {
    shopName.addEventListener('input', () => {
      if (slugEdited) return;
      slug.value = slugify(shopName.value);
      scheduleSlugCheck();
    });
    slug.addEventListener('input', () => {
      slugEdited = true;
      slug.value = slugify(slug.value);
      setError('slug', '');
      scheduleSlugCheck();
    });
    slug.addEventListener('blur', () => checkSlugAvailability(slug.value));
  }

  if (form) {
    form.addEventListener('input', event => {
      const name = event.target.name || '';
      if (!name || name === 'website') return;
      setError(name, '');
      if (success) success.hidden = true;
      if (failure) failure.hidden = true;
    });

    form.addEventListener('change', event => {
      const name = event.target.name || '';
      if (!name || name === 'website') return;
      setError(name, '');
      if (success) success.hidden = true;
      if (failure) failure.hidden = true;
    });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (success) success.hidden = true;
      if (failure) failure.hidden = true;

      const errors = validate();
      const firstError = Object.keys(errors)[0];
      if (firstError) {
        const focusMap = {
          ownerName: 'owner-name',
          shopName: 'shop-name',
          monthlyQuoteVolume: 'volume',
        };
        const input = field(focusMap[firstError] || firstError);
        if (input) input.focus({ preventScroll: false });
        return;
      }

      const availability = await checkSlugAvailability(value('slug'));
      if (availability && availability.available === false) {
        setError('slug', availability.error || 'That shop URL is not available.');
        field('slug')?.focus({ preventScroll: false });
        return;
      }

      const payload = {
        ownerName: value('owner-name'),
        email: value('email'),
        shopName: value('shop-name'),
        slug: value('slug'),
        plan: value('plan') || 'starter',
        paymentPath: value('payment') || 'bank_transfer_first',
        monthlyQuoteVolume: value('volume'),
        password: value('password'),
        website: value('website'),
      };

      setSubmitting(true);
      try {
        const res = await fetch('/api/onboarding/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = res.status === 204 ? { ok: true } : await res.json().catch(() => ({}));
        if (!res.ok && res.status !== 204) {
          if (data.errors) applyServerErrors(data.errors);
          throw new Error(data.error || 'Signup failed');
        }
        if (success) success.hidden = false;
        trackEvent('onboarding_signup', { plan: payload.plan, paymentPath: payload.paymentPath });
        window.setTimeout(() => {
          window.location.href = data.redirectUrl || '/admin/setup.html';
        }, 300);
      } catch (err) {
        if (failure) failure.hidden = false;
      } finally {
        setSubmitting(false);
      }
    });
  }
}());
