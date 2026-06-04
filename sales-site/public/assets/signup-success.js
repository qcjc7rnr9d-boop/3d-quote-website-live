(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id') || '';
  const success = document.getElementById('signup-success-status');
  const failure = document.getElementById('signup-failure-status');
  const copy = document.querySelector('[data-signup-success-copy]');
  const retryButton = document.querySelector('[data-retry-sales-confirmation]');

  function showFailure(message) {
    if (failure) {
      failure.textContent = message || 'We could not finish confirmation yet. Try again or contact hello@trennen.co.nz.';
      failure.hidden = false;
    }
    if (success) success.hidden = true;
    if (retryButton) retryButton.hidden = false;
  }

  async function completeSignup() {
    if (!sessionId) {
      showFailure('Stripe session id is missing. Contact hello@trennen.co.nz and we will help.');
      return;
    }

    if (retryButton) retryButton.hidden = true;

    try {
      const res = await fetch('/api/onboarding/sales-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, salesSignup: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not confirm signup.');

      const message = data.message || 'Stripe confirmed your trial. Check your email for the setup link.';
      if (copy) copy.textContent = message;
      if (success) {
        success.textContent = message;
        success.hidden = false;
      }
      if (failure) failure.hidden = true;
    } catch (error) {
      showFailure(error.message);
    }
  }

  if (retryButton) retryButton.addEventListener('click', completeSignup);
  completeSignup();
})();
