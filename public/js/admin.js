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
  let s = iso;
  if (typeof s === 'string' && s.includes(' ') && !s.includes('T')) {
    s = s.replace(' ', 'T') + 'Z';
  }
  const d = new Date(s);
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
    </div>
  `;
  document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    state.error = null;
    try {
      const res = await api('/login', {
        method: 'POST',
        body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }),
      });
      saveSession(res.token, res.username);
      renderShell();
    } catch (err) {
      state.error = err.message;
      renderLogin();
    }
  };
}

/* ---------------- SHELL / NAV ---------------- */
const TABS = [
  { id: 'scanner', label: 'Scanner' },
  { id: 'clients', label: 'Clients' },
  { id: 'rewards', label: 'Récompenses' },
  { id: 'bookings', label: 'Réservations' },
  { id: 'stats', label: 'Statistiques' },
];

function renderShell() {
  app.innerHTML = `
    <div class="topbar">
      <div class="brand">
        <img src="/logo.jpg" alt="Hairsprit" class="brand-logo" />
        <span class="tag">Espace barber · ${state.username}</span>
      </div>
      <button class="icon-btn" id="logout-btn" title="Déconnexion">⏻</button>
    </div>
    <div class="admin-layout">
      <div class="admin-nav">
        ${TABS.map(t => `<button data-tab="${t.id}" class="${state.tab === t.id ? 'active' : ''}">${t.label}</button>`).join('')}
      </div>
      <div class="admin-main" id="admin-main"></div>
    </div>
  `;
  document.getElementById('logout-btn').onclick = () => {
    stopScanner();
    clearSession();
    renderLogin();
  };
  document.querySelectorAll('.admin-nav button').forEach(btn => {
    btn.onclick = () => {
      if (state.tab === 'scanner' && btn.dataset.tab !== 'scanner') stopScanner();
      state.tab = btn.dataset.tab;
      renderShell();
    };
  });
  renderTabContent();
}

function renderTabContent() {
  const main = document.getElementById('admin-main');
  if (state.tab === 'scanner') return renderScannerTab(main);
  if (state.tab === 'clients') return renderClientsTab(main);
  if (state.tab === 'rewards') return renderRewardsTab(main);
  if (state.tab === 'bookings') return renderBookingsTab(main);
  if (state.tab === 'stats') return renderStatsTab(main);
}

/* ---------------- SCANNER TAB ---------------- */
function renderScannerTab(main) {
  main.innerHTML = `
    <div class="scanner-box">
      <div class="section-title" style="margin-top:0;">Scanner un client</div>
      <div id="qr-reader"></div>
      <div id="scan-error"></div>
      <button class="btn btn-outline" id="toggle-scan" style="margin-top:14px;">
        ${state.scannerActive ? 'Arrêter la caméra' : 'Activer la caméra'}
      </button>
      <div id="client-result-zone"></div>
    </div>
  `;
  document.getElementById('toggle-scan').onclick = () => {
    if (state.scannerActive) stopScanner();
    else startScanner();
  };
  if (state.scannedClient) renderScannedClient();
}

function startScanner() {
  state.scannedClient = null;
  const el = document.getElementById('qr-reader');
  if (!el) return;
  state.html5QrCode = new Html5Qrcode('qr-reader');
  state.html5QrCode.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: 240 },
    async (decodedText) => {
      await handleScanResult(decodedText);
    },
    () => { /* ignore per-frame scan errors */ }
  ).then(() => {
    state.scannerActive = true;
    const btn = document.getElementById('toggle-scan');
    if (btn) btn.textContent = 'Arrêter la caméra';
  }).catch((err) => {
    document.getElementById('scan-error').innerHTML = `<div class="error-msg">Impossible d'accéder à la caméra : ${err}</div>`;
  });
}

function stopScanner() {
  if (state.html5QrCode && state.scannerActive) {
    state.html5QrCode.stop().catch(() => {});
  }
  state.scannerActive = false;
}

async function handleScanResult(qrToken) {
  stopScanner();
  try {
    const res = await api(`/client-by-qr/${encodeURIComponent(qrToken)}`);
    state.scannedClient = res.client;
    renderTabContent();
  } catch (err) {
    document.getElementById('scan-error').innerHTML = `<div class="error-msg">${err.message}</div>`;
    renderTabContent();
  }
}

