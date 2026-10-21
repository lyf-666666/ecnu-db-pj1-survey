const params = new URLSearchParams(location.search);
const redirectTarget = (() => {
  const next = params.get('next');
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  return '/dashboard.html';
})();

const msg = document.getElementById('msg');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');

function switchTab(register) {
  tabLogin.classList.toggle('active', !register);
  tabRegister.classList.toggle('active', register);
  loginForm.hidden = register;
  registerForm.hidden = !register;
  msg.textContent = '';
}

tabLogin.addEventListener('click', () => switchTab(false));
tabRegister.addEventListener('click', () => switchTab(true));

api('/api/auth/me')
  .then(() => { location.href = redirectTarget; })
  .catch(() => {});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(loginForm);
  msg.textContent = '';
  try {
    await api('/api/auth/login', {
      method: 'POST',
      body: { username: form.get('username'), password: form.get('password') }
    });
    location.href = redirectTarget;
  } catch (err) {
    msg.className = 'error';
    msg.textContent = err.message;
  }
});

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(registerForm);
  if (form.get('password') !== form.get('confirm')) {
    msg.className = 'error';
    msg.textContent = '两次输入的密码不一致';
    return;
  }
  msg.textContent = '';
  try {
    await api('/api/auth/register', {
      method: 'POST',
      body: { username: form.get('username'), password: form.get('password') }
    });
    location.href = redirectTarget;
  } catch (err) {
    msg.className = 'error';
    msg.textContent = err.message;
  }
});
