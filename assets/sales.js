(function () {
  'use strict';

  const header = document.querySelector('[data-site-header]');
  const nav = document.getElementById('site-nav');
  const navToggle = document.querySelector('.nav-toggle');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const story = document.querySelector('[data-story]');
  const storyStage = document.querySelector('.depth-stage');
  const storyFilm = document.querySelector('.story-film');
  const storySteps = Array.from(document.querySelectorAll('.story-step'));
  const revealItems = Array.from(document.querySelectorAll('.reveal'));
  const demoForm = document.getElementById('demo-form');
  const success = document.getElementById('demo-success');
  const failure = document.getElementById('demo-failure');

  let storyTargetProgress = 0;
  let storyProgress = 0;
  let storyRaf = 0;
  let activeStoryStep = -1;
  let lastTrackedStoryStep = null;

  const demoStates = {
    request: {
      kicker: 'Customer request',
      title: 'Everything the shop needs, captured once.',
      body: 'Files, material intent, quantity, deadline notes, and customer context land in one structured request instead of a scattered inbox thread.',
      metric: 'Cleaner intake',
      note: 'Customers get a simple path. Operators get the details they need.',
    },
    quote: {
      kicker: 'Pricing control',
      title: 'Your rules shape the estimate before the buyer sees it.',
      body: 'Materials, minimums, quantities, and shop logic stay under your control so the quote feels professional without becoming spreadsheet work.',
      metric: 'Faster replies',
      note: 'The shop keeps judgement. The product removes the busywork.',
    },
    approve: {
      kicker: 'Customer quote',
      title: 'The buyer sees scope, price, and next steps in one place.',
      body: 'A composed quote summary gives serious customers enough clarity to approve without another long back-and-forth.',
      metric: 'Clear approval',
      note: 'The moment feels polished because the work behind it is organized.',
    },
    pay: {
      kicker: 'Transparent checkout',
      title: 'Payment can help close work without fee fog.',
      body: 'Processing fees stay separate, checkout fees are capped, and bank transfer can remain available when it suits your workflow.',
      metric: 'Capped fees',
      note: 'Growth should not become an uncapped tax on successful jobs.',
    },
    track: {
      kicker: 'Operator tracking',
      title: 'Approved work stays connected after the quote is accepted.',
      body: 'Orders, customers, status, and payment context remain visible so the quote flow becomes part of the shop workflow.',
      metric: 'Calmer operations',
      note: 'The desk feels less noisy because the job has a home.',
    },
  };

  function trackEvent(name, details = {}) {
    if (!name) return;
    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: name, ...details });
    }
  }

  function closeNav() {
    if (!nav || !navToggle) return;
    nav.classList.remove('is-open');
    document.body.classList.remove('nav-open');
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', 'Open navigation');
  }

  function updateHeader() {
    if (!header) return;
    header.classList.toggle('is-scrolled', window.scrollY > 20);
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
      target.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
      closeNav();
    });
  });

  document.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (link) {
      const eventName = link.dataset.event;
      if (eventName) trackEvent(eventName, { href: link.href });
      if (link.dataset.pricingPlan) {
        trackEvent('pricing_plan_click', { plan: link.dataset.pricingPlan });
      }
    }

    const demoTab = event.target.closest('[data-demo-tab]');
    if (demoTab) {
      setDemoState(demoTab.dataset.demoTab, true);
    }
  });

  function setStoryStep(index, source = 'scroll', emitAnalytics = true) {
    if (!storySteps.length) return;
    const safeIndex = Math.min(storySteps.length - 1, Math.max(0, index));
    const changed = safeIndex !== activeStoryStep;
    activeStoryStep = safeIndex;
    storySteps.forEach((step, stepIndex) => {
      step.classList.toggle('is-active', stepIndex === safeIndex);
      step.setAttribute('aria-current', stepIndex === safeIndex ? 'step' : 'false');
    });
    if (storyStage) {
      storyStage.dataset.activeStep = String(safeIndex);
    }
    if (changed && emitAnalytics && safeIndex !== lastTrackedStoryStep) {
      lastTrackedStoryStep = safeIndex;
      trackEvent('demo_step_change', { step: storySteps[safeIndex]?.dataset.step || String(safeIndex), source });
    }
  }

  function updateStoryVisual(progress, source = 'scroll', emitAnalytics = true) {
    if (!storyStage) return;
    const clamped = Math.min(1, Math.max(0, progress));
    const pricingOpacity = Math.min(1, Math.max(0, (clamped - 0.18) / 0.24));
    const adminOpacity = Math.min(1, Math.max(0, (clamped - 0.48) / 0.24));
    const quoteOpacity = Math.max(0.22, 1 - Math.max(0, (clamped - 0.62) / 0.34));
    const focusDepth = Math.sin(clamped * Math.PI) * 1.4;

    storyStage.style.setProperty('--focus-depth', String(focusDepth.toFixed(3)));
    storyStage.style.setProperty('--quote-shift', `${(-4 * clamped).toFixed(2)}%`);
    storyStage.style.setProperty('--pricing-shift', `${(3.2 * (1 - pricingOpacity)).toFixed(2)}%`);
    storyStage.style.setProperty('--admin-shift', `${(-3.6 * (1 - adminOpacity)).toFixed(2)}%`);
    storyStage.style.setProperty('--pricing-opacity', String(pricingOpacity.toFixed(3)));
    storyStage.style.setProperty('--admin-opacity', String(adminOpacity.toFixed(3)));
    storyStage.style.setProperty('--quote-opacity', String(quoteOpacity.toFixed(3)));

    if (storyFilm && storyFilm.duration && Number.isFinite(storyFilm.duration) && !reduceMotion.matches) {
      const target = Math.max(0, Math.min(storyFilm.duration - 0.05, clamped * storyFilm.duration));
      if (Math.abs(storyFilm.currentTime - target) > 0.045) {
        storyFilm.currentTime = target;
      }
    }

    const step = Math.min(storySteps.length - 1, Math.max(0, Math.round(clamped * (storySteps.length - 1))));
    setStoryStep(step, source, emitAnalytics);
  }

  function animateStory() {
    storyRaf = 0;
    storyProgress += (storyTargetProgress - storyProgress) * 0.16;
    if (Math.abs(storyTargetProgress - storyProgress) < 0.002) {
      storyProgress = storyTargetProgress;
    }
    updateStoryVisual(storyProgress, 'scroll', true);
    if (Math.abs(storyTargetProgress - storyProgress) >= 0.002) {
      storyRaf = window.requestAnimationFrame(animateStory);
    }
  }

  function requestStoryFrame() {
    if (!storyRaf) {
      storyRaf = window.requestAnimationFrame(animateStory);
    }
  }

  function updateStoryFromScroll() {
    if (!story || reduceMotion.matches || window.innerWidth < 861) return;
    const rect = story.getBoundingClientRect();
    const scrollable = Math.max(1, rect.height - window.innerHeight);
    storyTargetProgress = Math.min(1, Math.max(0, -rect.top / scrollable));
    requestStoryFrame();
  }

  storySteps.forEach(step => {
    step.addEventListener('click', () => {
      const index = Number(step.dataset.step || 0);
      storyTargetProgress = Math.min(1, Math.max(0, index / Math.max(1, storySteps.length - 1)));
      if (reduceMotion.matches || window.innerWidth < 861) {
        storyProgress = storyTargetProgress;
        updateStoryVisual(storyProgress, 'button', true);
      } else {
        requestStoryFrame();
      }
      setStoryStep(index, 'button', true);
    });
  });

  function setDemoState(key, emitAnalytics = true) {
    const state = demoStates[key] || demoStates.request;
    const screen = document.querySelector('[data-demo-screen]');
    if (!screen) return;
    screen.dataset.state = key;
    document.querySelector('[data-demo-kicker]').textContent = state.kicker;
    document.querySelector('[data-demo-title]').textContent = state.title;
    document.querySelector('[data-demo-body]').textContent = state.body;
    document.querySelector('[data-demo-metric]').textContent = state.metric;
    document.querySelector('[data-demo-note]').textContent = state.note;
    document.querySelectorAll('[data-demo-tab]').forEach(tab => {
      tab.setAttribute('aria-selected', String(tab.dataset.demoTab === key));
    });
    if (emitAnalytics) {
      trackEvent('demo_step_change', { step: key, source: 'tab' });
    }
  }

  document.querySelectorAll('.faq-question').forEach(button => {
    button.addEventListener('click', () => {
      const item = button.closest('.faq-item');
      const open = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!open));
      item.classList.toggle('is-open', !open);
      if (!open) trackEvent('faq_open', { question: button.textContent.trim() });
    });
  });

  function emailLooksValid(value) {
    const email = String(value || '').trim();
    return email.length <= 254 && !email.includes('..') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function setError(field, message) {
    const input = document.getElementById(`demo-${field}`);
    const error = demoForm ? demoForm.querySelector(`[data-field-error="${field}"]`) : null;
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

  function setSubmitting(submitting) {
    const button = demoForm ? demoForm.querySelector('button[type="submit"]') : null;
    if (!button) return;
    button.disabled = submitting;
    button.textContent = submitting ? 'Sending request...' : 'Request walkthrough';
  }

  function applyServerErrors(errors) {
    const map = {
      monthlyQuoteVolume: 'volume',
    };
    Object.entries(errors || {}).forEach(([field, message]) => {
      setError(map[field] || field, message);
    });
  }

  if (demoForm) {
    demoForm.addEventListener('input', event => {
      const field = event.target.id ? event.target.id.replace('demo-', '') : '';
      if (!field || field === 'website') return;
      setError(field, '');
      if (success) success.hidden = true;
      if (failure) failure.hidden = true;
    });

    demoForm.addEventListener('change', event => {
      const field = event.target.id ? event.target.id.replace('demo-', '') : '';
      if (!field || field === 'website') return;
      setError(field, '');
      if (success) success.hidden = true;
      if (failure) failure.hidden = true;
    });

    demoForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (success) success.hidden = true;
      if (failure) failure.hidden = true;

      const errors = validateDemoForm();
      const firstError = Object.keys(errors)[0];
      if (firstError) {
        const input = document.getElementById(`demo-${firstError}`);
        if (input) input.focus({ preventScroll: false });
        return;
      }

      const payload = {
        name: fieldValue('name'),
        email: fieldValue('email'),
        company: fieldValue('company'),
        monthlyQuoteVolume: fieldValue('volume'),
        message: fieldValue('message'),
        website: fieldValue('website'),
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
          throw new Error(data.error || 'Demo request failed');
        }
        demoForm.reset();
        ['name', 'email', 'company', 'volume', 'message'].forEach(field => setError(field, ''));
        if (success) success.hidden = false;
      } catch (err) {
        if (failure) failure.hidden = false;
      } finally {
        setSubmitting(false);
      }
    });
  }

  if ('IntersectionObserver' in window && !reduceMotion.matches) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.16 });
    revealItems.forEach(item => observer.observe(item));
  } else {
    revealItems.forEach(item => item.classList.add('is-visible'));
  }

  if (storyFilm && typeof storyFilm.pause === 'function') {
    storyFilm.pause();
    storyFilm.addEventListener('loadedmetadata', updateStoryFromScroll);
  }

  window.addEventListener('scroll', () => {
    updateHeader();
    updateStoryFromScroll();
  }, { passive: true });
  window.addEventListener('resize', updateStoryFromScroll, { passive: true });

  if (reduceMotion.addEventListener) {
    reduceMotion.addEventListener('change', () => {
      revealItems.forEach(item => item.classList.add('is-visible'));
      updateStoryFromScroll();
    });
  }

  updateHeader();
  updateStoryVisual(0, 'init', false);
  setStoryStep(0, 'init', false);
  setDemoState('request', false);
})();