function renderScannedClient(justAdded, justReset) {
  const zone = document.getElementById('client-result-zone');
  const c = state.scannedClient;
  zone.innerHTML = `
    <div class="client-result">
      ${justAdded ? `<div class="success-msg">✓ Point ajouté avec succès !</div>` : ''}
      ${justReset ? `<div class="success-msg">✓ Points réinitialisés avec succès !</div>` : ''}
      <div class="name">${c.prenom} ${c.nom}</div>
      <div class="phone">${c.telephone}</div>
      <div class="points-line">${c.points} points</div>
      <button class="btn btn-primary" id="add-point-btn">+ Ajouter 1 point (prestation)</button>
      ${c.points >= 10 ? `
        <button class="btn btn-outline" id="reset-points-btn" style="margin-top:10px;">Réinitialiser les points (récompense utilisée)</button>
      ` : ''}
    </div>
  `;
  document.getElementById('add-point-btn').onclick = async () => {
    const btn = document.getElementById('add-point-btn');
    btn.disabled = true;
    btn.textContent = 'Ajout en cours...';
    try {
      const res = await api(`/client/${c.id}/point`, { method: 'POST', body: JSON.stringify({ points: 1 }) });
      state.scannedClient = res.client;
      renderScannedClient(true, false);
    } catch (err) {
      zone.innerHTML += `<div class="error-msg">${err.message}</div>`;
      btn.disabled = false;
      btn.textContent = '+ Ajouter 1 point (prestation)';
    }
  };
  const resetBtn = document.getElementById('reset-points-btn');
  if (resetBtn) {
    resetBtn.onclick = async () => {
      if (!confirm(`Confirmer la réinitialisation des points de ${c.prenom} ${c.nom} ?`)) return;
      resetBtn.disabled = true;
      resetBtn.textContent = '...';
      try {
        const res = await api(`/client/${c.id}/reset`, { method: 'POST' });
        state.scannedClient = res.client;
        renderScannedClient(false, true);
      } catch (err) {
        zone.innerHTML += `<div class="error-msg">${err.message}</div>`;
        resetBtn.disabled = false;
        resetBtn.textContent = 'Réinitialiser les points (récompense utilisée)';
      }
    };
  }
}

/* ---------------- CLIENTS TAB ---------------- */
async function renderClientsTab(main) {
  main.innerHTML = `<div class="loading-spin"></div>`;
  try {
    const res = await api(`/clients${state.clientSearch ? '?q=' + encodeURIComponent(state.clientSearch) : ''}`);
    state.clients = res.clients;
  } catch (e) {
    main.innerHTML = `<div class="error-msg">${e.message}</div>`;
    return;
  }
  main.innerHTML = `
    <div class="section-title" style="margin-top:0;">Liste des clients (${state.clients.length})</div>
    <div class="search-row">
      <input id="search-input" placeholder="Rechercher par nom ou téléphone..." value="${state.clientSearch}" />
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Client</th><th>Téléphone</th><th>Adresse</th><th>Points</th><th>Membre depuis</th></tr></thead>
        <tbody>
          ${state.clients.length === 0 ? `<tr><td colspan="5" style="text-align:center;color:var(--argent);">Aucun client trouvé.</td></tr>` : ''}
          ${state.clients.map(c => `
            <tr>
              <td>${c.prenom} ${c.nom}</td>
              <td>${c.telephone}</td>
              <td style="color:var(--argent);font-size:12.5px;">${c.address || '—'}</td>
              <td class="pts-cell">${c.points}</td>
              <td>${formatDate(c.created_at)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  const input = document.getElementById('search-input');
  let timeout;
  input.oninput = (e) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      state.clientSearch = e.target.value;
      renderClientsTab(main);
    }, 300);
  };
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

