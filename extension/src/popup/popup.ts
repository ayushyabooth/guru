import { getValidToken, login, removeStoredToken } from '../shared/auth';

const statusEl = document.getElementById('status')!;
const loginSection = document.getElementById('login-section')!;
const connectedSection = document.getElementById('connected-section')!;
const loginForm = document.getElementById('login-form') as HTMLFormElement;
const loginError = document.getElementById('login-error')!;
const loginBtn = document.getElementById('login-btn') as HTMLButtonElement;
const logoutBtn = document.getElementById('logout-btn')!;

async function checkAuth() {
  const token = await getValidToken();
  if (token) {
    statusEl.textContent = 'Connected to Guru';
    statusEl.className = 'status connected';
    loginSection.style.display = 'none';
    connectedSection.style.display = 'block';
  } else {
    statusEl.textContent = 'Not signed in';
    statusEl.className = 'status disconnected';
    loginSection.style.display = 'block';
    connectedSection.style.display = 'none';
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.style.display = 'none';
  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in...';

  const email = (document.getElementById('email') as HTMLInputElement).value;
  const password = (document.getElementById('password') as HTMLInputElement).value;

  const token = await login(email, password);

  if (token) {
    await checkAuth();
  } else {
    loginError.textContent = 'Invalid email or password';
    loginError.style.display = 'block';
  }

  loginBtn.disabled = false;
  loginBtn.textContent = 'Sign In';
});

logoutBtn.addEventListener('click', async () => {
  await removeStoredToken();
  await checkAuth();
});

checkAuth();
