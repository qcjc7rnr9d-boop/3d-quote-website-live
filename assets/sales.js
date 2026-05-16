(function () {
  'use strict';

  const nav = document.getElementById('site-nav');
  const navToggle = document.querySelector('.nav-toggle');
  const demoForm = document.getElementById('demo-form');
  const success = document.getElementById('demo-success');

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

  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', event => {
      const targetId = link.getAttribute('href');
      if (!targetId || targetId === '#') return;
      const target = document.querySelector(targetId);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      closeNav();
    });
  });

  function emailLooksValid(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
  }

  function setError(field, message) {
    const input = document.getElementById(`demo-${field}`);
    const error = demoForm.querySelector(`[data-field-error="${field}"]`);
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (error) error.textContent = message || '';
  }

  function fieldValue(field) {
    const input = document.getElementById(`demo-${field}`);
    return input ? input.value.trim() : '';
  }

  function validateDemoForm() {
    const errors = {};
    if (!fieldValue('name')) errors.name = 'Enter your name.';
    if (!fieldValue('email')) {
      errors.email = 'Enter your work email.';
    } else if (!emailLooksValid(fieldValue('email'))) {
      errors.email = 'Enter a valid work email.';
    }
    if (!fieldValue('company')) errors.company = 'Enter your company name.';
    if (!fieldValue('volume')) errors.volume = 'Select a monthly quote range.';
    if (!fieldValue('message')) errors.message = 'Tell us what Trennen should help with.';

    ['name', 'email', 'company', 'volume', 'message'].forEach(field => {
      setError(field, errors[field] || '');
    });

    return errors;
  }

  if (demoForm) {
    demoForm.addEventListener('input', event => {
      const field = event.target.id ? event.target.id.replace('demo-', '') : '';
      if (!field) return;
      setError(field, '');
      if (success) success.hidden = true;
    });

    demoForm.addEventListener('change', event => {
      const field = event.target.id ? event.target.id.replace('demo-', '') : '';
      if (!field) return;
      setError(field, '');
      if (success) success.hidden = true;
    });

    demoForm.addEventListener('submit', event => {
      event.preventDefault();
      if (success) success.hidden = true;

      const errors = validateDemoForm();
      const firstError = Object.keys(errors)[0];
      if (firstError) {
        const input = document.getElementById(`demo-${firstError}`);
        if (input) input.focus({ preventScroll: false });
        return;
      }

      demoForm.reset();
      ['name', 'email', 'company', 'volume', 'message'].forEach(field => setError(field, ''));
      if (success) success.hidden = false;
    });
  }
})();
