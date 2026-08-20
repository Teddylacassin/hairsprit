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
  let bookings, schedule, urgent;
  try {
    const [bookingsRes, scheduleRes, urgentRes] = await Promise.all([api('/bookings'), api('/schedule'), api('/urgent-availability')]);
    bookings = bookingsRes.bookings;
    schedule = scheduleRes.settings;
    urgent = urgentRes;
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
        </div>
      `).join('')}
    </div>
  `;

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

/* ---------------- STATS TAB ---------------- */
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

    <div class="section-title">Ajouter une dépense (essence, produits, matériel...)</div>
    <div class="scanner-box" style="max-width:100%;">
      <div style="display:flex;gap:10px;">
        <div class="field" style="flex:1;">
          <label>Date</label>
          <input type="date" id="expense-date" value="${new Date().toISOString().slice(0, 10)}" />
        </div>
        <div class="field" style="flex:1;">
          <label>Montant (€)</label>
          <input type="number" id="expense-amount" min="0" step="0.5" placeholder="0.00" />
        </div>
      </div>
      <div class="field">
        <label>Catégorie</label>
        <select id="expense-category" style="width:100%;background:var(--panel-2);border:1px solid var(--ligne);color:var(--blanc);padding:12px 14px;border-radius:10px;font-size:14px;">
          <option value="essence">Essence / déplacement</option>
          <option value="produits">Produits</option>
          <option value="materiel">Matériel</option>
          <option value="assurance">Assurance</option>
          <option value="autre">Autre</option>
        </select>
      </div>
      <div class="field">
        <label>Note (optionnel)</label>
        <input type="text" id="expense-note" placeholder="Ex : plein d'essence" />
      </div>
      <button class="btn btn-outline" id="add-expense-btn">Ajouter la dépense</button>
      <div id="expense-msg"></div>
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

    ${s.monthlyBreakdown && s.monthlyBreakdown.length > 0 ? `
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

    <div class="section-title">Ajouter du CA manuel (clients hors app)</div>
    <div class="scanner-box" style="max-width:100%;">
      <div class="field">
        <label>Date</label>
        <input type="date" id="manual-revenue-date" value="${new Date().toISOString().slice(0, 10)}" style="max-width:220px;" />
      </div>
      <div style="display:flex;gap:10px;">
        <div class="field" style="flex:1;">
          <label>Espèce (€)</label>
          <input type="number" id="manual-revenue-espece" min="0" step="0.5" placeholder="0.00" />
        </div>
        <div class="field" style="flex:1;">
          <label>Virement (€)</label>
          <input type="number" id="manual-revenue-virement" min="0" step="0.5" placeholder="0.00" />
        </div>
      </div>
      <div class="field" style="margin-top:0;">
        <label>Note (optionnel)</label>
        <input type="text" id="manual-revenue-note" placeholder="Ex : 4 coupes" />
      </div>
      <button class="btn btn-outline" id="add-manual-revenue-btn" style="margin-top:6px;">Ajouter au CA du jour</button>
      <div id="manual-revenue-msg"></div>
      ${s.paymentBreakdown && s.paymentBreakdown.length > 0 ? `
        <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">
          ${s.paymentBreakdown.map(p => `
            <div style="flex:1;min-width:120px;background:var(--panel-2);border:1px solid var(--ligne);border-radius:10px;padding:10px 12px;">
              <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:0.5px;color:var(--argent);">${p.method === 'virement' ? 'Virement' : 'Espèce'} (ce mois)</div>
              <div style="font-family:var(--font-mono);font-size:16px;font-weight:600;margin-top:2px;">${p.total.toFixed(2)}€</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${s.recentManual && s.recentManual.length > 0 ? `
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px;">
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
      ` : ''}
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

  main.querySelector('#add-expense-btn').onclick = async () => {
    const btn = main.querySelector('#add-expense-btn');
    const date = main.querySelector('#expense-date').value;
    const amount = main.querySelector('#expense-amount').value;
    const category = main.querySelector('#expense-category').value;
    const note = main.querySelector('#expense-note').value;
    if (!date || !amount) {
      main.querySelector('#expense-msg').innerHTML = `<div class="error-msg">Date et montant requis.</div>`;
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Ajout...';
    try {
      await api('/expenses', { method: 'POST', body: JSON.stringify({ date, amount, category, note }) });
      renderStatsTab(main);
    } catch (err) {
      main.querySelector('#expense-msg').innerHTML = `<div class="error-msg">${err.message}</div>`;
      btn.disabled = false;
      btn.textContent = 'Ajouter la dépense';
    }
  };

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

  main.querySelector('#add-manual-revenue-btn').onclick = async () => {
    const btn = main.querySelector('#add-manual-revenue-btn');
    const date = main.querySelector('#manual-revenue-date').value;
    const espece = main.querySelector('#manual-revenue-espece').value;
    const virement = main.querySelector('#manual-revenue-virement').value;
    const note = main.querySelector('#manual-revenue-note').value;
    if (!date || (!espece && !virement)) {
      main.querySelector('#manual-revenue-msg').innerHTML = `<div class="error-msg">Date et au moins un montant (espèce ou virement) requis.</div>`;
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Ajout...';
    try {
      if (espece && parseFloat(espece) > 0) {
        await api('/manual-revenue', { method: 'POST', body: JSON.stringify({ date, amount: espece, note, payment_method: 'espece' }) });
      }
      if (virement && parseFloat(virement) > 0) {
        await api('/manual-revenue', { method: 'POST', body: JSON.stringify({ date, amount: virement, note, payment_method: 'virement' }) });
      }
      renderStatsTab(main);
    } catch (err) {
      main.querySelector('#manual-revenue-msg').innerHTML = `<div class="error-msg">${err.message}</div>`;
      btn.disabled = false;
      btn.textContent = 'Ajouter au CA du jour';
    }
  };

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