/* ---------------- REWARDS TAB ---------------- */
async function renderRewardsTab(main) {
  main.innerHTML = `<div class="loading-spin"></div>`;
  try {
    const res = await api('/rewards');
    state.rewards = res.rewards;
  } catch (e) {
    main.innerHTML = `<div class="error-msg">${e.message}</div>`;
    return;
  }
  main.innerHTML = `
    <div class="section-title" style="margin-top:0;">Récompenses</div>
    <div class="rewards-admin-grid" id="rewards-list"></div>
    <div class="section-title">Ajouter une récompense</div>
    <form id="new-reward-form">
      <div class="field"><label>Nom</label><input name="name" required placeholder="Ex : Coupe offerte" /></div>
      <div class="field"><label>Points requis</label><input name="points_required" type="number" min="1" required /></div>
      <div class="field"><label>Description</label><input name="description" placeholder="Détail de la récompense" /></div>
      <button class="btn btn-outline" type="submit">Ajouter</button>
    </form>
  `;
  const list = document.getElementById('rewards-list');
  list.innerHTML = state.rewards.map(r => `
    <div class="reward-admin-row" data-id="${r.id}">
      <div class="grow">
        <input class="edit-name" value="${r.name.replace(/"/g, '&quot;')}" style="width:100%;margin-bottom:6px;" />
        <input class="edit-desc" value="${(r.description || '').replace(/"/g, '&quot;')}" style="width:100%;" />
      </div>
      <input class="edit-points" type="number" value="${r.points_required}" style="width:70px;" />
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--argent);">
        <input class="edit-active" type="checkbox" ${r.active ? 'checked' : ''} /> Actif
      </label>
      <button class="btn btn-outline save-reward" style="width:auto;padding:10px 14px;">Enregistrer</button>
      <button class="btn btn-danger delete-reward" style="width:auto;padding:10px 14px;">Supprimer</button>
    </div>
  `).join('') || `<div class="empty-state">Aucune récompense configurée.</div>`;

  list.querySelectorAll('.save-reward').forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest('.reward-admin-row');
      const id = row.dataset.id;
      try {
        await api(`/rewards/${id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: row.querySelector('.edit-name').value,
            description: row.querySelector('.edit-desc').value,
            points_required: row.querySelector('.edit-points').value,
            active: row.querySelector('.edit-active').checked,
          }),
        });
        renderRewardsTab(main);
      } catch (e) { alert(e.message); }
    };
  });
  list.querySelectorAll('.delete-reward').forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest('.reward-admin-row');
      if (!confirm('Supprimer cette récompense ?')) return;
      try {
        await api(`/rewards/${row.dataset.id}`, { method: 'DELETE' });
        renderRewardsTab(main);
      } catch (e) { alert(e.message); }
    };
  });

  document.getElementById('new-reward-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/rewards', {
        method: 'POST',
        body: JSON.stringify({
          name: fd.get('name'),
          points_required: fd.get('points_required'),
          description: fd.get('description'),
        }),
      });
      renderRewardsTab(main);
    } catch (err) { alert(err.message); }
  };
}

/* ---------------- BOOKINGS TAB ---------------- */
const WEEKDAYS = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mer' },
  { value: 4, label: 'Jeu' },
  { value: 5, label: 'Ven' },
  { value: 6, label: 'Sam' },
  { value: 0, label: 'Dim' },
];

async function renderBookingsTab(main) {
  main.innerHTML = `<div class="loading-spin"></div>`;
  let schedule;
  try {
    const [bookingsRes, scheduleRes] = await Promise.all([api('/bookings'), api('/schedule')]);
    state.bookings = bookingsRes.bookings;
    schedule = scheduleRes.settings;
  } catch (e) {
    main.innerHTML = `<div class="error-msg">${e.message}</div>`;
    return;
  }
  const openDaysArr = schedule.open_days.split(',').map(d => parseInt(d, 10));
  const visibleBookings = state.bookings.filter(b => b.status !== 'annule');

  main.innerHTML = `
    <div class="section-title" style="margin-top:0;">Horaires d'ouverture</div>
    <div class="scanner-box" style="max-width:100%;">
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
        ${WEEKDAYS.map(d => `
          <label class="pill" style="cursor:pointer;padding:8px 12px;">
            <input type="checkbox" class="day-check" value="${d.value}" ${openDaysArr.includes(d.value) ? 'checked' : ''} style="margin-right:6px;" />${d.label}
          </label>
        `).join('')}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
        <div class="field" style="margin-bottom:0;flex:1;min-width:110px;">
          <label>Ouverture</label>
          <input type="time" id="start-time" value="${schedule.start_time}" />
        </div>
        <div class="field" style="margin-bottom:0;flex:1;min-width:110px;">
          <label>Fermeture</label>
          <input type="time" id="end-time" value="${schedule.end_time}" />
        </div>
        <div class="field" style="margin-bottom:0;flex:1;min-width:130px;">
          <label>Durée créneau (min)</label>
          <input type="number" id="slot-duration" value="${schedule.slot_duration_minutes}" min="15" step="15" />
        </div>
      </div>
      <button class="btn btn-outline" id="save-schedule-btn" style="margin-top:14px;">Enregistrer les horaires</button>
      <div id="schedule-msg"></div>
    </div>

    <div class="section-title">Demandes de réservation</div>
    ${visibleBookings.length === 0 ? `<div class="empty-state">Aucune demande pour le moment.</div>` : ''}
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${visibleBookings.map(b => `
        <div class="reward-admin-row" data-id="${b.id}" style="flex-direction:column;align-items:stretch;gap:10px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
            <div>
              <div style="font-weight:600;font-size:14.5px;">${b.prenom} ${b.nom}</div>
              <div style="color:var(--argent);font-size:12.5px;">${b.telephone}</div>
              ${b.address ? `<div style="color:var(--argent);font-size:12px;">📍 ${b.address}</div>` : ''}
            </div>
            <span class="pill status-${b.status}">${b.status.replace('_', ' ')}</span>
          </div>
          ${b.slot_datetime ? `<div style="font-family:var(--font-mono);font-size:14px;">${formatDate(b.slot_datetime)}</div>` : ''}
          <div style="font-size:13.5px;">${b.message || '—'}</div>
          <div style="color:var(--argent);font-size:12px;">Demande envoyée le ${formatDate(b.created_at)}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${b.status === 'en_attente' ? `
              <button class="btn btn-outline confirm-btn" style="width:auto;flex:1;padding:10px 14px;font-size:13px;">✓ Confirmer</button>
              <button class="btn btn-danger cancel-btn" style="width:auto;flex:1;padding:10px 14px;font-size:13px;">✕ Annuler</button>
            ` : `
              <button class="btn btn-outline reopen-btn" style="width:auto;padding:10px 14px;font-size:13px;">Remettre en attente</button>
            `}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  main.querySelector('#save-schedule-btn').onclick = async () => {
    const btn = main.querySelector('#save-schedule-btn');
    const checkedDays = Array.from(main.querySelectorAll('.day-check:checked')).map(c => c.value).join(',');
    const start_time = main.querySelector('#start-time').value;
    const end_time = main.querySelector('#end-time').value;
    const slot_duration_minutes = main.querySelector('#slot-duration').value;
    if (!checkedDays) {
      main.querySelector('#schedule-msg').innerHTML = `<div class="error-msg">Sélectionnez au moins un jour.</div>`;
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Enregistrement...';
    try {
      await api('/schedule', {
        method: 'PUT',
        body: JSON.stringify({ open_days: checkedDays, start_time, end_time, slot_duration_minutes }),
      });
      main.querySelector('#schedule-msg').innerHTML = `<div class="success-msg">✓ Horaires enregistrés.</div>`;
      btn.disabled = false;
      btn.textContent = 'Enregistrer les horaires';
    } catch (err) {
      main.querySelector('#schedule-msg').innerHTML = `<div class="error-msg">${err.message}</div>`;
      btn.disabled = false;
      btn.textContent = 'Enregistrer les horaires';
    }
  };

  async function updateStatus(id, status) {
    try {
      await api(`/bookings/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      renderBookingsTab(main);
    } catch (err) { alert(err.message); }
  }

  main.querySelectorAll('.confirm-btn').forEach(btn => {
    btn.onclick = () => updateStatus(btn.closest('[data-id]').dataset.id, 'confirme');
  });
  main.querySelectorAll('.cancel-btn').forEach(btn => {
    btn.onclick = () => updateStatus(btn.closest('[data-id]').dataset.id, 'annule');
  });
  main.querySelectorAll('.reopen-btn').forEach(btn => {
    btn.onclick = () => updateStatus(btn.closest('[data-id]').dataset.id, 'en_attente');
  });
}

/* ---------------- STATS TAB ---------------- */
async function renderStatsTab(main) {
  main.innerHTML = `<div class="loading-spin"></div>`;
  try {
    const res = await api('/stats');
    state.stats = res;
  } catch (e) {
    main.innerHTML = `<div class="error-msg">${e.message}</div>`;
    return;
  }
  const s = state.stats;
  const maxVisits = Math.max(1, ...s.last30.map(d => d.visites));
  main.innerHTML = `
    <div class="section-title" style="margin-top:0;">Vue d'ensemble</div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-value">${s.totalClients}</div><div class="stat-label">Clients inscrits</div></div>
      <div class="stat-card"><div class="stat-value">${s.totalVisits}</div><div class="stat-label">Visites totales</div></div>
      <div class="stat-card"><div class="stat-value">${s.totalPointsDistributed}</div><div class="stat-label">Points distribués</div></div>
      <div class="stat-card"><div class="stat-value">${s.totalPointsActive}</div><div class="stat-label">Points en circulation</div></div>
      <div class="stat-card"><div class="stat-value">${s.newClients30}</div><div class="stat-label">Nouveaux clients (30j)</div></div>
      <div class="stat-card"><div class="stat-value">${s.pendingBookings}</div><div class="stat-label">Réservations en attente</div></div>
    </div>

    <div class="section-title">Visites — 30 derniers jours</div>
    <div class="table-wrap" style="padding:20px;display:flex;align-items:flex-end;gap:3px;height:140px;overflow-x:auto;">
      ${s.last30.length === 0 ? `<div class="empty-state" style="width:100%;">Pas encore de visite enregistrée.</div>` :
        s.last30.map(d => `
          <div title="${d.jour} — ${d.visites} visite(s)" style="flex:1;min-width:6px;background:var(--argent-clair);border-radius:3px 3px 0 0;height:${Math.max(6, (d.visites / maxVisits) * 100)}%;"></div>
        `).join('')}
    </div>

    <div class="section-title">Top clients fidèles</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Client</th><th>Points</th></tr></thead>
        <tbody>
          ${s.topClients.length === 0 ? `<tr><td colspan="2" style="text-align:center;color:var(--argent);">Aucune donnée.</td></tr>` : ''}
          ${s.topClients.map(c => `<tr><td>${c.prenom} ${c.nom}</td><td class="pts-cell">${c.points}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

init();
