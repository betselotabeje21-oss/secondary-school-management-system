document.addEventListener('DOMContentLoaded', function () {
  const toggle = document.querySelector('.nav-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      document.querySelector('.app-shell').classList.toggle('nav-open');
    });
  }

  const passwordToggle = document.querySelector('.password-toggle');
  const passwordInput = document.querySelector('input[name="password"]');
  if (passwordToggle && passwordInput) {
    passwordToggle.addEventListener('click', function () {
      const shouldShow = passwordInput.type === 'password';
      passwordInput.type = shouldShow ? 'text' : 'password';
      passwordToggle.setAttribute('aria-label', shouldShow ? 'Hide password' : 'Show password');
      passwordToggle.setAttribute('aria-pressed', String(shouldShow));
    });
  }
});
