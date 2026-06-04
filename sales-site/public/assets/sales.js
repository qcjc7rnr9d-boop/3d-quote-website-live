(function () {
  'use strict';

  const header = document.querySelector('[data-site-header]');
  const nav = document.getElementById('site-nav');
  const navToggle = document.querySelector('.nav-toggle');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const story = document.querySelector('[data-story]');
  const storyStage = document.querySelector('.depth-stage');
  const storySteps = Array.from(document.querySelectorAll('.story-step'));
  const revealItems = Array.from(document.querySelectorAll('.reveal'));
  const demoForm = document.getElementById('demo-form');
  const demoModal = document.querySelector('[data-demo-modal]');
  const signupModal = document.querySelector('[data-signup-modal]');
  const signupForm = document.getElementById('sales-signup-form');
  const signupSuccess = document.getElementById('signup-success');
  const signupFailure = document.getElementById('signup-failure');

  let storyTargetProgress = 0;
  let storyProgress = 0;
  let storyRaf = 0;
  let activeStoryStep = -1;
  let lastTrackedStoryStep = null;
  let selectedPlan = 'starter';
  let lastSignupTrigger = null;
  let lastDemoTrigger = null;

  const STORY_TIMELINE = Object.freeze([
    { step: 0, progress: 0 },
    { step: 1, progress: 0.2 },
    { step: 2, progress: 0.4 },
    { step: 3, progress: 0.6 },
    { step: 4, progress: 0.8 },
    { step: 4, progress: 1 },
  ]);

  const PLAN_COPY = {
    community: {
      label: 'Community',
      copy: 'For testing or very small shops.',
      price: 'NZ$0/month',
      quotes: '5 quotes/month',
      trial: 'No card required',
      checkout: 'Bank transfer only',
      noteTitle: 'No card required.',
      noteCopy: 'Create the shop now. Checkout stays bank-transfer only on Community.',
      button: 'Create free account',
    },
    starter: {
      label: 'Starter',
      copy: 'For small shops ready to quote faster.',
      price: 'NZ$29/month + GST',
      quotes: '25 quotes/month',
      trial: '14-day trial, card upfront',
      checkout: 'No Trennen checkout fee',
      noteTitle: 'Card required to start trial.',
      noteCopy: 'No charge until the trial ends. Stripe/card processing fees stay separate.',
      button: 'Continue to Stripe',
    },
    growth: {
      label: 'Growth',
      copy: 'For busier shops quoting every week.',
      price: 'NZ$129/month + GST',
      quotes: '250 quotes/month',
      trial: '14-day trial, card upfront',
      checkout: 'No Trennen checkout fee',
      noteTitle: 'Card required to start trial.',
      noteCopy: 'No charge until the trial ends. Stripe/card processing fees stay separate.',
      button: 'Continue to Stripe',
    },
    scale: {
      label: 'Scale',
      copy: 'For larger shops that need setup support.',
      price: 'NZ$899/month + GST',
      quotes: '1,000 quotes/month',
      trial: 'Manual setup',
      checkout: 'Terms confirmed with Trennen',
      noteTitle: 'Talk to us first.',
      noteCopy: 'Scale setup is reviewed manually before billing starts.',
      button: 'Send setup request',
    },
  };

  function trackEvent(name, details = {}) {
    if (!name) return;
    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: name, ...details });
    }
  }

  function initLiveSoftwareWidgetFallback() {
    const shell = document.querySelector('[data-live-software-widget-shell]');
    if (!shell) return;

    let delayedTimer = null;

    function hasWidgetSurface() {
      const widget = shell.querySelector('iframe, [data-trennen-widget], .trennen-widget, .trennen-quote-widget');
      return Boolean(widget && !widget.closest('[data-live-software-loader]'));
    }

    function markReady() {
      shell.dataset.widgetState = 'ready';
      shell.classList.add('is-widget-ready');
      shell.classList.remove('is-widget-delayed');
      if (delayedTimer) {
        window.clearTimeout(delayedTimer);
        delayedTimer = null;
      }
    }

    function markDelayed() {
      if (hasWidgetSurface()) {
        markReady();
        return;
      }
      shell.dataset.widgetState = 'delayed';
      shell.classList.add('is-widget-delayed');
    }

    if (hasWidgetSurface()) {
      markReady();
      return;
    }

    const observer = new MutationObserver(() => {
      if (hasWidgetSurface()) {
        markReady();
        observer.disconnect();
      }
    });
    observer.observe(shell, { childList: true, subtree: true });

    delayedTimer = window.setTimeout(markDelayed, 4500);
    window.addEventListener('load', () => {
      window.setTimeout(() => {
        if (hasWidgetSurface()) markReady();
      }, 250);
    }, { once: true });
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
      if (event.target.closest('a, button')) closeNav();
    });
  }

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
      storyStage.dataset.visualStep = String(safeIndex);
    }
    if (changed && emitAnalytics && safeIndex !== lastTrackedStoryStep) {
      lastTrackedStoryStep = safeIndex;
      trackEvent('demo_step_change', { step: String(safeIndex), source });
    }
  }

  function activeStepForProgress(progress) {
    if (progress >= 0.8) return 4;
    if (progress >= 0.6) return 3;
    if (progress >= 0.4) return 2;
    if (progress >= 0.2) return 1;
    return 0;
  }

  function interpolateStoryState(progress) {
    const clamped = Math.min(1, Math.max(0, progress));
    let from = STORY_TIMELINE[0];
    let to = STORY_TIMELINE[STORY_TIMELINE.length - 1];
    for (let i = 0; i < STORY_TIMELINE.length - 1; i += 1) {
      if (clamped >= STORY_TIMELINE[i].progress && clamped <= STORY_TIMELINE[i + 1].progress) {
        from = STORY_TIMELINE[i];
        to = STORY_TIMELINE[i + 1];
        break;
      }
    }
    return {
      step: activeStepForProgress(clamped),
      bandStart: from.progress,
      bandEnd: to.progress,
    };
  }

  function updateStoryVisual(progress, source = 'scroll', emitAnalytics = true) {
    if (!storyStage) return;
    const state = interpolateStoryState(progress);
    setStoryStep(state.step, source, emitAnalytics);
  }

  function animateStory() {
    storyRaf = 0;
    storyProgress += (storyTargetProgress - storyProgress) * 0.16;
    if (Math.abs(storyTargetProgress - storyProgress) < 0.002) storyProgress = storyTargetProgress;
    updateStoryVisual(storyProgress, 'scroll', true);
    if (Math.abs(storyTargetProgress - storyProgress) >= 0.002) {
      storyRaf = window.requestAnimationFrame(animateStory);
    }
  }

  function requestStoryFrame() {
    if (!storyRaf) storyRaf = window.requestAnimationFrame(animateStory);
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

  function normalizePlan(value) {
    const plan = String(value || '').trim().toLowerCase();
    return PLAN_COPY[plan] ? plan : 'starter';
  }

  function signupField(id) {
    return document.getElementById(`signup-${id}`);
  }

  function signupValue(id) {
    const input = signupField(id);
    return input ? input.value.trim() : '';
  }

  function setSignupError(id, message) {
    const input = signupField(id === 'monthlyQuoteVolume' ? 'volume' : id);
    const error = signupForm ? signupForm.querySelector(`[data-signup-error="${id}"]`) : null;
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (error) error.textContent = message || '';
  }

  function clearSignupErrors() {
    ['name', 'email', 'company', 'shopSlug', 'password', 'monthlyQuoteVolume', 'message', 'acceptTerms'].forEach(id => setSignupError(id, ''));
  }

  function emailLooksValid(value) {
    const email = String(value || '').trim();
    return email.length <= 254 && !email.includes('..') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function setSignupPlan(planId) {
    selectedPlan = normalizePlan(planId);
    const plan = PLAN_COPY[selectedPlan];
    const planField = signupField('plan');
    if (planField) planField.value = selectedPlan;
    document.querySelector('[data-signup-plan-title]').textContent = plan.label;
    document.querySelector('[data-signup-plan-copy]').textContent = plan.copy;
    document.querySelector('[data-signup-price]').textContent = plan.price;
    document.querySelector('[data-signup-quotes]').textContent = plan.quotes;
    document.querySelector('[data-signup-trial]').textContent = plan.trial;
    document.querySelector('[data-signup-checkout]').textContent = plan.checkout;
    const note = document.querySelector('[data-signup-billing-note]');
    if (note) {
      note.querySelector('strong').textContent = plan.noteTitle;
      note.querySelector('span').textContent = plan.noteCopy;
    }
    const isScale = selectedPlan === 'scale';
    document.querySelectorAll('#sales-signup-form [data-self-serve-field]').forEach(node => {
      node.hidden = isScale;
      node.querySelectorAll('input').forEach(input => {
        input.required = !isScale;
      });
    });
    const submit = signupForm?.querySelector('.signup-submit');
    if (submit) submit.textContent = plan.button;
  }

  function modalFocusableElements(root) {
    if (!root || root.hidden) return [];
    return Array.from(root.querySelectorAll([
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(','))).filter(el => el.offsetParent !== null || el === document.activeElement);
  }

  function trapModalFocus(root, event) {
    if (!root || root.hidden || event.key !== 'Tab') return;
    const focusable = modalFocusableElements(root);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function updateModalOpenState() {
    const hasOpenModal = (signupModal && !signupModal.hidden) || (demoModal && !demoModal.hidden);
    document.body.classList.toggle('modal-open', Boolean(hasOpenModal));
  }

  function openSignup(planId, trigger = null) {
    if (!signupModal) return;
    lastSignupTrigger = trigger || lastSignupTrigger;
    setSignupPlan(planId);
    clearSignupErrors();
    if (signupSuccess) signupSuccess.hidden = true;
    if (signupFailure) signupFailure.hidden = true;
    signupModal.hidden = false;
    updateModalOpenState();
    setTimeout(() => signupField('name')?.focus({ preventScroll: true }), 30);
  }

  function closeSignup() {
    if (!signupModal) return;
    if (signupModal.hidden) return;
    signupModal.hidden = true;
    updateModalOpenState();
    if (lastSignupTrigger && typeof lastSignupTrigger.focus === 'function') {
      lastSignupTrigger.focus({ preventScroll: true });
    }
  }

  function openDemoModal(trigger = null) {
    if (!demoModal) return;
    lastDemoTrigger = trigger || lastDemoTrigger;
    const success = document.getElementById('demo-success');
    const failure = document.getElementById('demo-failure');
    if (success) success.hidden = true;
    if (failure) failure.hidden = true;
    demoModal.hidden = false;
    updateModalOpenState();
    trackEvent('demo_modal_open');
    setTimeout(() => document.getElementById('demo-name')?.focus({ preventScroll: true }), 30);
  }

  function closeDemoModal() {
    if (!demoModal) return;
    if (demoModal.hidden) return;
    demoModal.hidden = true;
    updateModalOpenState();
    if (lastDemoTrigger && typeof lastDemoTrigger.focus === 'function') {
      lastDemoTrigger.focus({ preventScroll: true });
    }
  }

  function validateSignup() {
    const errors = {};
    const isScale = selectedPlan === 'scale';
    if (!signupValue('name')) errors.name = 'Enter your name.';
    if (!emailLooksValid(signupValue('email'))) errors.email = 'Enter a valid work email.';
    if (!signupValue('company')) errors.company = 'Enter your shop or company name.';
    if (!isScale && signupValue('shopSlug').length < 3) errors.shopSlug = 'Choose a shop URL with at least 3 characters.';
    if (!isScale && !signupValue('password')) errors.password = 'Create a password.';
    if (!signupValue('volume')) errors.monthlyQuoteVolume = 'Select a monthly quote range.';
    if (!signupValue('message')) errors.message = 'Tell us what Trennen should help with first.';
    if (signupField('acceptTerms')?.checked !== true) errors.acceptTerms = 'Accept the Trennen terms to continue.';
    ['name', 'email', 'company', 'shopSlug', 'password', 'monthlyQuoteVolume', 'message', 'acceptTerms'].forEach(id => setSignupError(id, errors[id] || ''));
    return errors;
  }

  function applySignupServerErrors(errors = {}) {
    const map = { volume: 'monthlyQuoteVolume' };
    Object.entries(errors).forEach(([field, message]) => {
      setSignupError(map[field] || field, message);
    });
  }

  function setSignupSubmitting(submitting) {
    const button = signupForm?.querySelector('.signup-submit');
    if (!button) return;
    button.disabled = submitting;
    button.textContent = submitting ? 'Working...' : PLAN_COPY[selectedPlan].button;
  }

  function signupPayload() {
    return {
      salesSignup: true,
      plan: selectedPlan,
      name: signupValue('name'),
      email: signupValue('email'),
      company: signupValue('company'),
      shopSlug: signupValue('shopSlug'),
      password: signupValue('password'),
      monthlyQuoteVolume: signupValue('volume'),
      message: signupValue('message'),
      acceptTerms: signupField('acceptTerms')?.checked === true,
      website: signupValue('website'),
      sourcePath: window.location.pathname,
      successUrl: `${window.location.origin}/signup-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${window.location.origin}/?signup=cancelled&plan=${encodeURIComponent(selectedPlan)}`,
    };
  }

  document.querySelectorAll('[data-plan-select]').forEach(button => {
    button.addEventListener('click', () => {
      const plan = normalizePlan(button.dataset.planSelect);
      trackEvent(button.dataset.event || 'pricing_plan_click', { plan });
      if (button.dataset.pricingPlan) trackEvent('pricing_plan_click', { plan });
      closeNav();
      openSignup(plan, button);
    });
  });

  document.querySelectorAll('[data-signup-close]').forEach(button => {
    button.addEventListener('click', closeSignup);
  });

  document.querySelectorAll('[data-demo-open]').forEach(button => {
    button.addEventListener('click', () => {
      closeNav();
      openDemoModal(button);
    });
  });

  document.querySelectorAll('[data-demo-close]').forEach(button => {
    button.addEventListener('click', closeDemoModal);
  });

  if (signupForm) {
    signupForm.addEventListener('input', event => {
      const id = event.target.id ? event.target.id.replace('signup-', '') : '';
      if (!id || id === 'website') return;
      setSignupError(id === 'volume' ? 'monthlyQuoteVolume' : id, '');
      if (signupSuccess) signupSuccess.hidden = true;
      if (signupFailure) signupFailure.hidden = true;
    });

    signupForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (signupSuccess) signupSuccess.hidden = true;
      if (signupFailure) signupFailure.hidden = true;
      const errors = validateSignup();
      const firstError = Object.keys(errors)[0];
      if (firstError) {
        const fieldId = firstError === 'monthlyQuoteVolume' ? 'volume' : firstError;
        signupField(fieldId)?.focus({ preventScroll: false });
        return;
      }

      setSignupSubmitting(true);
      try {
        const payload = signupPayload();
        const res = await fetch('/api/onboarding/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = res.status === 204 ? { ok: true } : await res.json().catch(() => ({}));
        if (!res.ok && res.status !== 204) {
          if (data.errors) applySignupServerErrors(data.errors);
          throw new Error(data.error || 'Could not start signup.');
        }
        if (data.redirectUrl) {
          window.location.assign(data.redirectUrl);
          return;
        }
        if (signupSuccess) {
          signupSuccess.textContent = data.message || (selectedPlan === 'scale'
            ? 'We received your setup request.'
            : 'Your account is ready. Check your email for the setup link.');
          signupSuccess.hidden = false;
        }
        signupForm.reset();
        setSignupPlan(selectedPlan);
      } catch (err) {
        if (signupFailure) {
          signupFailure.textContent = err.message || 'Something went wrong. Check the fields and try again.';
          signupFailure.hidden = false;
        }
      } finally {
        setSignupSubmitting(false);
      }
    });
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link) return;
    const eventName = link.dataset.event;
    if (eventName) trackEvent(eventName, { href: link.href });
  });

  document.addEventListener('keydown', event => {
    trapModalFocus(signupModal, event);
    trapModalFocus(demoModal, event);
    if (event.key === 'Escape') {
      closeNav();
      closeSignup();
      closeDemoModal();
    }
  });

  document.querySelectorAll('.faq-question').forEach(button => {
    button.addEventListener('click', () => {
      const item = button.closest('.faq-item');
      const open = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!open));
      item.classList.toggle('is-open', !open);
      if (!open) trackEvent('faq_open', { question: button.textContent.trim() });
    });
  });

  function setDemoError(field, message) {
    const input = document.getElementById(`demo-${field}`);
    const error = demoForm ? demoForm.querySelector(`[data-field-error="${field}"]`) : null;
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (error) error.textContent = message || '';
  }

  function demoValue(field) {
    const input = document.getElementById(`demo-${field}`);
    return input ? input.value.trim() : '';
  }

  function validateDemoForm() {
    const errors = {};
    if (!demoValue('name')) errors.name = 'Enter your name.';
    if (!demoValue('email')) errors.email = 'Enter your work email.';
    else if (!emailLooksValid(demoValue('email'))) errors.email = 'Enter a valid work email.';
    if (!demoValue('company')) errors.company = 'Enter your company name.';
    if (!demoValue('volume')) errors.volume = 'Select a monthly quote range.';
    if (!demoValue('message')) errors.message = 'Tell us what Trennen should help with.';
    ['name', 'email', 'company', 'volume', 'message'].forEach(field => setDemoError(field, errors[field] || ''));
    return errors;
  }

  function applyDemoServerErrors(errors) {
    const map = { monthlyQuoteVolume: 'volume' };
    Object.entries(errors || {}).forEach(([field, message]) => setDemoError(map[field] || field, message));
  }

  function setDemoSubmitting(submitting) {
    const button = demoForm ? demoForm.querySelector('button[type="submit"]') : null;
    if (!button) return;
    button.disabled = submitting;
    button.textContent = submitting ? 'Sending request...' : 'Request a walkthrough';
  }

  if (demoForm) {
    const success = document.getElementById('demo-success');
    const failure = document.getElementById('demo-failure');
    const defaultSuccess = success ? success.textContent : '';
    demoForm.addEventListener('input', event => {
      const field = event.target.id ? event.target.id.replace('demo-', '') : '';
      if (!field || field === 'website') return;
      setDemoError(field, '');
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
        document.getElementById(`demo-${firstError}`)?.focus({ preventScroll: false });
        return;
      }
      setDemoSubmitting(true);
      try {
        const res = await fetch('/api/sales/demo-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: demoValue('name'),
            email: demoValue('email'),
            company: demoValue('company'),
            monthlyQuoteVolume: demoValue('volume'),
            message: demoValue('message'),
            website: demoValue('website'),
            sourcePath: window.location.pathname,
          }),
        });
        const data = res.status === 204 ? { ok: true } : await res.json().catch(() => ({}));
        if (!res.ok && res.status !== 204) {
          if (data.errors) applyDemoServerErrors(data.errors);
          throw new Error(data.error || 'Demo request failed');
        }
        demoForm.reset();
        ['name', 'email', 'company', 'volume', 'message'].forEach(field => setDemoError(field, ''));
        if (success) {
          success.textContent = defaultSuccess;
          success.hidden = false;
        }
      } catch (err) {
        if (failure) failure.hidden = false;
      } finally {
        setDemoSubmitting(false);
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

  const params = new URLSearchParams(window.location.search);
  const cancelledPlan = normalizePlan(params.get('plan'));
  if (params.get('signup') === 'cancelled') {
    openSignup(cancelledPlan);
    if (signupFailure) {
      signupFailure.textContent = 'Stripe Checkout was cancelled. You can continue signup whenever you are ready.';
      signupFailure.hidden = false;
    }
  }

  updateHeader();
  initLiveSoftwareWidgetFallback();
  updateStoryVisual(0, 'init', false);
  setStoryStep(0, 'init', false);
})();
