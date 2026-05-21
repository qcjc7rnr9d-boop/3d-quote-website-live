(function () {
  'use strict';

  const nav = document.getElementById('signupNav');
  const navToggle = document.getElementById('signupNavToggle');
  const form = document.getElementById('onboarding-form');
  const success = document.getElementById('onboarding-success');
  const failure = document.getElementById('onboarding-failure');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

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

  function field(id) {
    return document.getElementById(`onboarding-${id}`);
  }

  function value(id) {
    const el = field(id);
    return el ? el.value.trim() : '';
  }

  function setError(id, message) {
    const inputId = id === 'monthlyQuoteVolume' ? 'volume' : id;
    const input = field(inputId);
    const errorId = id === 'monthlyQuoteVolume' ? 'volume' : id;
    const error = form ? form.querySelector(`[data-field-error="${errorId}"]`) : null;
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (error) error.textContent = message || '';
  }

  function validate() {
    const errors = {};
    if (!value('name')) errors.name = 'Enter your name.';
    if (!value('email')) {
      errors.email = 'Enter your work email.';
    } else if (!emailLooksValid(value('email'))) {
      errors.email = 'Enter a valid work email.';
    }
    if (!value('company')) errors.company = 'Enter your shop or company name.';
    if (!value('volume')) errors.monthlyQuoteVolume = 'Select a monthly quote range.';
    if (!value('message')) errors.message = 'Tell us what you want help with first.';

    setError('name', errors.name);
    setError('email', errors.email);
    setError('company', errors.company);
    setError('monthlyQuoteVolume', errors.monthlyQuoteVolume);
    setError('message', errors.message);
    return errors;
  }

  function setSubmitting(submitting) {
    const button = form ? form.querySelector('button[type="submit"]') : null;
    if (!button) return;
    button.disabled = submitting;
    button.textContent = submitting ? 'Sending...' : 'Start setup';
  }

  function applyServerErrors(errors) {
    const fieldMap = {
      monthlyQuoteVolume: 'monthlyQuoteVolume',
    };
    Object.entries(errors || {}).forEach(([key, message]) => {
      setError(fieldMap[key] || key, message);
    });
  }

  document.querySelectorAll('[data-plan-select]').forEach(button => {
    button.addEventListener('click', () => {
      const selected = button.dataset.planSelect || 'Community';
      const plan = field('plan');
      if (plan) plan.value = selected;
      document.querySelectorAll('[data-plan-card]').forEach(card => {
        card.classList.toggle('is-selected', card.dataset.planCard === selected.toLowerCase());
      });
      const setup = document.getElementById('shop-setup');
      if (setup) setup.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
      trackEvent('onboarding_plan_select', { plan: selected });
    });
  });

  if (form) {
    form.addEventListener('input', event => {
      const id = event.target.id ? event.target.id.replace('onboarding-', '') : '';
      if (!id || id === 'website') return;
      setError(id === 'volume' ? 'monthlyQuoteVolume' : id, '');
      if (success) success.hidden = true;
      if (failure) failure.hidden = true;
    });

    form.addEventListener('change', event => {
      const id = event.target.id ? event.target.id.replace('onboarding-', '') : '';
      if (!id || id === 'website') return;
      setError(id === 'volume' ? 'monthlyQuoteVolume' : id, '');
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
        const input = field(firstError === 'monthlyQuoteVolume' ? 'volume' : firstError);
        if (input) input.focus({ preventScroll: false });
        return;
      }

      const plan = value('plan') || 'Community';
      const paymentPath = value('payment') || 'Bank transfer first';
      const notes = value('message');
      const payload = {
        name: value('name'),
        email: value('email'),
        company: value('company'),
        monthlyQuoteVolume: value('volume'),
        message: [
          'Start free onboarding request.',
          `Plan: ${plan}.`,
          `Payment path: ${paymentPath}.`,
          `Notes: ${notes}`,
        ].join(' '),
        website: value('website'),
        sourcePath: window.location.pathname,
      };

      setSubmitting(true);
      try {
        const res = await fetch('/api/sales/demo-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = res.status === 204 ? { ok: true } : await res.json().catch(() => ({}));
        if (!res.ok && res.status !== 204) {
          if (data.errors) applyServerErrors(data.errors);
          throw new Error(data.error || 'Onboarding request failed');
        }
        form.reset();
        const planField = field('plan');
        const paymentField = field('payment');
        if (planField) planField.value = plan;
        if (paymentField) paymentField.value = paymentPath;
        setError('name', '');
        setError('email', '');
        setError('company', '');
        setError('monthlyQuoteVolume', '');
        setError('message', '');
        if (success) success.hidden = false;
        trackEvent('onboarding_submit', { plan, paymentPath });
      } catch (err) {
        if (failure) failure.hidden = false;
      } finally {
        setSubmitting(false);
      }
    });
  }
}());
