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
  { id: 'today', label: "Aujourd'hui" },
  { id: 'bookings', label: 'Réservations' },
  { id: 'orders', label: 'Boutique' },
  { id: 'accounting', label: 'Comptabilité' },
  { id: 'bank', label: 'Banque' },
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
  if (state.tab === 'today') return renderTodayTab(main);
  if (state.tab === 'bookings') return renderBookingsTab(main);
  if (state.tab === 'orders') return renderOrdersTab(main);
  if (state.tab === 'accounting') return renderAccountingTab(main);
  if (state.tab === 'bank') return renderBankTab(main);
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
    ${state.clients.length === 0 ? `<div class="empty-state">Aucun client trouvé.</div>` : ''}
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${state.clients.map(c => `
        <div class="reward-admin-row" style="justify-content:space-between;flex-wrap:wrap;gap:8px;" data-client-id="${c.id}" data-notes="${(c.admin_notes || '').replace(/"/g, '&quot;')}" data-telephone="${c.telephone}" data-address="${(c.address || '').replace(/"/g, '&quot;')}" data-prenom="${c.prenom.replace(/"/g, '&quot;')}" data-nom="${c.nom.replace(/"/g, '&quot;')}" data-created="${c.created_at}">
          <div style="font-weight:600;font-size:14px;">${c.prenom} ${c.nom}</div>
          <div style="display:flex;align-items:center;gap:6px;">
            ${c.address ? `<a href="https://www.waze.com/ul?q=${encodeURIComponent(c.address)}&navigate=yes" target="_blank" rel="noopener" title="Ouvrir dans Waze" style="text-decoration:none;font-size:15px;">🚗</a>` : ''}
            <span class="pts-cell" style="font-family:var(--font-mono);font-size:13.5px;">${c.points}pts</span>
            <button class="view-info-btn" title="Toutes les infos (adresse, téléphone, notes, PIN, RDV...)" style="background:none;border:none;color:var(--blanc);cursor:pointer;padding:4px;font-size:15px;">📝</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  zone.querySelectorAll('.view-info-btn').forEach(btn => {
    btn.onclick = () => {
      const row = btn.closest('[data-client-id]');
      openClientInfoPanel(main, {
        id: row.dataset.clientId,
        prenom: row.dataset.prenom,
        nom: row.dataset.nom,
        telephone: row.dataset.telephone,
        address: row.dataset.address,
        notes: row.dataset.notes,
        created: row.dataset.created,
      });
    };
  });
}

function openClientInfoPanel(main, client) {
  const zone = main.querySelector('#book-modal-zone');
  zone.innerHTML = `
    <div class="scanner-box" style="max-width:100%;margin-top:16px;">
      <div class="section-title" style="margin-top:0;">${client.prenom} ${client.nom}</div>
      <div style="display:flex;flex-direction:column;gap:10px;font-size:13.5px;">
        <div>
          <span style="color:var(--argent);">📍 Adresse : </span>${client.address || 'Aucune adresse'}
          ${client.address ? `<button class="copy-address-btn" data-address="${client.address.replace(/"/g, '&quot;')}" title="Copier l'adresse" style="background:none;border:none;color:var(--blanc);cursor:pointer;padding:2px 4px;">📋</button>` : ''}
        </div>
        <div><span style="color:var(--argent);">📞 Téléphone : </span>${client.telephone || '—'}</div>
        <div><span style="color:var(--argent);">🗓️ Membre depuis : </span>${formatDate(client.created)}</div>
      </div>
      <div class="field" style="margin-top:16px;">
        <label>Notes privées (digicode, parking, étage...)</label>
        <textarea id="client-notes-input" rows="3" placeholder="Ajouter une note...">${client.notes || ''}</textarea>
      </div>
      <div id="client-notes-msg"></div>
      <button class="btn btn-primary" id="save-client-notes-btn" style="margin-top:8px;">Enregistrer les notes</button>
      <div style="display:flex;gap:10px;margin-top:10px;">
        <button class="btn btn-outline" id="edit-contact-info-btn" style="flex:1;">✏️ Téléphone/adresse</button>
        <button class="btn btn-outline" id="reset-pin-panel-btn" style="flex:1;">🔑 Réinitialiser PIN</button>
      </div>
      <button class="btn btn-outline" id="style-profile-btn" style="margin-top:10px;">✂️ Mon barber habituel</button>
      <button class="btn btn-outline" id="book-client-panel-btn" style="margin-top:10px;">📅 Prendre RDV</button>
      <button class="btn btn-ghost" id="close-client-info-btn" style="margin-top:10px;">Fermer</button>
    </div>
  `;
  zone.scrollIntoView({ behavior: 'smooth', block: 'center' });

  zone.querySelector('#close-client-info-btn').onclick = () => { zone.innerHTML = ''; };

  zone.querySelector('#save-client-notes-btn').onclick = async () => {
    const btn = zone.querySelector('#save-client-notes-btn');
    const notes = zone.querySelector('#client-notes-input').value;
    btn.disabled = true;
    btn.textContent = 'Enregistrement...';
    try {
      await api(`/client/${client.id}/notes`, { method: 'PUT', body: JSON.stringify({ notes }) });
      const res = await api(`/clients${state.clientSearch ? '?q=' + encodeURIComponent(state.clientSearch) : ''}`);
      state.clients = res.clients;
      renderClientsTableBody(main);
      zone.querySelector('#client-notes-msg').innerHTML = `<div class="success-msg" style="margin-top:10px;">✓ Notes enregistrées.</div>`;
      btn.disabled = false;
      btn.textContent = 'Enregistrer les notes';
    } catch (err) {
      zone.querySelector('#client-notes-msg').innerHTML = `<div class="error-msg" style="margin-top:10px;">${err.message}</div>`;
      btn.disabled = false;
      btn.textContent = 'Enregistrer les notes';
    }
  };

  zone.querySelector('#edit-contact-info-btn').onclick = async () => {
    const newTel = prompt('Téléphone :', client.telephone || '');
    if (newTel === null) return;
    const newAddr = prompt('Adresse :', client.address || '');
    if (newAddr === null) return;
    try {
      await api(`/client/${client.id}`, { method: 'PUT', body: JSON.stringify({ telephone: newTel, address: newAddr }) });
      const res = await api(`/clients${state.clientSearch ? '?q=' + encodeURIComponent(state.clientSearch) : ''}`);
      state.clients = res.clients;
      renderClientsTableBody(main);
      client.telephone = newTel;
      client.address = newAddr;
      openClientInfoPanel(main, client);
    } catch (err) { alert(err.message); }
  };

  zone.querySelector('#reset-pin-panel-btn').onclick = async () => {
    if (!confirm('Réinitialiser le code PIN de ce client ? Il devra en recréer un à sa prochaine connexion.')) return;
    const btn = zone.querySelector('#reset-pin-panel-btn');
    btn.disabled = true;
    btn.textContent = '…';
    try {
      await api(`/client/${client.id}/reset-pin`, { method: 'PUT' });
      btn.textContent = '✓ PIN réinitialisé';
      setTimeout(() => { btn.textContent = '🔑 Réinitialiser PIN'; btn.disabled = false; }, 1500);
    } catch (err) {
      alert(err.message);
      btn.disabled = false;
      btn.textContent = '🔑 Réinitialiser PIN';
    }
  };

  zone.querySelector('#book-client-panel-btn').onclick = () => {
    openBookClientPanel(main, { id: client.id, prenom: client.prenom, nom: client.nom });
  };

  zone.querySelector('#style-profile-btn').onclick = () => {
    openStyleProfilePanel(main, client);
  };
}

async function openStyleProfilePanel(main, client) {
  const zone = main.querySelector('#book-modal-zone');
  zone.innerHTML = `<div class="loading-spin"></div>`;
  zone.scrollIntoView({ behavior: 'smooth', block: 'center' });

  let profile, photos;
  try {
    const res = await api(`/client/${client.id}/style-profile`);
    profile = res.profile;
    photos = res.photos;
  } catch (err) {
    zone.innerHTML = `<div class="error-msg">${err.message}</div>`;
    return;
  }

  function render() {
    zone.innerHTML = `
      <div class="scanner-box" style="max-width:100%;margin-top:16px;">
        <div class="section-title" style="margin-top:0;">✂️ Mon barber habituel — ${client.prenom} ${client.nom}</div>
        <div class="field">
          <label>Dernière coupe</label>
          <input type="text" id="sp-last-cut" value="${(profile.last_cut || '').replace(/"/g, '&quot;')}" placeholder="Ex : Dégradé bas, contours nets" />
        </div>
        <div class="field">
          <label>Longueur habituelle</label>
          <input type="text" id="sp-length" value="${(profile.usual_length || '').replace(/"/g, '&quot;')}" placeholder="Ex : 2 sur les côtés, 5 dessus" />
        </div>
        <div class="field">
          <label>Barbe</label>
          <input type="text" id="sp-beard" value="${(profile.beard || '').replace(/"/g, '&quot;')}" placeholder="Ex : Taillée courte, contours rasoir" />
        </div>
        <div class="field">
          <label>Produits utilisés</label>
          <input type="text" id="sp-products" value="${(profile.products || '').replace(/"/g, '&quot;')}" placeholder="Ex : Cire mate, huile à barbe" />
        </div>
        <div id="sp-msg"></div>
        <button class="btn btn-primary" id="sp-save-btn">Enregistrer le profil</button>

        <div class="section-title">Photos des anciennes coupes</div>
        <input type="file" id="sp-photo-input" accept="image/*" capture="environment" style="margin-bottom:10px;" />
        <div id="sp-photo-msg"></div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px;">
          ${photos.map(p => `
            <div style="position:relative;">
              <img src="${p.photo_data}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;border:1px solid var(--ligne);" />
              <button class="sp-delete-photo-btn" data-photo-id="${p.id}" title="Supprimer" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.6);border:none;color:var(--blanc);border-radius:6px;width:24px;height:24px;font-size:13px;cursor:pointer;">✕</button>
            </div>
          `).join('')}
          ${photos.length === 0 ? `<div class="empty-state" style="grid-column:1/-1;">Aucune photo pour le moment.</div>` : ''}
        </div>

        <button class="btn btn-ghost" id="sp-close-btn" style="margin-top:16px;">Fermer</button>
      </div>
    `;

    zone.querySelector('#sp-close-btn').onclick = () => { zone.innerHTML = ''; };

    zone.querySelector('#sp-save-btn').onclick = async () => {
      const btn = zone.querySelector('#sp-save-btn');
      btn.disabled = true;
      btn.textContent = 'Enregistrement...';
      try {
        await api(`/client/${client.id}/style-profile`, {
          method: 'PUT',
          body: JSON.stringify({
            last_cut: zone.querySelector('#sp-last-cut').value,
            usual_length: zone.querySelector('#sp-length').value,
            beard: zone.querySelector('#sp-beard').value,
            products: zone.querySelector('#sp-products').value,
          }),
        });
        zone.querySelector('#sp-msg').innerHTML = `<div class="success-msg">✓ Profil enregistré.</div>`;
        btn.disabled = false;
        btn.textContent = 'Enregistrer le profil';
      } catch (err) {
        zone.querySelector('#sp-msg').innerHTML = `<div class="error-msg">${err.message}</div>`;
        btn.disabled = false;
        btn.textContent = 'Enregistrer le profil';
      }
    };

    zone.querySelector('#sp-photo-input').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const msg = zone.querySelector('#sp-photo-msg');
      if (file.size > 5 * 1024 * 1024) {
        msg.innerHTML = `<div class="error-msg">Photo trop lourde (max 5 Mo).</div>`;
        return;
      }
      msg.innerHTML = `<div class="loading-spin"></div>`;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          await api(`/client/${client.id}/style-photos`, {
            method: 'POST',
            body: JSON.stringify({ photo_data: reader.result }),
          });
          const res = await api(`/client/${client.id}/style-profile`);
          profile = res.profile;
          photos = res.photos;
          render();
        } catch (err) {
          msg.innerHTML = `<div class="error-msg">${err.message}</div>`;
        }
      };
      reader.readAsDataURL(file);
    };

    zone.querySelectorAll('.sp-delete-photo-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Supprimer cette photo ?')) return;
        try {
          await api(`/style-photos/${btn.dataset.photoId}`, { method: 'DELETE' });
          const res = await api(`/client/${client.id}/style-profile`);
          profile = res.profile;
          photos = res.photos;
          render();
        } catch (err) { alert(err.message); }
      };
    });
  }

  render();
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
      <div style="display:flex;gap:10px;">
        <div class="field" style="flex:1;"><label>Prix (€)</label><input name="price" type="number" min="0" step="0.5" required /></div>
        <div class="field" style="flex:1;"><label>Durée (min)</label><input name="duration_minutes" type="number" min="5" step="5" value="30" required /></div>
      </div>
      <div class="field"><label>Prix groupe (€, à partir de 3 personnes, optionnel)</label><input name="group_price" type="number" min="0" step="0.5" placeholder="Laisser vide = pas de tarif groupe" /></div>
      <div class="field"><label>Description</label><input name="description" placeholder="Détail de la prestation" /></div>
      <button class="btn btn-outline" type="submit">Ajouter</button>
    </form>
  `;
  const list = document.getElementById('services-list');
  list.innerHTML = services.map(s => `
    <div class="reward-admin-row" data-id="${s.id}">
      <div class="grow">
        <input class="edit-name" value="${s.name.replace(/"/g, '&quot;')}" style="width:100%;margin-bottom:6px;" />
        <input class="edit-desc" value="${(s.description || '').replace(/"/g, '&quot;')}" style="width:100%;margin-bottom:6px;" />
        <input class="edit-group-price" type="number" min="0" step="0.5" value="${s.group_price != null ? s.group_price : ''}" placeholder="Prix groupe 3+ (optionnel)" style="width:100%;" />
      </div>
      <input class="edit-price" type="number" min="0" step="0.5" value="${s.price}" style="width:80px;" title="Prix (€)" />
      <input class="edit-duration" type="number" min="5" step="5" value="${s.duration_minutes || 30}" style="width:70px;" title="Durée (min)" />
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
            duration_minutes: row.querySelector('.edit-duration').value,
            group_price: row.querySelector('.edit-group-price').value,
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
          duration_minutes: fd.get('duration_minutes'),
          group_price: fd.get('group_price'),
        }),
      });
      renderServicesTab(main);
    } catch (err) { alert(err.message); }
  };

  renderCommunesSection(main);
}

async function renderCommunesSection(main) {
  let communes;
  try {
    const res = await api('/communes');
    communes = res.communes;
  } catch (e) {
    return;
  }

  const zone = document.createElement('div');
  zone.id = 'communes-zone';
  main.appendChild(zone);

  zone.innerHTML = `
    <div class="section-title">Communes (supplément hors Liège)</div>
    <div class="sub" style="color:var(--argent);font-size:12.5px;margin-bottom:14px;">Le client choisit sa commune en réservant. "Liège" (0€) est déjà là par défaut.</div>
    <div class="rewards-admin-grid" id="communes-list"></div>
    <div class="section-title">Ajouter une commune</div>
    <form id="new-commune-form">
      <div style="display:flex;gap:10px;">
        <div class="field" style="flex:2;"><label>Nom</label><input name="name" required placeholder="Ex : Herstal" /></div>
        <div class="field" style="flex:1;"><label>Supplément (€)</label><input name="surcharge" type="number" min="0" step="0.5" placeholder="5" required /></div>
      </div>
      <button class="btn btn-outline" type="submit">Ajouter</button>
      <div id="new-commune-msg"></div>
    </form>
  `;

  const list = zone.querySelector('#communes-list');
  list.innerHTML = communes.map(c => `
    <div class="reward-admin-row" data-id="${c.id}">
      <div class="grow"><input class="edit-name" value="${c.name.replace(/"/g, '&quot;')}" style="width:100%;" /></div>
      <input class="edit-surcharge" type="number" min="0" step="0.5" value="${c.surcharge}" style="width:80px;" title="Supplément (€)" />
      <button class="btn btn-outline save-commune" style="width:auto;padding:10px 14px;">Enregistrer</button>
      <button class="btn btn-danger delete-commune" style="width:auto;padding:10px 14px;">Supprimer</button>
    </div>
  `).join('') || `<div class="empty-state">Aucune commune configurée.</div>`;

  list.querySelectorAll('.save-commune').forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest('.reward-admin-row');
      try {
        await api(`/communes/${row.dataset.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: row.querySelector('.edit-name').value,
            surcharge: row.querySelector('.edit-surcharge').value,
          }),
        });
        renderServicesTab(main);
      } catch (e) { alert(e.message); }
    };
  });
  list.querySelectorAll('.delete-commune').forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest('.reward-admin-row');
      if (!confirm('Supprimer cette commune ?')) return;
      try {
        await api(`/communes/${row.dataset.id}`, { method: 'DELETE' });
        renderServicesTab(main);
      } catch (e) { alert(e.message); }
    };
  });

  zone.querySelector('#new-commune-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/communes', {
        method: 'POST',
        body: JSON.stringify({ name: fd.get('name'), surcharge: fd.get('surcharge') }),
      });
      renderServicesTab(main);
    } catch (err) {
      zone.querySelector('#new-commune-msg').innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  };
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

