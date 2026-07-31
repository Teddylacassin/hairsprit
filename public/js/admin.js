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
  { id: 'services', label: 'Tarifs' },
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
  if (state.tab === 'services') return renderServicesTab(main);
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
    <div class="section-title" style="margin-top:0;">Ajouter un client (sans app pour l'instant)</div>
    <div class="scanner-box" style="max-width:100%;">
      <form id="new-client-form">
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <div class="field" style="flex:1;min-width:140px;"><label>Prénom</label><input name="prenom" required /></div>
          <div class="field" style="flex:1;min-width:140px;"><label>Nom</label><input name="nom" required /></div>
        </div>
        <div class="field"><label>Téléphone</label><input name="telephone" type="tel" required placeholder="06 12 34 56 78" /></div>
        <div class="field"><label>Adresse (optionnel)</label><input name="address" placeholder="12 rue des Lilas, 75011 Paris" /></div>
        <button class="btn btn-outline" type="submit">Ajouter ce client</button>
      </form>
      <div id="new-client-msg"></div>
    </div>

    <div class="section-title">Liste des clients (${state.clients.length})</div>
    <div class="search-row">
      <input id="search-input" placeholder="Rechercher par nom ou téléphone..." value="${state.clientSearch}" />
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Client</th><th>Téléphone</th><th>Adresse</th><th>Points</th><th>Membre depuis</th><th>PIN</th></tr></thead>
        <tbody>
          ${state.clients.length === 0 ? `<tr><td colspan="6" style="text-align:center;color:var(--argent);">Aucun client trouvé.</td></tr>` : ''}
          ${state.clients.map(c => `
            <tr data-client-id="${c.id}">
              <td>${c.prenom} ${c.nom}</td>
              <td>${c.telephone}</td>
              <td style="color:var(--argent);font-size:12.5px;">
                ${c.address ? `${c.address} <button class="copy-address-btn" data-address="${c.address.replace(/"/g, '&quot;')}" title="Copier l'adresse" style="background:none;border:none;color:var(--blanc);cursor:pointer;padding:2px 4px;">📋</button> <a href="https://www.waze.com/ul?q=${encodeURIComponent(c.address)}&navigate=yes" target="_blank" rel="noopener" title="Ouvrir dans Waze" style="text-decoration:none;padding:2px 4px;">🚗</a>` : '—'}
              </td>
              <td class="pts-cell">${c.points}</td>
              <td>${formatDate(c.created_at)}</td>
              <td><button class="btn btn-outline reset-pin-btn" style="width:auto;padding:7px 10px;font-size:11.5px;">Réinitialiser</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  main.querySelectorAll('.reset-pin-btn').forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest('[data-client-id]');
      const id = row.dataset.clientId;
      if (!confirm('Réinitialiser le code PIN de ce client ? Il devra en recréer un à sa prochaine connexion.')) return;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        await api(`/client/${id}/reset-pin`, { method: 'PUT' });
        btn.textContent = '✓ Fait';
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.textContent = 'Réinitialiser';
      }
    };
  });
  document.getElementById('new-client-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const msg = document.getElementById('new-client-msg');
    try {
      await api('/clients', {
        method: 'POST',
        body: JSON.stringify({
          prenom: fd.get('prenom'),
          nom: fd.get('nom'),
          telephone: fd.get('telephone'),
          address: fd.get('address'),
        }),
      });
      msg.innerHTML = `<div class="success-msg">✓ Client ajouté avec succès !</div>`;
      renderClientsTab(main);
    } catch (err) {
      msg.innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  };
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

/* ---------------- SERVICES (TARIFS) TAB ---------------- */
async function renderServicesTab(main) {
  main.innerHTML = `<div class="loading-spin"></div>`;
  let services;
  try {
    const res = await api('/services');
    services = res.services;
  } catch (e) {
    main.innerHTML = `<div class="error-msg">${e.message}</div>`;
    return;
  }
  main.innerHTML = `
    <div class="section-title" style="margin-top:0;">Tarifs</div>
    <div class="rewards-admin-grid" id="services-list"></div>
    <div class="section-title">Ajouter une prestation</div>
    <form id="new-service-form">
      <div class="field"><label>Nom</label><input name="name" required placeholder="Ex : Coupe classique" /></div>
      <div class="field"><label>Prix (€)</label><input name="price" type="number" min="0" step="0.5" required /></div>
      <div class="field"><label>Description</label><input name="description" placeholder="Détail de la prestation" /></div>
      <button class="btn btn-outline" type="submit">Ajouter</button>
    </form>
  `;
  const list = document.getElementById('services-list');
  list.innerHTML = services.map(s => `
    <div class="reward-admin-row" data-id="${s.id}">
      <div class="grow">
        <input class="edit-name" value="${s.name.replace(/"/g, '&quot;')}" style="width:100%;margin-bottom:6px;" />
        <input class="edit-desc" value="${(s.description || '').replace(/"/g, '&quot;')}" style="width:100%;" />
      </div>
      <input class="edit-price" type="number" min="0" step="0.5" value="${s.price}" style="width:80px;" />
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--argent);">
        <input class="edit-active" type="checkbox" ${s.active ? 'checked' : ''} /> Actif
      </label>
      <button class="btn btn-outline save-service" style="width:auto;padding:10px 14px;">Enregistrer</button>
      <button class="btn btn-danger delete-service" style="width:auto;padding:10px 14px;">Supprimer</button>
    </div>
  `).join('') || `<div class="empty-state">Aucune prestation configurée.</div>`;

  list.querySelectorAll('.save-service').forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest('.reward-admin-row');
      const id = row.dataset.id;
      try {
        await api(`/services/${id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: row.querySelector('.edit-name').value,
            description: row.querySelector('.edit-desc').value,
            price: row.querySelector('.edit-price').value,
            active: row.querySelector('.edit-active').checked,
          }),
        });
        renderServicesTab(main);
      } catch (e) { alert(e.message); }
    };
  });
  list.querySelectorAll('.delete-service').forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest('.reward-admin-row');
      if (!confirm('Supprimer cette prestation ?')) return;
      try {
        await api(`/services/${row.dataset.id}`, { method: 'DELETE' });
        renderServicesTab(main);
      } catch (e) { alert(e.message); }
    };
  });

  document.getElementById('new-service-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/services', {
        method: 'POST',
        body: JSON.stringify({
          name: fd.get('name'),
          price: fd.get('price'),
          description: fd.get('description'),
        }),
      });
      renderServicesTab(main);
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
  let blockedDates;
  let blockedSlots;
  try {
    const [bookingsRes, scheduleRes, blockedRes, blockedSlotsRes] = await Promise.all([api('/bookings'), api('/schedule'), api('/blocked-dates'), api('/blocked-slots')]);
    state.bookings = bookingsRes.bookings;
    schedule = scheduleRes.settings;
    blockedDates = blockedRes.blockedDates;
    blockedSlots = blockedSlotsRes.blockedSlots;
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

    <div class="section-title">Jours de congé / fermeture ponctuelle</div>
    <div class="scanner-box" style="max-width:100%;">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
        <div class="field" style="margin-bottom:0;flex:1;min-width:150px;">
          <label>Date</label>
          <input type="date" id="block-date-input" />
        </div>
        <div class="field" style="margin-bottom:0;flex:2;min-width:180px;">
          <label>Raison (optionnel)</label>
          <input type="text" id="block-reason-input" placeholder="Ex : vacances, jour férié..." />
        </div>
      </div>
      <button class="btn btn-outline" id="add-blocked-date-btn" style="margin-top:14px;">Bloquer cette date</button>
      <div id="blocked-date-msg"></div>
      ${blockedDates.length > 0 ? `
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:16px;">
          ${blockedDates.map(bd => `
            <div class="history-item" data-blocked-id="${bd.id}">
              <div>
                <div>${new Date(bd.blocked_date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}</div>
                ${bd.reason ? `<div class="date">${bd.reason}</div>` : ''}
              </div>
              <button class="btn btn-danger unblock-date-btn" style="width:auto;padding:8px 12px;font-size:12.5px;">Débloquer</button>
            </div>
          `).join('')}
        </div>
      ` : `<div class="empty-state" style="margin-top:14px;">Aucune date bloquée pour le moment.</div>`}
    </div>

    <div class="section-title">Bloquer une heure précise (rdv perso, etc.)</div>
    <div class="scanner-box" style="max-width:100%;">
      <div class="field" style="max-width:220px;">
        <label>Choisir un jour</label>
        <input type="date" id="slot-date-picker" />
      </div>
      <div id="day-slots-zone" style="margin-top:10px;"></div>
      ${blockedSlots.length > 0 ? `
        <div class="section-title" style="margin-top:20px;">Heures actuellement bloquées</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${blockedSlots.map(bs => `
            <div class="history-item" data-blocked-slot-id="${bs.id}">
              <div>
                <div>${formatDate(bs.slot_datetime)}</div>
                ${bs.reason ? `<div class="date">${bs.reason}</div>` : ''}
              </div>
              <button class="btn btn-danger unblock-slot-btn" style="width:auto;padding:8px 12px;font-size:12.5px;">Débloquer</button>
            </div>
          `).join('')}
        </div>
      ` : ''}
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
              ${b.address ? `<div style="color:var(--argent);font-size:12px;">📍 ${b.address} <button class="copy-address-btn" data-address="${b.address.replace(/"/g, '&quot;')}" title="Copier l'adresse" style="background:none;border:none;color:var(--blanc);cursor:pointer;padding:2px 4px;">📋</button> <a href="https://www.waze.com/ul?q=${encodeURIComponent(b.address)}&navigate=yes" target="_blank" rel="noopener" title="Ouvrir dans Waze" style="text-decoration:none;padding:2px 4px;">🚗</a></div>` : ''}
            </div>
            <span class="pill status-${b.status}">${b.status.replace('_', ' ')}</span>
          </div>
          ${b.slot_datetime ? `<div style="font-family:var(--font-mono);font-size:14px;">${formatDate(b.slot_datetime)}</div>` : ''}
          ${b.service_name ? `<div style="font-size:13.5px;color:var(--succes);">${b.service_name} · ${parseFloat(b.service_price).toFixed(2)}€</div>` : ''}
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

  main.querySelector('#add-blocked-date-btn').onclick = async () => {
    const btn = main.querySelector('#add-blocked-date-btn');
    const date = main.querySelector('#block-date-input').value;
    const reason = main.querySelector('#block-reason-input').value;
    if (!date) {
      main.querySelector('#blocked-date-msg').innerHTML = `<div class="error-msg">Choisissez une date.</div>`;
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Ajout...';
    try {
      await api('/blocked-dates', { method: 'POST', body: JSON.stringify({ date, reason }) });
      renderBookingsTab(main);
    } catch (err) {
      main.querySelector('#blocked-date-msg').innerHTML = `<div class="error-msg">${err.message}</div>`;
      btn.disabled = false;
      btn.textContent = 'Bloquer cette date';
    }
  };

  main.querySelectorAll('.unblock-date-btn').forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest('[data-blocked-id]');
      const id = row.dataset.blockedId;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        await api(`/blocked-dates/${id}`, { method: 'DELETE' });
        renderBookingsTab(main);
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.textContent = 'Débloquer';
      }
    };
  });

  main.querySelectorAll('.unblock-slot-btn').forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest('[data-blocked-slot-id]');
      const id = row.dataset.blockedSlotId;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        await api(`/blocked-slots/${id}`, { method: 'DELETE' });
        renderBookingsTab(main);
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.textContent = 'Débloquer';
      }
    };
  });

  main.querySelector('#slot-date-picker').onchange = async (e) => {
    const zone = main.querySelector('#day-slots-zone');
    const date = e.target.value;
    if (!date) { zone.innerHTML = ''; return; }
    zone.innerHTML = `<div class="loading-spin"></div>`;
    try {
      const res = await api(`/slots-for-date/${date}`);
      if (res.slots.length === 0) {
        zone.innerHTML = `<div class="empty-state">Aucun créneau ce jour (jour fermé ou horaires non définis).</div>`;
        return;
      }
      zone.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${res.slots.map(s => `
            <button type="button" class="btn ${s.blocked ? 'btn-danger' : (s.taken ? 'btn-outline' : 'btn-outline')} slot-pick-btn"
              data-datetime="${s.datetime}" data-blocked="${s.blocked}" data-taken="${s.taken}"
              ${s.taken ? 'disabled' : ''}
              style="width:auto;padding:10px 14px;font-size:13px;${s.taken ? 'opacity:0.4;' : ''}">
              ${new Date(s.datetime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              ${s.taken ? ' (réservé)' : s.blocked ? ' (bloqué)' : ''}
            </button>
          `).join('')}
        </div>
      `;
      zone.querySelectorAll('.slot-pick-btn').forEach(btn => {
        btn.onclick = async () => {
          const datetime = btn.dataset.datetime;
          const isBlocked = btn.dataset.blocked === 'true';
          if (isBlocked) {
            try {
              const res2 = await api('/blocked-slots');
              const entry = res2.blockedSlots.find(bs => new Date(bs.slot_datetime).toISOString() === datetime);
              if (entry) await api(`/blocked-slots/${entry.id}`, { method: 'DELETE' });
              renderBookingsTab(main);
            } catch (err) { alert(err.message); }
          } else {
            const reason = prompt('Raison (optionnel) :', '');
            if (reason === null) return;
            try {
              await api('/blocked-slots', { method: 'POST', body: JSON.stringify({ slot_datetime: datetime, reason }) });
              renderBookingsTab(main);
            } catch (err) { alert(err.message); }
          }
        };
      });
    } catch (err) {
      zone.innerHTML = `<div class="error-msg">${err.message}</div>`;
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

// Copie l'adresse dans le presse-papier, où qu'apparaisse le bouton dans l'app
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.copy-address-btn');
  if (!btn) return;
  const address = btn.dataset.address;
  try {
    await navigator.clipboard.writeText(address);
    const original = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = original; }, 1200);
  } catch (err) {
    alert('Impossible de copier automatiquement. Adresse : ' + address);
  }
});

init();
