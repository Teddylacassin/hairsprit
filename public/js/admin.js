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
  { id: 'products', label: 'Boutique' },
  { id: 'orders', label: 'Commandes' },
  { id: 'today', label: "Aujourd'hui" },
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
      document.querySelectorAll('.admin-nav button').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === state.tab);
      });
      renderTabContent();
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
  if (state.tab === 'products') return renderProductsTab(main);
  if (state.tab === 'orders') return renderOrdersTab(main);
  if (state.tab === 'today') return renderTodayTab(main);
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

    <div class="section-title" id="clients-count-title">Liste des clients (${state.clients.length})</div>
    <div class="search-row">
      <input id="search-input" placeholder="Rechercher par nom ou téléphone..." value="${state.clientSearch}" />
    </div>
    <div id="clients-table-zone"></div>
    <div id="book-modal-zone"></div>
  `;
  renderClientsTableBody(main);

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
    timeout = setTimeout(async () => {
      state.clientSearch = e.target.value;
      try {
        const res = await api(`/clients${state.clientSearch ? '?q=' + encodeURIComponent(state.clientSearch) : ''}`);
        state.clients = res.clients;
        document.getElementById('clients-count-title').textContent = `Liste des clients (${state.clients.length})`;
        renderClientsTableBody(main);
      } catch (err) { /* silent */ }
    }, 300);
  };
}

function renderClientsTableBody(main) {
  const zone = document.getElementById('clients-table-zone');
  zone.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Client</th><th>Téléphone</th><th>Adresse</th><th>Points</th><th>Membre depuis</th><th>PIN</th><th>Notes</th><th>RDV</th></tr></thead>
        <tbody>
          ${state.clients.length === 0 ? `<tr><td colspan="8" style="text-align:center;color:var(--argent);">Aucun client trouvé.</td></tr>` : ''}
          ${state.clients.map(c => `
            <tr data-client-id="${c.id}" data-notes="${(c.admin_notes || '').replace(/"/g, '&quot;')}" data-telephone="${c.telephone}" data-address="${(c.address || '').replace(/"/g, '&quot;')}" data-prenom="${c.prenom.replace(/"/g, '&quot;')}" data-nom="${c.nom.replace(/"/g, '&quot;')}">
              <td>${c.prenom} ${c.nom}</td>
              <td>${c.telephone} <button class="edit-contact-btn" title="Modifier téléphone/adresse" style="background:none;border:none;color:var(--blanc);cursor:pointer;padding:2px 4px;">✏️</button></td>
              <td style="color:var(--argent);font-size:12.5px;">
                ${c.address ? `${c.address} <button class="copy-address-btn" data-address="${c.address.replace(/"/g, '&quot;')}" title="Copier l'adresse" style="background:none;border:none;color:var(--blanc);cursor:pointer;padding:2px 4px;">📋</button> <a href="https://www.waze.com/ul?q=${encodeURIComponent(c.address)}&navigate=yes" target="_blank" rel="noopener" title="Ouvrir dans Waze" style="text-decoration:none;padding:2px 4px;">🚗</a>` : '—'}
              </td>
              <td class="pts-cell">${c.points}</td>
              <td>${formatDate(c.created_at)}</td>
              <td><button class="btn btn-outline reset-pin-btn" style="width:auto;padding:7px 10px;font-size:11.5px;">Réinitialiser</button></td>
              <td style="color:var(--argent);font-size:12px;max-width:140px;">
                ${c.admin_notes ? `<span>${c.admin_notes}</span> ` : ''}<button class="edit-notes-btn" title="Modifier les notes" style="background:none;border:none;color:var(--blanc);cursor:pointer;padding:2px 4px;">📝</button>
              </td>
              <td><button class="btn btn-outline book-client-btn" style="width:auto;padding:7px 10px;font-size:11.5px;">📅 RDV</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  zone.querySelectorAll('.book-client-btn').forEach(btn => {
    btn.onclick = () => {
      const row = btn.closest('[data-client-id]');
      openBookClientPanel(main, {
        id: row.dataset.clientId,
        prenom: row.dataset.prenom,
        nom: row.dataset.nom,
      });
    };
  });
  zone.querySelectorAll('.edit-contact-btn').forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest('[data-client-id]');
      const id = row.dataset.clientId;
      const currentTel = row.dataset.telephone || '';
      const currentAddr = row.dataset.address || '';
      const newTel = prompt('Téléphone :', currentTel);
      if (newTel === null) return;
      const newAddr = prompt('Adresse :', currentAddr);
      if (newAddr === null) return;
      try {
        await api(`/client/${id}`, { method: 'PUT', body: JSON.stringify({ telephone: newTel, address: newAddr }) });
        const res = await api(`/clients${state.clientSearch ? '?q=' + encodeURIComponent(state.clientSearch) : ''}`);
        state.clients = res.clients;
        renderClientsTableBody(main);
      } catch (err) { alert(err.message); }
    };
  });
  zone.querySelectorAll('.edit-notes-btn').forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest('[data-client-id]');
      const id = row.dataset.clientId;
      const current = row.dataset.notes || '';
      const notes = prompt('Notes privées (digicode, parking, étage...) :', current);
      if (notes === null) return;
      try {
        await api(`/client/${id}/notes`, { method: 'PUT', body: JSON.stringify({ notes }) });
        const res = await api(`/clients${state.clientSearch ? '?q=' + encodeURIComponent(state.clientSearch) : ''}`);
        state.clients = res.clients;
        renderClientsTableBody(main);
      } catch (err) { alert(err.message); }
    };
  });
  zone.querySelectorAll('.reset-pin-btn').forEach(btn => {
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
}

function openBookClientPanel(main, client) {
  const zone = main.querySelector('#book-modal-zone');
  zone.innerHTML = `
    <div class="scanner-box" style="max-width:100%;margin-top:16px;">
      <div class="section-title" style="margin-top:0;">Prendre RDV pour ${client.prenom} ${client.nom}</div>
      <div class="field" style="max-width:220px;">
        <label>Choisir un jour</label>
        <input type="date" id="book-date-picker" />
      </div>
      <div id="book-slots-zone" style="margin-top:10px;"></div>
      <button class="btn btn-ghost" id="cancel-book-panel" style="margin-top:10px;">Annuler</button>
    </div>
  `;
  zone.scrollIntoView({ behavior: 'smooth', block: 'center' });

  zone.querySelector('#cancel-book-panel').onclick = () => { zone.innerHTML = ''; };

  zone.querySelector('#book-date-picker').onchange = async (e) => {
    const slotsZone = zone.querySelector('#book-slots-zone');
    const date = e.target.value;
    if (!date) { slotsZone.innerHTML = ''; return; }
    slotsZone.innerHTML = `<div class="loading-spin"></div>`;
    let services = [];
    try {
      const [slotsRes, servicesRes] = await Promise.all([api(`/slots-for-date/${date}`), api('/services')]);
      services = servicesRes.services;
      if (slotsRes.slots.length === 0) {
        slotsZone.innerHTML = `<div class="empty-state">Aucun créneau ce jour (jour fermé ou horaires non définis).</div>`;
        return;
      }
      slotsZone.innerHTML = `
        ${services.length > 0 ? `
          <div class="field">
            <label>Prestation (optionnel)</label>
            <select id="book-service-select" style="width:100%;background:var(--panel-2);border:1px solid var(--ligne);color:var(--blanc);padding:10px;border-radius:8px;">
              <option value="">— Aucune —</option>
              ${services.map(s => `<option value="${s.id}">${s.name} (${parseFloat(s.price).toFixed(2)}€)</option>`).join('')}
            </select>
          </div>
        ` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;">
          ${slotsRes.slots.filter(s => !s.taken && !s.blocked).map(s => `
            <button type="button" class="btn btn-outline book-slot-pick-btn" data-datetime="${s.datetime}" style="width:auto;padding:10px 14px;font-size:13px;">
              ${new Date(s.datetime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </button>
          `).join('')}
        </div>
      `;
      slotsZone.querySelectorAll('.book-slot-pick-btn').forEach(sbtn => {
        sbtn.onclick = async () => {
          const serviceSelect = slotsZone.querySelector('#book-service-select');
          sbtn.disabled = true;
          sbtn.textContent = '...';
          try {
            await api('/bookings', {
              method: 'POST',
              body: JSON.stringify({
                client_id: client.id,
                slot_datetime: sbtn.dataset.datetime,
                service_id: serviceSelect ? serviceSelect.value || null : null,
              }),
            });
            zone.innerHTML = `<div class="success-msg" style="margin-top:16px;">✓ Rendez-vous ajouté pour ${client.prenom} ${client.nom} !</div>`;
          } catch (err) { alert(err.message); sbtn.disabled = false; }
        };
      });
    } catch (err) {
      slotsZone.innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  };
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

/* ---------------- PRODUCTS (BOUTIQUE) TAB ---------------- */
async function renderProductsTab(main) {
  main.innerHTML = `<div class="loading-spin"></div>`;
  let products;
  try {
    const res = await api('/products');
    products = res.products;
  } catch (e) {
    main.innerHTML = `<div class="error-msg">${e.message}</div>`;
    return;
  }
  main.innerHTML = `
    <div class="section-title" style="margin-top:0;">Boutique</div>
    <div class="rewards-admin-grid" id="products-list"></div>
    <div class="section-title">Ajouter un produit</div>
    <form id="new-product-form">
      <div class="field"><label>Nom</label><input name="name" required placeholder="Ex : Cire coiffante" /></div>
      <div class="field"><label>Prix (€)</label><input name="price" type="number" min="0" step="0.5" required /></div>
      <div class="field"><label>Description</label><input name="description" placeholder="Détail du produit" /></div>
      <div class="field"><label>Lien de la photo (optionnel)</label><input name="image_url" placeholder="https://..." /></div>
      <button class="btn btn-outline" type="submit">Ajouter</button>
    </form>
  `;
  const list = document.getElementById('products-list');
  list.innerHTML = products.map(p => `
    <div class="reward-admin-row" data-id="${p.id}" style="align-items:flex-start;">
      ${p.image_url ? `<img src="${p.image_url}" alt="${p.name}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;flex-shrink:0;" />` : ''}
      <div class="grow">
        <input class="edit-name" value="${p.name.replace(/"/g, '&quot;')}" style="width:100%;margin-bottom:6px;" />
        <input class="edit-desc" value="${(p.description || '').replace(/"/g, '&quot;')}" style="width:100%;margin-bottom:6px;" />
        <input class="edit-image" value="${(p.image_url || '').replace(/"/g, '&quot;')}" placeholder="Lien de la photo" style="width:100%;" />
      </div>
      <input class="edit-price" type="number" min="0" step="0.5" value="${p.price}" style="width:80px;" />
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--argent);">
        <input class="edit-active" type="checkbox" ${p.active ? 'checked' : ''} /> Actif
      </label>
      <button class="btn btn-outline save-product" style="width:auto;padding:10px 14px;">Enregistrer</button>
      <button class="btn btn-danger delete-product" style="width:auto;padding:10px 14px;">Supprimer</button>
    </div>
  `).join('') || `<div class="empty-state">Aucun produit configuré.</div>`;

  list.querySelectorAll('.save-product').forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest('.reward-admin-row');
      const id = row.dataset.id;
      try {
        await api(`/products/${id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: row.querySelector('.edit-name').value,
            description: row.querySelector('.edit-desc').value,
            image_url: row.querySelector('.edit-image').value,
            price: row.querySelector('.edit-price').value,
            active: row.querySelector('.edit-active').checked,
          }),
        });
        renderProductsTab(main);
      } catch (e) { alert(e.message); }
    };
  });
  list.querySelectorAll('.delete-product').forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest('.reward-admin-row');
      if (!confirm('Supprimer ce produit ?')) return;
      try {
        await api(`/products/${row.dataset.id}`, { method: 'DELETE' });
        renderProductsTab(main);
      } catch (e) { alert(e.message); }
    };
  });

  document.getElementById('new-product-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/products', {
        method: 'POST',
        body: JSON.stringify({
          name: fd.get('name'),
          price: fd.get('price'),
          description: fd.get('description'),
          image_url: fd.get('image_url'),
        }),
      });
      renderProductsTab(main);
    } catch (err) { alert(err.message); }
  };
}

/* ---------------- ORDERS TAB ---------------- */
async function renderOrdersTab(main) {
  main.innerHTML = `<div class="loading-spin"></div>`;
  let orders;
  try {
    const res = await api('/orders');
    orders = res.orders;
  } catch (e) {
    main.innerHTML = `<div class="error-msg">${e.message}</div>`;
    return;
  }
  const visibleOrders = orders.filter(o => o.status !== 'annule');

  main.innerHTML = `
    <div class="section-title" style="margin-top:0;">Commandes boutique</div>
    ${visibleOrders.length === 0 ? `<div class="empty-state">Aucune commande pour le moment.</div>` : ''}
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${visibleOrders.map(o => {
        const total = o.items.reduce((sum, i) => sum + parseFloat(i.product_price) * i.quantity, 0);
        return `
        <div class="reward-admin-row" data-id="${o.id}" style="flex-direction:column;align-items:stretch;gap:8px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
            <div>
              <div style="font-weight:600;font-size:14.5px;">${o.prenom} ${o.nom}</div>
              <div style="color:var(--argent);font-size:12.5px;">${o.telephone}</div>
              ${o.address ? `<div style="color:var(--argent);font-size:12px;">📍 ${o.address} <button class="copy-address-btn" data-address="${o.address.replace(/"/g, '&quot;')}" style="background:none;border:none;color:var(--blanc);cursor:pointer;padding:2px 4px;">📋</button> <a href="https://www.waze.com/ul?q=${encodeURIComponent(o.address)}&navigate=yes" target="_blank" rel="noopener" style="text-decoration:none;padding:2px 4px;">🚗</a></div>` : ''}
            </div>
            <span class="pill status-${o.status}">${o.status.replace('_', ' ')}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            ${o.items.map(i => `<div style="font-size:13.5px;">${i.quantity} × ${i.product_name} — ${(parseFloat(i.product_price) * i.quantity).toFixed(2)}€</div>`).join('')}
          </div>
          <div style="font-family:var(--font-mono);color:var(--succes);font-size:14px;">Total : ${total.toFixed(2)}€</div>
          ${o.note ? `<div style="font-size:13px;color:var(--argent);">${o.note}</div>` : ''}
          <div style="color:var(--argent);font-size:12px;">Commandé le ${formatDate(o.created_at)}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${o.status === 'en_attente' ? `
              <button class="btn btn-outline deliver-btn" style="width:auto;flex:1;padding:10px 14px;font-size:13px;">✓ Marquer livrée</button>
              <button class="btn btn-danger cancel-order-btn" style="width:auto;flex:1;padding:10px 14px;font-size:13px;">✕ Annuler</button>
            ` : `
              <button class="btn btn-outline reopen-order-btn" style="width:auto;padding:10px 14px;font-size:13px;">Remettre en attente</button>
            `}
          </div>
        </div>
      `;
      }).join('')}
    </div>
  `;

  async function updateOrderStatus(id, status) {
    try {
      await api(`/orders/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      renderOrdersTab(main);
    } catch (err) { alert(err.message); }
  }
  main.querySelectorAll('.deliver-btn').forEach(btn => {
    btn.onclick = () => updateOrderStatus(btn.closest('[data-id]').dataset.id, 'livre');
  });
  main.querySelectorAll('.cancel-order-btn').forEach(btn => {
    btn.onclick = () => updateOrderStatus(btn.closest('[data-id]').dataset.id, 'annule');
  });
  main.querySelectorAll('.reopen-order-btn').forEach(btn => {
    btn.onclick = () => updateOrderStatus(btn.closest('[data-id]').dataset.id, 'en_attente');
  });
}

/* ---------------- TODAY TAB ---------------- */
function toICSDate(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function buildICSLink(booking, durationMinutes) {
  const start = new Date(booking.slot_datetime);
  const end = new Date(start.getTime() + (durationMinutes || 120) * 60000);
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `DTSTART:${toICSDate(start.toISOString())}`,
    `DTEND:${toICSDate(end.toISOString())}`,
    `SUMMARY:Coupe - ${booking.prenom} ${booking.nom}`,
    booking.address ? `LOCATION:${booking.address.replace(/,/g, '\\,')}` : '',
    `DESCRIPTION:${booking.telephone}${booking.service_name ? ' - ' + booking.service_name : ''}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
  return 'data:text/calendar;charset=utf8,' + encodeURIComponent(ics);
}

async function renderTodayTab(main) {
  main.innerHTML = `<div class="loading-spin"></div>`;
  let bookings, schedule;
  try {
    const [bookingsRes, scheduleRes] = await Promise.all([api('/bookings'), api('/schedule')]);
    bookings = bookingsRes.bookings;
    schedule = scheduleRes.settings;
  } catch (e) {
    main.innerHTML = `<div class="error-msg">${e.message}</div>`;
    return;
  }

  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const todayBookings = bookings
    .filter(b => b.status === 'confirme' && b.slot_datetime && new Date(b.slot_datetime).toISOString().slice(0, 10) === todayKey)
    .sort((a, b) => new Date(a.slot_datetime) - new Date(b.slot_datetime));

  main.innerHTML = `
    <div class="section-title" style="margin-top:0;">Planning du ${now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    ${todayBookings.length === 0 ? `<div class="empty-state">Aucun rendez-vous confirmé aujourd'hui.</div>` : ''}
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${todayBookings.map(b => `
        <div class="reward-admin-row" style="flex-direction:column;align-items:stretch;gap:8px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div style="font-family:var(--font-mono);font-size:18px;font-weight:600;">${new Date(b.slot_datetime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
            <a href="${buildICSLink(b, schedule.slot_duration_minutes)}" title="Ajouter au calendrier" style="text-decoration:none;">📅</a>
          </div>
          <div style="font-weight:600;font-size:14.5px;">${b.prenom} ${b.nom} · ${b.telephone}</div>
          ${b.service_name ? `<div style="color:var(--succes);font-size:13px;">${b.service_name} · ${parseFloat(b.service_price).toFixed(2)}€</div>` : ''}
          ${b.address ? `<div style="color:var(--argent);font-size:13px;">📍 ${b.address} <button class="copy-address-btn" data-address="${b.address.replace(/"/g, '&quot;')}" title="Copier l'adresse" style="background:none;border:none;color:var(--blanc);cursor:pointer;padding:2px 4px;">📋</button> <a href="https://www.waze.com/ul?q=${encodeURIComponent(b.address)}&navigate=yes" target="_blank" rel="noopener" title="Ouvrir dans Waze" style="text-decoration:none;padding:2px 4px;">🚗</a></div>` : ''}
          ${b.admin_notes ? `<div style="color:var(--argent);font-size:12.5px;">📝 ${b.admin_notes}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
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
          ${b.slot_datetime ? `<div style="font-family:var(--font-mono);font-size:14px;display:flex;align-items:center;gap:8px;">${formatDate(b.slot_datetime)}${b.status === 'confirme' ? ` <a href="${buildICSLink(b, schedule.slot_duration_minutes)}" title="Ajouter au calendrier" style="text-decoration:none;">📅</a>` : ''}</div>` : ''}
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
  const monthLabel = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  main.innerHTML = `
    <div class="section-title" style="margin-top:0;">Chiffre d'affaires — ${monthLabel}</div>
    <div class="scanner-box" style="max-width:100%;">
      <div style="font-family:var(--font-mono);font-size:38px;font-weight:600;color:var(--succes);">${s.monthRevenue.toFixed(2)}€</div>
      <div style="color:var(--argent);font-size:12.5px;margin-top:4px;">${s.monthRevenueCount} prestation${s.monthRevenueCount > 1 ? 's' : ''} confirmée${s.monthRevenueCount > 1 ? 's' : ''} avec tarif ce mois-ci</div>
    </div>

    <div class="section-title">Vue d'ensemble</div>
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
