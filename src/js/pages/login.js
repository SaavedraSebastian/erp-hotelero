import { getRef, h, icon, mount, parseHtmlTemplate } from '../utils/dom.js';
import { erpStore } from '../core/store.js';
import loginHtml from '../../html/pages/login.html?raw';

const loginUi = {
  email: '',
  password: '',
  showPassword: false,
  submitting: false,
  error: null,
};

export function renderLoginPage() {
  const root = parseHtmlTemplate(loginHtml);

  const mobileBrandIcon = getRef(root, 'mobile-brand-icon');
  const asideBrandIcon = getRef(root, 'aside-brand-icon');
  const emailIcon = getRef(root, 'email-icon');
  const lockIcon = getRef(root, 'lock-icon');
  const shieldIcon = getRef(root, 'shield-icon');
  const emailInput = getRef(root, 'email-input');
  const passwordInput = getRef(root, 'password-input');
  const pwdToggleBtn = getRef(root, 'pwd-toggle');
  const errorBox = getRef(root, 'error-box');
  const submitBtn = getRef(root, 'submit-btn');
  const submitLabel = getRef(root, 'submit-label');
  const form = getRef(root, 'login-form');

  if (mobileBrandIcon) mount(mobileBrandIcon, icon('building', 'w-4'));
  if (asideBrandIcon) mount(asideBrandIcon, icon('building', 'w-5'));
  if (emailIcon) mount(emailIcon, icon('mail', 'login-input-icon'));
  if (lockIcon) mount(lockIcon, icon('lock', 'login-input-icon'));
  if (shieldIcon) mount(shieldIcon, icon('shieldCheck', 'w-3.5 text-teal'));

  if (emailInput) {
    emailInput.value = loginUi.email;
    emailInput.addEventListener('input', (e) => {
      loginUi.email = e.target.value;
    });
  }

  if (passwordInput) {
    passwordInput.type = loginUi.showPassword ? 'text' : 'password';
    passwordInput.value = loginUi.password;
    passwordInput.addEventListener('input', (e) => {
      loginUi.password = e.target.value;
    });
  }

  function renderError() {
    if (!errorBox) return;
    if (!loginUi.error) {
      errorBox.replaceChildren();
      return;
    }
    mount(
      errorBox,
      h(
        'div',
        { className: 'alert alert-danger', role: 'alert' },
        icon('alertCircle', 'w-4 shrink-0'),
        h('span', null, loginUi.error)
      )
    );
  }

  function syncPwdToggle() {
    if (!pwdToggleBtn) return;
    pwdToggleBtn.setAttribute('aria-label', loginUi.showPassword ? 'Ocultar contraseña' : 'Ver contraseña');
    mount(pwdToggleBtn, icon(loginUi.showPassword ? 'eyeOff' : 'eye', 'w-4'));
  }

  if (pwdToggleBtn) {
    syncPwdToggle();
    pwdToggleBtn.addEventListener('click', () => {
      loginUi.showPassword = !loginUi.showPassword;
      if (passwordInput) passwordInput.type = loginUi.showPassword ? 'text' : 'password';
      syncPwdToggle();
    });
  }

  function setSubmitting(loading) {
    loginUi.submitting = loading;
    if (submitBtn) submitBtn.disabled = loading;
    if (submitLabel) {
      mount(
        submitLabel,
        loading ? icon('loader', 'w-4 spin') : null,
        h('span', null, loading ? 'Verificando acceso...' : 'Iniciar sesión'),
        loading ? null : icon('arrowRight', 'w-4')
      );
    }
  }

  setSubmitting(false);
  renderError();

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      loginUi.error = null;
      renderError();
      setSubmitting(true);
      const result = await erpStore.login(loginUi.email, loginUi.password);
      if (!result.ok) {
        loginUi.error = result.error || 'Credenciales inválidas.';
        renderError();
        setSubmitting(false);
      } else {
        loginUi.password = '';
      }
    });
  }

  return root;
}
