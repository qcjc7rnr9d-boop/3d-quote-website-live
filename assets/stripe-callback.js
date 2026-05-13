function showState(id) {
  document.querySelectorAll('.state').forEach(el => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showError(msg) {
  document.getElementById('errorMessage').textContent = msg || 'An unexpected error occurred.';
  showState('stateError');
}

function showSuccess() {
  showState('stateSuccess');
  setTimeout(() => {
    window.location.href = 'admin/payments.html';
  }, 2000);
}

const params = new URLSearchParams(window.location.search);
const error = params.get('error');

if (error) {
  showError(params.get('error_description') || 'Connection was denied.');
} else {
  fetch('/api/stripe/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showSuccess();
        return;
      }
      showError(data.error || 'Connection failed. Please try again.');
    })
    .catch(() => showError('Network error. Please try again.'));
}
