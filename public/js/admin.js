const API = '/api/admin';
const app = document.getElementById('app');

const state = {
  token: localStorage.getItem('hairsprit_admin_token') || null,
  username: localStorage.getItem('hairsprit_admin_user') || null,
  tab: 'scanner',
  error: null,
  loading: false,
  scannedClient: null,
  scannerActive: false,
  html5QrCode: null,
  clients: [],
  clientSearch: '',
  rewards: [],
  bookings: [],
  stats: null,
};

function saveSession(token, username) {
  state.token = token;
  state.username = username;
  localStorage.setItem('hairsprit_admin_token', token);
  localStorage.setItem('hairsprit_admin_user', username);
}
function clearSession() {
  state.token = null;
  state.username = null;
  localStorage.removeItem('hairsprit_admin_token');
  localStorage.removeItem('hairsprit_admin_user');
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(API + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Une erreur est survenue.');
  return data;
}

function formatDate(iso) {
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* ---------------- INIT ---------------- */
function init() {
  if (state.token) {
    renderShell();
  } else {
    renderLogin();
  }
}

/* ---------------- LOGIN ---------------- */
function renderLogin() {
  app.innerHTML = `
    <div class="screen" style="max-width:400px;margin:0 auto;">
      <div class="hero-auth">
        <img src="/logo.jpg" alt="Hairsprit" class="hero-logo" />
        <p>Espace barber</p>
      </div>
      ${state.error ? `<div class="error-msg">${state.error}</div>` : ''}
      <form id="login-form" style="margin-top:26px;">
        <div class="field">
          <label for="username">Identifiant</label>
          <input id="username" name="username" required autocomplete="username" />
        </div>
        <div class="field">
          <label for="password">Mot de passe</label>
          <input id="password" name="password" type="password" required autocomplete="current-password" />
        </div>
        <button class="btn btn-primary" type="submit">${state.loading ? '...' : 'Se connecter'}</button>
      </form>