let tripWatchId = null;

function startTripLocationSharing() {
  if (tripWatchId !== null) return; // déjà en cours
  if (!navigator.geolocation) {
    alert("Ce téléphone/navigateur ne supporte pas la géolocalisation.");
    return;
  }
  tripWatchId = navigator.geolocation.watchPosition(
    async (pos) => {
      try {
        await api('/trip/update', {
          method: 'POST',
          body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        });
      } catch (e) { /* silent, on réessaiera à la prochaine position */ }
    },
    (err) => { console.error('[Hairsprit] Erreur GPS:', err.message); },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

function stopTripLocationSharing() {
  if (tripWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(tripWatchId);
    tripWatchId = null;
  }
}

async function renderTodayTab(main) {
  main.innerHTML = `<div class="loading-spin"></div>`;
  let bookings, schedule, urgent, trip;
  try {
    const [bookingsRes, scheduleRes, urgentRes, tripRes] = await Promise.all([api('/bookings'), api('/schedule'), api('/urgent-availability'), api('/trip/status')]);
    bookings = bookingsRes.bookings;
    schedule = scheduleRes.settings;
    urgent = urgentRes;
    trip = tripRes;
  } catch (e) {
    main.innerHTML = `<div class="error-msg">${e.message}</div>`;
    return;
  }

  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const todayBookings = bookings
    .filter(b => b.status === 'confirme' && b.slot_datetime && new Date(b.slot_datetime).toISOString().slice(0, 10) === todayKey)
    .sort((a, b) => new Date(a.slot_datetime) - new Date(b.slot_datetime));

  const minutesLeft = urgent.active ? Math.max(0, Math.round((new Date(urgent.expiresAt) - now) / 60000)) : 0;

  main.innerHTML = `
    <div class="section-title" style="margin-top:0;">⚡ Disponible maintenant</div>
    <div class="scanner-box" style="max-width:100%;">
      ${urgent.active ? `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
          <div>
            <div style="font-weight:600;color:var(--succes);font-size:14.5px;">🟢 Actif</div>
            <div style="color:var(--argent);font-size:12px;margin-top:2px;">Expire dans ${minutesLeft} min${urgent.surcharge > 0 ? ` · Supplément +${parseFloat(urgent.surcharge).toFixed(2)}€` : ''}</div>
          </div>
          <button class="btn btn-danger" id="deactivate-urgent-btn" style="width:auto;padding:9px 14px;font-size:12.5px;">Désactiver</button>
        </div>
      ` : `
        <div style="display:flex;gap:10px;">
          <div class="field" style="flex:1;">
            <label>Durée</label>
            <select id="urgent-duration" style="width:100%;background:var(--panel-2);border:1px solid var(--ligne);color:var(--blanc);padding:10px;border-radius:8px;">
              <option value="30">30 min</option>
              <option value="45" selected>45 min</option>
              <option value="60">1h</option>
            </select>
          </div>
          <div class="field" style="flex:1;">
            <label>Supplément (€, optionnel)</label>
            <input type="number" id="urgent-surcharge" min="0" step="1" placeholder="0" />
          </div>
        </div>
        <button class="btn btn-primary" id="activate-urgent-btn">🟢 Activer "Disponible maintenant"</button>
      `}
    </div>

    ${trip.active ? `
      <div class="section-title">🚐 Trajet en cours</div>
      <div class="scanner-box" style="max-width:100%;">
        <div style="display:flex;align-items:center;gap:8px;color:var(--succes);font-weight:600;font-size:14px;">
          <div style="width:8px;height:8px;background:var(--succes);border-radius:50%;box-shadow:0 0 6px var(--succes);"></div>
          Position partagée en direct
        </div>
        <button class="btn btn-danger" id="stop-trip-btn" style="margin-top:10px;">Terminer le trajet</button>
      </div>
    ` : ''}

    <div class="section-title">Planning du ${now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    ${todayBookings.length === 0 ? `<div class="empty-state">Aucun rendez-vous confirmé aujourd'hui.</div>` : ''}
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${todayBookings.map(b => `
        <div class="reward-admin-row" style="flex-direction:column;align-items:stretch;gap:8px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div style="font-family:var(--font-mono);font-size:18px;font-weight:600;">${new Date(b.slot_datetime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}${b.is_urgent ? ' ⚡' : ''}</div>
            <a href="${buildICSLink(b, schedule.slot_duration_minutes)}" title="Ajouter au calendrier" style="text-decoration:none;">📅</a>
          </div>
          <div style="font-weight:600;font-size:14.5px;">${b.prenom} ${b.nom} · ${b.telephone}</div>
          ${b.people_count > 1 ? `<div style="color:var(--argent-clair);font-size:12.5px;">👥 ${b.people_count} personnes${b.total_duration_minutes ? ` · ${b.total_duration_minutes} min` : ''}</div>` : ''}
          ${b.booking_details ? `<div style="color:var(--succes);font-size:13px;">${b.booking_details}</div>` : (b.service_name ? `<div style="color:var(--succes);font-size:13px;">${b.service_name} · ${parseFloat(b.service_price).toFixed(2)}€</div>` : '')}
          ${b.address ? `<div style="color:var(--argent);font-size:13px;">📍 ${b.address} <button class="copy-address-btn" data-address="${b.address.replace(/"/g, '&quot;')}" title="Copier l'adresse" style="background:none;border:none;color:var(--blanc);cursor:pointer;padding:2px 4px;">📋</button> <a href="https://www.waze.com/ul?q=${encodeURIComponent(b.address)}&navigate=yes" target="_blank" rel="noopener" title="Ouvrir dans Waze" style="text-decoration:none;padding:2px 4px;">🚗</a></div>` : ''}
          ${b.admin_notes ? `<div style="color:var(--argent);font-size:12.5px;">📝 ${b.admin_notes}</div>` : ''}
          ${!trip.active ? `<button class="btn btn-outline start-trip-btn" data-client-id="${b.client_id}" style="margin-top:6px;">🚐 Démarrer le trajet</button>` : ''}
        </div>
      `).join('')}
    </div>
  `;

  main.querySelectorAll('.start-trip-btn').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Démarrage...';
      try {
        await api('/trip/start', { method: 'POST', body: JSON.stringify({ client_id: btn.dataset.clientId }) });
        startTripLocationSharing();
        renderTodayTab(main);
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.textContent = '🚐 Démarrer le trajet';
      }
    };
  });

  const stopTripBtn = main.querySelector('#stop-trip-btn');
  if (stopTripBtn) {
    stopTripBtn.onclick = async () => {
      stopTripBtn.disabled = true;
      stopTripBtn.textContent = '...';
      try {
        stopTripLocationSharing();
        await api('/trip/stop', { method: 'POST' });
        renderTodayTab(main);
      } catch (err) {
        alert(err.message);
        stopTripBtn.disabled = false;
        stopTripBtn.textContent = 'Terminer le trajet';
      }
    };
  }

  if (trip.active) startTripLocationSharing();

  const activateBtn = main.querySelector('#activate-urgent-btn');
  if (activateBtn) {
    activateBtn.onclick = async () => {
      activateBtn.disabled = true;
      activateBtn.textContent = 'Activation...';
      try {
        const duration_minutes = main.querySelector('#urgent-duration').value;
        const surcharge = main.querySelector('#urgent-surcharge').value;
        await api('/urgent-availability', { method: 'PUT', body: JSON.stringify({ active: true, duration_minutes, surcharge }) });
        renderTodayTab(main);
      } catch (err) {
        alert(err.message);
        activateBtn.disabled = false;
        activateBtn.textContent = '🟢 Activer "Disponible maintenant"';
      }
    };
  }
  const deactivateBtn = main.querySelector('#deactivate-urgent-btn');
  if (deactivateBtn) {
    deactivateBtn.onclick = async () => {
      deactivateBtn.disabled = true;
      deactivateBtn.textContent = '...';
      try {
        await api('/urgent-availability', { method: 'PUT', body: JSON.stringify({ active: false }) });
        renderTodayTab(main);
      } catch (err) {
        alert(err.message);
        deactivateBtn.disabled = false;
        deactivateBtn.textContent = 'Désactiver';
      }
    };
  }
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
        <div class="field" style="margin-bottom:0;flex:1;min-width:130px;">
          <label>Marge de trajet (min)</label>
          <input type="number" id="travel-buffer" value="${schedule.travel_buffer_minutes || 0}" min="0" step="5" />
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
          ${b.people_count > 1 ? `<div style="color:var(--argent-clair);font-size:12.5px;">👥 ${b.people_count} personnes${b.total_duration_minutes ? ` · ${b.total_duration_minutes} min` : ''}</div>` : ''}
          ${b.booking_details ? `<div style="font-size:13.5px;color:var(--succes);">${b.booking_details}</div>` : (b.service_name ? `<div style="font-size:13.5px;color:var(--succes);">${b.service_name} · ${parseFloat(b.service_price).toFixed(2)}€</div>` : '')}
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
    const travel_buffer_minutes = main.querySelector('#travel-buffer').value;
    if (!checkedDays) {
      main.querySelector('#schedule-msg').innerHTML = `<div class="error-msg">Sélectionnez au moins un jour.</div>`;
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Enregistrement...';
    try {
      await api('/schedule', {
        method: 'PUT',
        body: JSON.stringify({ open_days: checkedDays, start_time, end_time, slot_duration_minutes, travel_buffer_minutes }),
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

/* ---------------- ORDERS TAB (Boutique) ---------------- */
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

  main.innerHTML = `
    <div class="section-title" style="margin-top:0;">Commandes de la boutique</div>
    ${orders.length === 0 ? `<div class="empty-state">Aucune commande pour le moment.</div>` : ''}
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${orders.map(o => `
        <div class="reward-admin-row" data-order-id="${o.id}" style="flex-direction:column;align-items:stretch;gap:8px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
            <div>
              <div style="font-weight:600;font-size:14.5px;">${o.client_name}${o.recognized ? '' : ' <span style="color:var(--argent);font-weight:400;font-size:11.5px;">(non reconnu)</span>'}</div>
              <div style="color:var(--argent);font-size:12.5px;">${o.telephone || '—'}</div>
            </div>
            <span class="pill status-${o.status}">${o.status.replace('_', ' ')}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:3px;">
            ${o.items.map(it => `
              <div style="display:flex;justify-content:space-between;font-size:13px;">
                <span>${it.quantity}× ${it.product_name}</span>
                <span style="font-family:var(--font-mono);color:var(--argent-clair);">${(parseFloat(it.product_price) * it.quantity).toFixed(2)}€</span>
              </div>
            `).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;border-top:1px solid var(--ligne);padding-top:8px;font-weight:600;font-size:13.5px;">
            <span>Total</span>
            <span style="font-family:var(--font-mono);color:var(--succes);">${o.total.toFixed(2)}€</span>
          </div>
          ${o.note ? `<div style="color:var(--argent);font-size:12.5px;">📝 ${o.note}</div>` : ''}
          <div style="color:var(--argent);font-size:12px;">Commandé le ${formatDate(o.created_at)}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${o.status === 'en_attente' ? `
              <button class="btn btn-outline order-status-btn" data-status="prete" style="width:auto;flex:1;padding:9px 12px;font-size:12.5px;">Marquer prête</button>
            ` : ''}
            ${o.status !== 'recuperee' ? `
              <button class="btn btn-outline order-status-btn" data-status="recuperee" style="width:auto;flex:1;padding:9px 12px;font-size:12.5px;">✓ Récupérée</button>
            ` : `
              <button class="btn btn-ghost order-status-btn" data-status="en_attente" style="width:auto;padding:9px 12px;font-size:12.5px;">Remettre en attente</button>
            `}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  main.querySelectorAll('.order-status-btn').forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest('[data-order-id]');
      try {
        await api(`/orders/${row.dataset.orderId}`, { method: 'PUT', body: JSON.stringify({ status: btn.dataset.status }) });
        renderOrdersTab(main);
      } catch (err) { alert(err.message); }
    };
  });
}

/* ---------------- ACCOUNTING TAB (Comptabilité) ---------------- */
const EXPENSE_CAT_LABELS = { essence: 'Essence / déplacement', produits: 'Produits', materiel: 'Matériel', assurance: 'Assurance', autre: 'Autre' };

function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

async function renderAccountingTab(main) {
  if (!state.accountingMonth) {
    const now = new Date();
    state.accountingMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  main.innerHTML = `<div class="loading-spin"></div>`;
  let data, goal;
  try {
    const [accountingRes, goalRes] = await Promise.all([
      api(`/accounting?month=${state.accountingMonth}`),
      api('/accounting-goal'),
    ]);
    data = accountingRes;
    goal = goalRes;
  } catch (e) {
    main.innerHTML = `<div class="error-msg">${e.message}</div>`;
    return;
  }

  main.innerHTML = `
    <div class="section-title" style="margin-top:0;">Comptabilité</div>
    <div style="display:flex;align-items:center;justify-content:space-between;background:var(--panel);border:1px solid var(--ligne);border-radius:10px;padding:10px 14px;margin-bottom:14px;">
      <button id="acct-prev" style="background:none;border:none;color:var(--blanc);font-size:18px;cursor:pointer;padding:4px 10px;">‹</button>
      <span style="font-weight:600;text-transform:capitalize;">${monthLabel(data.month)}</span>
      <button id="acct-next" style="background:none;border:none;color:var(--blanc);font-size:18px;cursor:pointer;padding:4px 10px;">›</button>
    </div>

    <div class="section-title">Compte de résultat</div>
    <div class="scanner-box" style="max-width:100%;">
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13.5px;font-weight:600;">
        <span>Revenus</span><span></span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:5px 0 5px 14px;font-size:12.5px;color:var(--argent-clair);">
        <span>Prestations coiffure</span><span style="font-family:var(--font-mono);">${data.revenue.prestations.toFixed(2)}€</span>
      </div>
      ${data.revenue.espece > 0 ? `<div style="display:flex;justify-content:space-between;padding:5px 0 5px 14px;font-size:12.5px;color:var(--argent-clair);"><span>💵 Espèce (hors app)</span><span style="font-family:var(--font-mono);">${data.revenue.espece.toFixed(2)}€</span></div>` : ''}
      ${data.revenue.virement > 0 ? `<div style="display:flex;justify-content:space-between;padding:5px 0 5px 14px;font-size:12.5px;color:var(--argent-clair);"><span>💳 Virement (hors app)</span><span style="font-family:var(--font-mono);">${data.revenue.virement.toFixed(2)}€</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13.5px;font-weight:600;">
        <span>Total revenus</span><span style="font-family:var(--font-mono);color:var(--succes);">${data.revenue.total.toFixed(2)}€</span>
      </div>
      <div style="height:1px;background:var(--ligne);margin:10px 0;"></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13.5px;font-weight:600;">
        <span>Dépenses</span><span></span>
      </div>
      ${data.expenses.byCategory.map(c => `
        <div style="display:flex;justify-content:space-between;padding:5px 0 5px 14px;font-size:12.5px;color:var(--argent-clair);">
          <span>${c.category}</span><span style="font-family:var(--font-mono);">${c.total.toFixed(2)}€</span>
        </div>
      `).join('')}
      ${data.expenses.byCategory.length === 0 ? `<div style="padding:5px 0 5px 14px;font-size:12.5px;color:var(--argent);">Aucune dépense ce mois-ci</div>` : ''}
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13.5px;font-weight:600;">
        <span>Total dépenses</span><span style="font-family:var(--font-mono);color:var(--danger);">${data.expenses.total.toFixed(2)}€</span>
      </div>
      <div style="display:flex;justify-content:space-between;border-top:1px solid var(--ligne);margin-top:6px;padding-top:10px;font-weight:700;font-size:15px;">
        <span>Résultat net</span><span style="font-family:var(--font-mono);font-size:20px;color:${data.net >= 0 ? 'var(--succes)' : 'var(--danger)'};">${data.net.toFixed(2)}€</span>
      </div>
    </div>

    <div class="section-title">💰 À mettre de côté (${data.setasidePercent}%)</div>
    <div class="scanner-box" style="max-width:100%;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:11px;color:var(--argent);">Cotisations, impôts... (pourcentage réglable)</div>
          <div style="font-family:var(--font-mono);font-size:24px;font-weight:700;color:#e8c463;margin-top:4px;">${data.setasideAmount.toFixed(2)}€</div>
        </div>
        <button class="btn btn-outline" id="acct-edit-percent-btn" style="width:auto;padding:8px 12px;font-size:12px;">✏️ % </button>
      </div>
      <div style="border-top:1px solid var(--ligne);margin-top:10px;padding-top:8px;font-size:12px;color:var(--argent-clair);display:flex;justify-content:space-between;">
        <span>Disponible après mise de côté</span>
        <span style="font-family:var(--font-mono);color:var(--succes);">${data.availableAfterSetaside.toFixed(2)}€</span>
      </div>
    </div>

    <div class="section-title">🎯 Objectif d'épargne</div>
    <div class="scanner-box" style="max-width:100%;">
      ${goal.hasGoal ? `
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <div style="font-weight:600;font-size:14px;">${goal.goalLabel || 'Objectif'}</div>
          <button class="btn btn-outline" id="acct-edit-goal-btn" style="width:auto;padding:6px 10px;font-size:11px;">Modifier</button>
        </div>
        <div style="margin-top:10px;background:var(--panel-2);border-radius:8px;height:10px;overflow:hidden;">
          <div style="height:100%;width:${goal.pct.toFixed(1)}%;background:${goal.reached ? 'var(--succes)' : 'linear-gradient(90deg,#9d4dff,#00e5ff)'};transition:width 0.4s;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:12.5px;">
          <span style="font-family:var(--font-mono);color:var(--argent-clair);">${goal.cumulativeSetAside.toFixed(2)}€ / ${goal.goalAmount.toFixed(2)}€</span>
          <span style="font-family:var(--font-mono);color:${goal.reached ? 'var(--succes)' : 'var(--argent-clair)'};">${goal.pct.toFixed(0)}%</span>
        </div>
        ${goal.reached ? `<div style="color:var(--succes);font-size:12.5px;margin-top:6px;">🎉 Objectif atteint !</div>` : ''}
      ` : `
        <div class="empty-state">Aucun objectif défini.</div>
        <button class="btn btn-outline" id="acct-edit-goal-btn" style="margin-top:10px;">🎯 Définir un objectif</button>
      `}
    </div>

    <div class="section-title">Journal comptable</div>
    ${data.entries.length === 0 ? `<div class="empty-state">Aucun mouvement ce mois-ci.</div>` : ''}
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${data.entries.map(e => `
        <div style="background:var(--panel);border:1px solid var(--ligne);border-radius:10px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;">
          <div style="display:flex;flex-direction:column;gap:2px;">
            <div style="font-size:13px;font-weight:500;">${e.label}</div>
            <div style="font-size:11px;color:var(--argent);">${new Date(e.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</div>
            <div style="display:inline-block;font-size:10px;border:1px solid var(--ligne);border-radius:20px;padding:2px 8px;color:var(--argent-clair);margin-top:3px;width:fit-content;">${e.category}</div>
          </div>
          <div style="font-family:var(--font-mono);font-weight:600;font-size:14px;color:${e.type === 'revenu' ? 'var(--succes)' : 'var(--danger)'};">${e.type === 'revenu' ? '+' : '−'}${e.amount.toFixed(2)}€</div>
        </div>
      `).join('')}
    </div>
  `;

  main.querySelector('#acct-prev').onclick = () => { state.accountingMonth = shiftMonth(state.accountingMonth, -1); renderAccountingTab(main); };
  main.querySelector('#acct-next').onclick = () => { state.accountingMonth = shiftMonth(state.accountingMonth, 1); renderAccountingTab(main); };

  main.querySelector('#acct-edit-percent-btn').onclick = async () => {
    const newPercent = prompt('Pourcentage à mettre de côté (cotisations, impôts...) :', data.setasidePercent);
    if (newPercent === null) return;
    try {
      await api('/accounting-settings', { method: 'PUT', body: JSON.stringify({ setaside_percent: newPercent }) });
      renderAccountingTab(main);
    } catch (err) { alert(err.message); }
  };

  const editGoalBtn = main.querySelector('#acct-edit-goal-btn');
  if (editGoalBtn) {
    editGoalBtn.onclick = async () => {
      const label = prompt('Nom de l\'objectif (ex : Provision impôts 2026, Achat véhicule...) :', goal.goalLabel || '');
      if (label === null) return;
      const amount = prompt('Montant à atteindre (€) :', goal.goalAmount || '');
      if (amount === null) return;
      const startDate = prompt('Compter depuis quelle date ? (AAAA-MM-JJ)', goal.goalStartDate ? goal.goalStartDate.slice(0, 10) : new Date().toISOString().slice(0, 10));
      if (startDate === null) return;
      try {
        await api('/accounting-settings', { method: 'PUT', body: JSON.stringify({ goal_label: label, goal_amount: amount, goal_start_date: startDate }) });
        renderAccountingTab(main);
      } catch (err) { alert(err.message); }
    };
  }
}

/* ---------------- BANK TAB (synchronisation Ponto/Belfius) ---------------- */
async function renderBankTab(main) {
  main.innerHTML = `<div class="loading-spin"></div>`;
  let transactions;
  try {
    const res = await api('/bank/transactions');
    transactions = res.transactions;
  } catch (e) {
    main.innerHTML = `<div class="error-msg">${e.message}</div>`;
    return;
  }

  main.innerHTML = `
    <div class="section-title" style="margin-top:0;">Banque (Belfius via Ponto)</div>
    <div class="scanner-box" style="max-width:100%;">
      <div class="sub" style="color:var(--argent);font-size:12.5px;margin-bottom:12px;">
        Une synchronisation automatique se fait chaque jour. Chaque transaction est classée
        automatiquement (négatif = dépense, positif = recette) et compte directement dans
        ta comptabilité. Ajuste la catégorie ou supprime une entrée si besoin ci-dessous.
      </div>
      <button class="btn btn-primary" id="sync-bank-btn">🔄 Synchroniser maintenant</button>
      <div id="sync-msg"></div>
    </div>

    <div class="section-title">Transactions récentes (${transactions.length})</div>
    ${transactions.length === 0 ? `<div class="empty-state">Aucune transaction pour le moment. Clique sur "Synchroniser" pour aller en chercher.</div>` : ''}
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${transactions.map(tx => `
        <div class="reward-admin-row" data-tx-id="${tx.id}" style="flex-direction:column;align-items:stretch;gap:8px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <div style="font-weight:600;font-size:14px;">${tx.description || tx.counterpartName || 'Transaction sans libellé'}</div>
              <div style="color:var(--argent);font-size:12px;">${tx.date ? new Date(tx.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—'}${tx.counterpartName ? ` · ${tx.counterpartName}` : ''}</div>
            </div>
            <div style="font-family:var(--font-mono);font-weight:700;font-size:15px;color:${tx.amount >= 0 ? 'var(--succes)' : 'var(--danger)'};">${tx.amount >= 0 ? '+' : ''}${tx.amount.toFixed(2)}€</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            ${tx.linkedExpenseId ? `
              <span class="pill">💸 Dépense</span>
              <select class="tx-category-select" style="flex:1;min-width:130px;background:var(--panel-2);border:1px solid var(--ligne);color:var(--blanc);padding:8px 10px;border-radius:8px;font-size:12.5px;">
                <option value="autre">Autre</option>
                <option value="essence">Essence / déplacement</option>
                <option value="produits">Produits</option>
                <option value="materiel">Matériel</option>
                <option value="assurance">Assurance</option>
              </select>
              <button class="btn btn-outline tx-save-category-btn" style="width:auto;padding:8px 12px;font-size:12px;">Enregistrer</button>
            ` : `
              <span class="pill">💰 Recette</span>
            `}
            <button class="btn btn-ghost tx-delete-btn" style="width:auto;padding:8px 12px;font-size:12px;margin-left:auto;">Supprimer</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  main.querySelector('#sync-bank-btn').onclick = async () => {
    const btn = main.querySelector('#sync-bank-btn');
    btn.disabled = true;
    btn.textContent = 'Synchronisation...';
    try {
      const res = await api('/bank/sync', { method: 'POST' });
      main.querySelector('#sync-msg').innerHTML = `<div class="success-msg">✓ ${res.newTransactions} nouvelle(s) transaction(s) récupérée(s) et classée(s).</div>`;
      renderBankTab(main);
    } catch (err) {
      main.querySelector('#sync-msg').innerHTML = `<div class="error-msg">${err.message}</div>`;
      btn.disabled = false;
      btn.textContent = '🔄 Synchroniser maintenant';
    }
  };

  main.querySelectorAll('.tx-save-category-btn').forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest('[data-tx-id]');
      const category = row.querySelector('.tx-category-select').value;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        await api(`/bank/transactions/${row.dataset.txId}/category`, { method: 'PUT', body: JSON.stringify({ category }) });
        btn.textContent = '✓ Enregistré';
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Enregistrer'; }, 1200);
      } catch (err) { alert(err.message); btn.disabled = false; btn.textContent = 'Enregistrer'; }
    };
  });

  main.querySelectorAll('.tx-delete-btn').forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest('[data-tx-id]');
      if (!confirm('Retirer cette transaction de ta comptabilité (ex: erreur, virement interne) ?')) return;
      btn.disabled = true;
      try {
        await api(`/bank/transactions/${row.dataset.txId}`, { method: 'DELETE' });
        renderBankTab(main);
      } catch (err) { alert(err.message); btn.disabled = false; }
    };
  });
}

/* ---------------- STATS TAB ---------------- */
// ---------------- GRAPHIQUES SVG (statistiques) ----------------
function lineChartSvg(points, labels, opts) {
  opts = opts || {};
  const width = 600, height = 160, padding = 24;
  const max = Math.max(1, ...points);
  const stepX = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const coords = points.map((v, i) => {
    const x = padding + i * stepX;
    const y = height - padding - (v / max) * (height - padding * 2 - 10);
    return [x, y];
  });
  const linePath = coords.map((c, i) => (i === 0 ? 'M' : 'L') + c[0].toFixed(1) + ',' + c[1].toFixed(1)).join(' ');
  const areaPath = linePath + ` L${coords[coords.length - 1][0].toFixed(1)},${height - padding} L${coords[0][0].toFixed(1)},${height - padding} Z`;
  const color = opts.color || '#00e5ff';
  const dots = coords.map((c, i) => `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="3" fill="${color}"><title>${labels[i]}: ${points[i].toFixed(2)}</title></circle>`).join('');
  const labelEls = labels.map((l, i) => {
    if (labels.length > 8 && i % 2 !== 0) return '';
    return `<text x="${coords[i][0].toFixed(1)}" y="${height - 4}" font-size="8" fill="var(--argent, #9a9a9e)" text-anchor="middle">${l}</text>`;
  }).join('');
  return `
    <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:150px;overflow:visible;">
      <defs>
        <linearGradient id="grad-${opts.id || 'a'}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#grad-${opts.id || 'a'})" stroke="none"/>
      <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2"/>
      ${dots}
      ${labelEls}
    </svg>
  `;
}

function pieChartSvg(data) {
  const total = data.reduce((sum, d) => sum + d.total, 0);
  if (total <= 0) return '';
  const colors = ['#00e5ff', '#ff2ec4', '#9d4dff', '#e8c463', '#7fd88f', '#e0716b'];
  const cx = 60, cy = 60, r = 55;
  let angle = -90;
  const slices = data.map((d, i) => {
    const fraction = d.total / total;
    const sweep = fraction * 360;
    const startRad = (angle * Math.PI) / 180;
    const endRad = ((angle + sweep) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(startRad), y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad), y2 = cy + r * Math.sin(endRad);
    const largeArc = sweep > 180 ? 1 : 0;
    const path = `M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${largeArc} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`;
    angle += sweep;
    return `<path d="${path}" fill="${colors[i % colors.length]}"><title>${d.category}: ${d.total.toFixed(2)}€</title></path>`;
  }).join('');
  const legend = data.map((d, i) => `
    <div style="display:flex;align-items:center;gap:6px;font-size:12px;">
      <span style="width:9px;height:9px;border-radius:2px;background:${colors[i % colors.length]};display:inline-block;"></span>
      <span>${EXPENSE_CATEGORY_LABELS[d.category] || d.category}</span>
      <span style="color:var(--argent);font-family:var(--font-mono);margin-left:auto;">${d.total.toFixed(2)}€</span>
    </div>
  `).join('');
  return `
    <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;">
      <svg viewBox="0 0 120 120" style="width:120px;height:120px;flex-shrink:0;">${slices}</svg>
      <div style="display:flex;flex-direction:column;gap:6px;flex:1;min-width:140px;">${legend}</div>
    </div>
  `;
}

const EXPENSE_CATEGORY_LABELS = {
  essence: 'Essence',
  produits: 'Produits',
  materiel: 'Matériel',
  assurance: 'Assurance',
  autre: 'Autre',
};

function revenueBreakdownLine(breakdown) {
  if (!breakdown || breakdown.length === 0) return '';
  const espece = breakdown.find(p => p.method === 'espece');
  const virement = breakdown.find(p => p.method === 'virement');
  const parts = [];
  if (espece && espece.total > 0) parts.push(`💵 ${espece.total.toFixed(2)}€`);
  if (virement && virement.total > 0) parts.push(`💳 ${virement.total.toFixed(2)}€`);
  if (parts.length === 0) return '';
  return `<div style="color:var(--argent);font-size:11px;margin-top:5px;">${parts.join(' · ')}</div>`;
}

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
  const growthText = s.revenueGrowthPct == null ? '' : `${s.revenueGrowthPct >= 0 ? '+' : ''}${s.revenueGrowthPct.toFixed(0)}% vs mois dernier`;
  const growthColor = s.revenueGrowthPct == null ? 'var(--argent)' : (s.revenueGrowthPct >= 0 ? 'var(--succes)' : 'var(--danger)');
  main.innerHTML = `
    <div class="section-title" style="margin-top:0;">Chiffre d'affaires — ${monthLabel}</div>
    <div class="scanner-box" style="max-width:100%;">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;">
        <div style="font-family:var(--font-mono);font-size:38px;font-weight:600;color:var(--succes);">${s.monthRevenue.toFixed(2)}€</div>
        ${growthText ? `<div style="font-family:var(--font-mono);font-size:13px;color:${growthColor};font-weight:600;">${growthText}</div>` : ''}
      </div>
      <div style="color:var(--argent);font-size:12.5px;margin-top:4px;">${s.monthRevenueCount} prestation${s.monthRevenueCount > 1 ? 's' : ''} confirmée${s.monthRevenueCount > 1 ? 's' : ''} avec tarif ce mois-ci</div>
    </div>

    <div class="section-title">Suivi du CA</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <div style="flex:1;min-width:100px;background:var(--panel);border:1px solid var(--ligne);border-radius:12px;padding:14px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--argent);">Cette semaine</div>
        <div style="font-family:var(--font-mono);font-size:18px;font-weight:600;margin-top:4px;">${s.weekRevenue.toFixed(2)}€</div>
        ${revenueBreakdownLine(s.paymentBreakdownWeek)}
        <div style="color:${(s.weekRevenue - s.weekExpenses) >= 0 ? 'var(--succes)' : 'var(--danger)'};font-size:11.5px;margin-top:6px;border-top:1px solid var(--ligne);padding-top:6px;">Net : ${(s.weekRevenue - s.weekExpenses).toFixed(2)}€</div>
      </div>
      <div style="flex:1;min-width:100px;background:var(--panel);border:1px solid var(--ligne);border-radius:12px;padding:14px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--argent);">Ce mois</div>
        <div style="font-family:var(--font-mono);font-size:18px;font-weight:600;margin-top:4px;">${s.monthRevenue.toFixed(2)}€</div>
        ${revenueBreakdownLine(s.paymentBreakdown)}
        <div style="color:${(s.monthRevenue - s.monthExpenses) >= 0 ? 'var(--succes)' : 'var(--danger)'};font-size:11.5px;margin-top:6px;border-top:1px solid var(--ligne);padding-top:6px;">Net : ${(s.monthRevenue - s.monthExpenses).toFixed(2)}€</div>
      </div>
      <div style="flex:1;min-width:100px;background:var(--panel);border:1px solid var(--ligne);border-radius:12px;padding:14px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--argent);">Cette année</div>
        <div style="font-family:var(--font-mono);font-size:18px;font-weight:600;margin-top:4px;">${s.yearRevenue.toFixed(2)}€</div>
        ${revenueBreakdownLine(s.paymentBreakdownYear)}
        <div style="color:${(s.yearRevenue - s.yearExpenses) >= 0 ? 'var(--succes)' : 'var(--danger)'};font-size:11.5px;margin-top:6px;border-top:1px solid var(--ligne);padding-top:6px;">Net : ${(s.yearRevenue - s.yearExpenses).toFixed(2)}€</div>
      </div>
    </div>

    <div class="section-title">Ajouter un mouvement</div>
    <div class="scanner-box" style="max-width:100%;">
      <div style="display:flex;gap:8px;margin-bottom:14px;">
        <button type="button" class="btn ${(state.statsQuickMode || 'expense') === 'expense' ? 'btn-primary' : 'btn-outline'}" id="quick-mode-expense" style="flex:1;">💸 Dépense</button>
        <button type="button" class="btn ${state.statsQuickMode === 'revenue' ? 'btn-primary' : 'btn-outline'}" id="quick-mode-revenue" style="flex:1;">💰 Encaissement</button>
      </div>
      <div style="display:flex;gap:10px;">
        <div class="field" style="flex:1;">
          <label>Date</label>
          <input type="date" id="quick-date" value="${new Date().toISOString().slice(0, 10)}" />
        </div>
        <div class="field" style="flex:1;">
          <label>Montant (€)</label>
          <input type="number" id="quick-amount" min="0" step="0.5" placeholder="0.00" />
        </div>
      </div>
      ${(state.statsQuickMode || 'expense') === 'expense' ? `
        <div class="field">
          <label>Catégorie</label>
          <select id="quick-category" style="width:100%;background:var(--panel-2);border:1px solid var(--ligne);color:var(--blanc);padding:12px 14px;border-radius:10px;font-size:14px;">
            <option value="essence">Essence / déplacement</option>
            <option value="produits">Produits</option>
            <option value="materiel">Matériel</option>
            <option value="assurance">Assurance</option>
            <option value="autre">Autre</option>
          </select>
        </div>
      ` : `
        <div class="field">
          <label>Mode de paiement</label>
          <select id="quick-payment-method" style="width:100%;background:var(--panel-2);border:1px solid var(--ligne);color:var(--blanc);padding:12px 14px;border-radius:10px;font-size:14px;">
            <option value="espece">💵 Espèce</option>
            <option value="virement">💳 Virement</option>
          </select>
        </div>
      `}
      <div class="field">
        <label>Note (optionnel)</label>
        <input type="text" id="quick-note" placeholder="${(state.statsQuickMode || 'expense') === 'expense' ? "Ex : plein d'essence" : 'Ex : 4 coupes'}" />
      </div>
      <button class="btn btn-primary" id="quick-add-btn">${(state.statsQuickMode || 'expense') === 'expense' ? 'Ajouter la dépense' : "Ajouter l'encaissement"}</button>
      <div id="quick-msg"></div>
    </div>

    ${s.monthlyBreakdown && s.monthlyBreakdown.length > 0 ? `
      <div class="section-title">Évolution du CA (12 mois)</div>
      <div class="scanner-box" style="max-width:100%;">
        ${lineChartSvg(
          s.monthlyBreakdown.map(m => m.total),
          s.monthlyBreakdown.map(m => {
            const [yr, mo] = m.mois.split('-');
            return new Date(parseInt(yr, 10), parseInt(mo, 10) - 1, 1).toLocaleDateString('fr-FR', { month: 'short' });
          }),
          { color: '#00e5ff', id: 'revenue' }
        )}
      </div>
      <div class="section-title">Historique mensuel</div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${s.monthlyBreakdown.slice().reverse().map(m => {
          const [yr, mo] = m.mois.split('-');
          const label = new Date(parseInt(yr, 10), parseInt(mo, 10) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
          return `
            <div style="display:flex;justify-content:space-between;background:var(--panel);border:1px solid var(--ligne);border-radius:8px;padding:9px 12px;font-size:13px;">
              <span style="text-transform:capitalize;">${label}</span>
              <span style="font-family:var(--font-mono);color:var(--succes);">${m.total.toFixed(2)}€</span>
            </div>
          `;
        }).join('')}
      </div>
    ` : ''}

    <div class="section-title">Détail des dépenses</div>
    <div class="scanner-box" style="max-width:100%;">
      ${s.expensesByCategory && s.expensesByCategory.length > 0 ? pieChartSvg(s.expensesByCategory) : `<div class="empty-state">Aucune dépense ce mois-ci.</div>`}
      ${s.recentExpenses && s.recentExpenses.length > 0 ? `
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px;">
          ${s.recentExpenses.map(ex => `
            <div class="history-item" data-expense-id="${ex.id}">
              <div>
                <div>${parseFloat(ex.amount).toFixed(2)}€ <span class="pill" style="margin-left:6px;">${EXPENSE_CATEGORY_LABELS[ex.category] || ex.category}</span></div>
                <div class="date">${new Date(ex.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}${ex.note ? ` · ${ex.note}` : ''}</div>
              </div>
              <button class="btn btn-danger delete-expense-btn" style="width:auto;padding:8px 12px;font-size:12px;">Supprimer</button>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>

    <div class="section-title">Détail des encaissements manuels</div>
    <div class="scanner-box" style="max-width:100%;">
      ${s.paymentBreakdown && s.paymentBreakdown.length > 0 ? `
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
          ${s.paymentBreakdown.map(p => `
            <div style="flex:1;min-width:120px;background:var(--panel-2);border:1px solid var(--ligne);border-radius:10px;padding:10px 12px;">
              <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:0.5px;color:var(--argent);">${p.method === 'virement' ? 'Virement' : 'Espèce'} (ce mois)</div>
              <div style="font-family:var(--font-mono);font-size:16px;font-weight:600;margin-top:2px;">${p.total.toFixed(2)}€</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${s.recentManual && s.recentManual.length > 0 ? `
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${s.recentManual.map(m => `
            <div class="history-item" data-manual-id="${m.id}">
              <div>
                <div>${parseFloat(m.amount).toFixed(2)}€ <span class="pill" style="margin-left:6px;">${m.paymentMethod === 'virement' ? 'Virement' : 'Espèce'}</span></div>
                <div class="date">${new Date(m.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}${m.note ? ` · ${m.note}` : ''}</div>
              </div>
              <button class="btn btn-danger delete-manual-btn" style="width:auto;padding:8px 12px;font-size:12px;">Supprimer</button>
            </div>
          `).join('')}
        </div>
      ` : `<div class="empty-state">Aucun encaissement manuel ce mois-ci.</div>`}
    </div>

    <div class="section-title">Vue d'ensemble</div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-value">${s.totalClients}</div><div class="stat-label">Clients inscrits</div></div>
      <div class="stat-card"><div class="stat-value">${s.totalVisits}</div><div class="stat-label">Visites totales</div></div>
      <div class="stat-card"><div class="stat-value">${s.totalPointsDistributed}</div><div class="stat-label">Points distribués</div></div>
      <div class="stat-card"><div class="stat-value">${s.totalPointsActive}</div><div class="stat-label">Points en circulation</div></div>
      <div class="stat-card"><div class="stat-value">${s.newClients30}</div><div class="stat-label">Nouveaux clients (30j)</div></div>
      <div class="stat-card"><div class="stat-value">${s.pendingBookings}</div><div class="stat-label">Réservations en attente</div></div>
      <div class="stat-card"><div class="stat-value">${s.avgBasket.toFixed(2)}€</div><div class="stat-label">Panier moyen</div></div>
      <div class="stat-card"><div class="stat-value">${s.returningRatePct.toFixed(0)}%</div><div class="stat-label">Clients qui reviennent</div></div>
    </div>

    ${s.busiest ? `
      <div class="section-title">Créneau le plus demandé</div>
      <div class="scanner-box" style="max-width:100%;">
        <div style="font-size:16px;font-weight:600;text-transform:capitalize;">${s.busiest.day} vers ${String(s.busiest.hour).padStart(2, '0')}h</div>
        <div style="color:var(--argent);font-size:12.5px;margin-top:4px;">${s.busiest.count} rendez-vous confirmé${s.busiest.count > 1 ? 's' : ''} sur ce créneau</div>
      </div>
    ` : ''}

    <div class="section-title">Visites — 30 derniers jours</div>
    <div class="scanner-box" style="max-width:100%;">
      ${s.last30.length === 0 ? `<div class="empty-state">Pas encore de visite enregistrée.</div>` :
        lineChartSvg(
          s.last30.map(d => d.visites),
          s.last30.map(d => new Date(d.jour).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })),
          { color: '#ff2ec4', id: 'visits' }
        )}
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

  const modeExpenseBtn = main.querySelector('#quick-mode-expense');
  const modeRevenueBtn = main.querySelector('#quick-mode-revenue');
  if (modeExpenseBtn) modeExpenseBtn.onclick = () => { state.statsQuickMode = 'expense'; renderStatsTab(main); };
  if (modeRevenueBtn) modeRevenueBtn.onclick = () => { state.statsQuickMode = 'revenue'; renderStatsTab(main); };

  const quickAddBtn = main.querySelector('#quick-add-btn');
  if (quickAddBtn) {
    quickAddBtn.onclick = async () => {
      const mode = state.statsQuickMode || 'expense';
      const date = main.querySelector('#quick-date').value;
      const amount = main.querySelector('#quick-amount').value;
      const note = main.querySelector('#quick-note').value;
      if (!date || !amount) {
        main.querySelector('#quick-msg').innerHTML = `<div class="error-msg">Date et montant requis.</div>`;
        return;
      }
      quickAddBtn.disabled = true;
      quickAddBtn.textContent = 'Ajout...';
      try {
        if (mode === 'expense') {
          const category = main.querySelector('#quick-category').value;
          await api('/expenses', { method: 'POST', body: JSON.stringify({ date, amount, category, note }) });
        } else {
          const payment_method = main.querySelector('#quick-payment-method').value;
          await api('/manual-revenue', { method: 'POST', body: JSON.stringify({ date, amount, note, payment_method }) });
        }
        renderStatsTab(main);
      } catch (err) {
        main.querySelector('#quick-msg').innerHTML = `<div class="error-msg">${err.message}</div>`;
        quickAddBtn.disabled = false;
        quickAddBtn.textContent = mode === 'expense' ? 'Ajouter la dépense' : "Ajouter l'encaissement";
      }
    };
  }

  main.querySelectorAll('.delete-expense-btn').forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest('[data-expense-id]');
      const id = row.dataset.expenseId;
      if (!confirm('Supprimer cette dépense ?')) return;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        await api(`/expenses/${id}`, { method: 'DELETE' });
        renderStatsTab(main);
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.textContent = 'Supprimer';
      }
    };
  });

  main.querySelectorAll('.delete-manual-btn').forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest('[data-manual-id]');
      const id = row.dataset.manualId;
      if (!confirm('Supprimer cette entrée de CA manuel ?')) return;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        await api(`/manual-revenue/${id}`, { method: 'DELETE' });
        renderStatsTab(main);
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.textContent = 'Supprimer';
      }
    };
  });
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
